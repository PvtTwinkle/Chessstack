<!--
	Build Mode — /build
	───────────────────
	Where the user constructs their opening repertoire by playing out moves.

	Layout: board on the left, sidebar on the right.

	HOW MOVES WORK
	──────────────
	• Playing a move on the board saves it immediately (auto-save).
	• If the move is already saved, the board navigates there without a DB call.
	• On the user's turn, only ONE move per position is allowed. Playing a
	  different move when one already exists shows a conflict warning and snaps
	  the piece back.
	• On the opponent's turn, multiple moves are allowed (one for each line the
	  user wants to prepare against).

	HOW UNDO WORKS
	──────────────
	• Undo is navigation only — it steps backwards through the current line.
	• It does NOT delete anything from the database.
	• To actually remove a move from the repertoire, use the ✕ button in the
	  "Responses" section of the sidebar.

	REPERTOIRE SWITCHING
	────────────────────
	• A $effect syncs all local state from `data` whenever the server provides
	  fresh data. This happens on initial mount and after any invalidateAll()
	  call — which the nav bar's RepertoireSelector triggers on switch/rename/delete.

	WHERE THINGS LIVE
	─────────────────
	• Repertoire state and actions: $lib/components/build/buildState.svelte.ts
	• Keyboard shortcuts and hover arrows: buildKeyboard.svelte.ts
	• PGN export: buildExport.svelte.ts
	• Sidebar sections: the components imported below
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import CandidateMoves from '$lib/components/CandidateMoves.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import MoveList from '$lib/components/build/MoveList.svelte';
	import MoveTree from '$lib/components/build/MoveTree.svelte';
	import AnnotationModal from '$lib/components/build/AnnotationModal.svelte';
	import ImportPgnModal from '$lib/components/build/ImportPgnModal.svelte';
	import RepertoireHeader from '$lib/components/build/RepertoireHeader.svelte';
	import ModeToggle from '$lib/components/build/ModeToggle.svelte';
	import BuildBanners from '$lib/components/build/BuildBanners.svelte';
	import PositionMoves from '$lib/components/build/PositionMoves.svelte';
	import NavControls from '$lib/components/build/NavControls.svelte';
	import ActionBar from '$lib/components/build/ActionBar.svelte';
	import DeleteMoveModal from '$lib/components/build/DeleteMoveModal.svelte';
	import { createBuildState } from '$lib/components/build/buildState.svelte';
	import { createBuildKeyboard } from '$lib/components/build/buildKeyboard.svelte';
	import { createPgnExport } from '$lib/components/build/buildExport.svelte';
	import { patchSettings } from '$lib/components/build/buildView';
	import { invalidateAll } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import type { PageData } from './$types';
	import { initSounds, setSoundEnabled } from '$lib/sounds';
	import { tutorialStep } from '$lib/stores/tutorial';

	let { data }: { data: PageData } = $props();

	let importOpen = $state(false);

	// ── Eval bar state ────────────────────────────────────────────────────────
	let evalCp = $state<number | null>(null);
	let evalMate = $state<number | null>(null);

	const s = createBuildState({
		getRepertoireId: () => data.repertoire.id,
		getRepertoireColor: () => data.repertoire.color,
		getStartFen: () => data.repertoire.startFen ?? null
	});

	const keys = createBuildKeyboard({
		state: s,
		isModalOpen: () => !!s.annotatingMove || !!s.pendingDelete || importOpen
	});

	const pgnExport = createPgnExport(() => data.repertoire.id);

	onMount(() => {
		initSounds();
		return () => pgnExport.destroy();
	});

	// Board orientation: white at bottom for white repertoires, black for black.
	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	// ── Board resize ─────────────────────────────────────────────────────────
	// Fire-and-forget: the ResizableBoard component already shows the new size
	// via localWidth; no invalidateAll() needed (which would reset nav state).
	function handleBoardResize(size: number) {
		patchSettings({ boardSize: size });
	}

	// Keep the sounds module in sync with the user's saved preference.
	// This reacts to changes from the settings page (via invalidateAll).
	$effect(() => {
		setSoundEnabled(data.settings?.soundEnabled ?? true);
	});

	// Reset keyboard highlight whenever the position changes.
	$effect(() => {
		void s.currentFen; // track as dependency
		keys.resetHighlights();
	});

	// Reset the transposition dismissed flag whenever the user navigates to a new position.
	$effect(() => {
		void s.currentFen; // tracked — changing this FEN re-runs the $effect
		s.dismissTransposition();
	});

	// One-time flag: have we already replayed the jump line from the URL param?
	// Plain (non-reactive) variable so Svelte does not track it as a dependency.
	let didJumpToLine = false;

	// Sync all local state from the server-provided page data.
	// Runs on initial mount AND whenever `data` is refreshed.
	$effect(() => {
		const jumpLine = !didJumpToLine && data.jumpLine ? data.jumpLine : undefined;
		if (jumpLine) didJumpToLine = true;
		s.syncFromData(data.moves as Parameters<typeof s.syncFromData>[0], jumpLine);

		// When arriving via a Gap Finder deep link, the jump line may include
		// an opponent book move that isn't in the user's repertoire yet. Save
		// any missing moves so the tree stays connected.
		// Wrapped in untrack() because saveJumpLineMoves reads reactive state
		// (moves, navHistory) — without untrack, those reads would become
		// dependencies of this $effect, causing it to re-run and reset the
		// board back to the starting position when the saves complete.
		if (jumpLine) {
			untrack(() => s.saveJumpLineMoves());
		}
	});

	// ── Tutorial: advance after 8 half-moves ─────────────────────────────────
	$effect(() => {
		if ($tutorialStep !== 1) return;
		// navHistory length = number of half-moves in the current line
		if (s.navHistory.length >= 8) {
			patchSettings({ tutorialStep: 2 }).then(() => invalidateAll());
		}
	});
</script>

<svelte:window onkeydown={keys.handleKeydown} />

<div class="page">
	<!-- ── Board column ─────────────────────────────────────────────────────── -->
	<!--
		{#key boardKey} remounts the board when boardKey increments.
		We increment boardKey to reject a move visually — it forces
		Chessground to reinitialize with `currentFen`, snapping the
		piece back to where it was.
	-->
	<div class="board-col">
		<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={handleBoardResize}>
			<div class="board-inner">
				<EvalBar {evalCp} {evalMate} {orientation} />
				{#key s.boardKey}
					<ChessBoard
						fen={s.currentFen}
						{orientation}
						boardTheme={data.settings?.boardTheme ?? 'blue'}
						interactive={!s.saving}
						lastMove={s.lastMove}
						onMove={s.handleMove}
						autoShapes={keys.boardShapes}
					/>
				{/key}
			</div>
		</ResizableBoard>
	</div>

	<!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
	<div class="sidebar">
		<RepertoireHeader
			name={data.repertoire.name}
			color={data.repertoire.color}
			showMenu={!s.exploreMode}
			{pgnExport}
			onImport={() => (importOpen = true)}
		/>

		<ModeToggle exploreMode={s.exploreMode} onToggle={s.toggleExploreMode} />

		<!-- ECO opening name (updates as moves are played) -->
		<OpeningName currentFen={s.currentFen} fenHistory={s.fenHistory} />

		<BuildBanners {s} />

		<!-- Current line -->
		<MoveList
			movePairs={s.movePairs}
			currentIdx={s.navHistory.length - 1}
			onNavigate={s.navigateToHistoryIdx}
			isExploreEntry={s.exploreMode ? s.isExploreNavEntry : undefined}
		/>

		<!-- Full repertoire tree view -->
		<MoveTree
			moves={s.moves}
			currentFen={s.currentFen}
			startFen={s.startFen}
			onNavigateToLine={s.navigateToLine}
		/>

		<!-- Moves from the current position -->
		<PositionMoves
			{s}
			highlightedIdx={keys.highlightedContinuationIdx}
			onHover={(san) => (keys.hoveredSan = san)}
		/>

		<!-- Candidate moves (book + Stockfish suggestions) -->
		<CandidateMoves
			currentFen={s.currentFen}
			onSelectMove={s.handleCandidateSelect}
			onHoverMove={(san) => {
				keys.hoveredSan = san;
			}}
			disabled={s.saving}
			playerColor={data.repertoire.color as 'WHITE' | 'BLACK'}
			highlightedIndex={keys.highlightedCandidateIdx}
			onCandidatesChanged={keys.setCandidates}
			requestedTab={keys.requestedTab}
			onTabChanged={keys.tabChanged}
			onEvalChanged={(cp, mate) => {
				evalCp = cp;
				evalMate = mate;
			}}
			playersRatingBracket={data.settings?.playersRatingBracket ?? 3}
			onPlayersSettingsChanged={(bracket) => {
				patchSettings({ playersRatingBracket: bracket });
			}}
			starsPlayerSlug={data.settings?.starsPlayerSlug ?? null}
			onStarsSettingsChanged={(slug) => {
				patchSettings({ starsPlayerSlug: slug });
			}}
		/>

		<NavControls {s} />

		{#if !s.exploreMode}
			<ActionBar {s} {orientation} />
		{/if}
	</div>

	<!-- ── Annotation modal ──────────────────────────────────────────────── -->
	{#if s.annotatingMove}
		<AnnotationModal
			move={s.annotatingMove}
			bind:draft={s.annotationDraft}
			saving={s.savingAnnotation}
			error={s.annotationError}
			onSave={s.saveAnnotation}
			onClose={s.closeAnnotation}
		/>
	{/if}

	<!-- ── Delete confirmation modal ────────────────────────────────────── -->
	{#if s.pendingDelete}
		<DeleteMoveModal
			move={s.pendingDelete}
			subtreeCount={s.pendingDeleteSubtreeCount}
			onConfirm={() => s.executePendingDelete()}
			onCancel={() => s.cancelDelete()}
		/>
	{/if}

	<!-- ── PGN import modal ─────────────────────────────────────────────── -->
	<ImportPgnModal
		bind:open={importOpen}
		repertoireId={data.repertoire.id}
		repertoireColor={data.repertoire.color as 'WHITE' | 'BLACK'}
		onComplete={() => invalidateAll()}
	/>
</div>

<style>
	/* ── Page layout (mobile-first) ──────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.board-col {
		width: 100%;
	}

	.board-inner {
		display: flex;
		align-items: stretch;
		gap: var(--space-1, 4px);
	}

	.sidebar {
		width: 100%;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	/* Tablet (768px – 1023px) — --bp-md */
	@media (min-width: 768px) {
		.page {
			display: grid;
			grid-template-columns: auto 280px;
			gap: var(--space-4);
			align-items: start;
			justify-content: center;
			padding: 0;
		}
	}

	/* Desktop (≥1024px) — --bp-lg */
	@media (min-width: 1024px) {
		.page {
			grid-template-columns: auto 340px;
			gap: var(--space-6);
			max-width: 1100px;
			margin: 0 auto;
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.page {
			padding: var(--space-2);
			gap: var(--space-2);
		}

		.sidebar {
			padding: var(--space-3);
			gap: var(--space-3);
		}
	}
</style>
