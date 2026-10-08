<!--
	Drill Mode — /drill
	───────────────────
	Spaced repetition practice: surface due cards, play through from move 1,
	pause at the user's turn, grade their response.

	The drill flow and phase state machine live in
	$lib/components/drill/drillState.svelte.ts. This page wires that state to
	the board and sidebar, and owns the $effects that react to server data,
	keyboard input and the drill phase.
-->

<script lang="ts">
	import OpeningName from '$lib/components/OpeningName.svelte';
	import DrillBoard from '$lib/components/drill/DrillBoard.svelte';
	import DrillHeader from '$lib/components/drill/DrillHeader.svelte';
	import DrillTypeToggle from '$lib/components/drill/DrillTypeToggle.svelte';
	import SectionFilter from '$lib/components/drill/SectionFilter.svelte';
	import DrillProgress from '$lib/components/drill/DrillProgress.svelte';
	import DrillStartScreen from '$lib/components/drill/DrillStartScreen.svelte';
	import DrillEmptyState from '$lib/components/drill/DrillEmptyState.svelte';
	import DrillLineDisplay from '$lib/components/drill/DrillLineDisplay.svelte';
	import WaitingPanel from '$lib/components/drill/WaitingPanel.svelte';
	import CorrectPanel from '$lib/components/drill/CorrectPanel.svelte';
	import IncorrectPanel from '$lib/components/drill/IncorrectPanel.svelte';
	import LineComplete from '$lib/components/drill/LineComplete.svelte';
	import DrillComplete from '$lib/components/drill/DrillComplete.svelte';
	import '$lib/components/drill/drill-ui.css';
	import { createDrillState } from '$lib/components/drill/drillState.svelte';
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import { initSounds, setSoundEnabled } from '$lib/sounds';
	import type { DueCard, RepertoireMove } from '$lib/drill/types';

	let { data }: { data: PageData } = $props();

	const s = createDrillState({
		getRepertoireId: () => data.repertoire.id,
		getRepertoireColor: () => data.repertoire.color,
		reload: () => invalidateAll()
	});

	// ── Board resize ─────────────────────────────────────────────────────────
	// Fire-and-forget: the ResizableBoard component already shows the new size
	// via localWidth; no invalidateAll() needed (which would reset drill state).
	function handleBoardResize(size: number) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ boardSize: size })
		});
	}

	// Preload audio files once on mount so sounds play without latency.
	onMount(() => {
		initSounds();
		return () => s.destroy();
	});

	// ── Keyboard shortcuts ─────────────────────────────────────────────────────

	// Register a keydown listener for grading and Next button shortcuts.
	// The $effect cleanup function removes the listener when the component unmounts.
	$effect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			s.handleShortcut(e);
		}

		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	});

	// Keep the sounds module in sync with soundEnabled state.
	$effect(() => {
		setSoundEnabled(s.soundEnabled);
	});

	// ── Sync from server data ──────────────────────────────────────────────────

	// Runs on mount and again whenever the server data changes (e.g. invalidateAll).
	// IMPORTANT: restartFromData() is wrapped in untrack() to prevent it from
	// adding filteredCards/allMoves/currentCardIdx as reactive dependencies of
	// this effect. Without untrack, writing allDueCards above invalidates
	// filteredCards, and then reading filteredCards inside startNextCard() makes
	// it a dependency — causing this effect to re-run infinitely.
	$effect(() => {
		s.syncFromData({
			moves: data.moves as RepertoireMove[],
			dueCards: data.dueCards as DueCard[],
			settings: data.settings
		});
		untrack(() => s.restartFromData());
	});

	// Start/stop the tempo timer whenever the drill phase changes.
	// When phase becomes 'waiting', start counting down; otherwise, stop.
	// Tempo is disabled in line mode — it doesn't make sense with auto-advancing.
	$effect(() => {
		if (s.phase === 'waiting' && s.drillType === 'card') {
			untrack(() => s.startTempoTimer());
		} else {
			untrack(() => s.stopTempoTimer());
		}
	});

	// Orientation: white at bottom for white repertoires.
	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);
</script>

<div class="drill-ui">
	<div class="page">
		<!-- ── Board column ──────────────────────────────────────────────────────── -->
		<div class="board-col">
			<DrillBoard
				drill={s}
				boardSize={data.settings?.boardSize ?? 0}
				boardTheme={data.settings?.boardTheme ?? 'blue'}
				{orientation}
				onResize={handleBoardResize}
			/>
		</div>

		<!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
		<div class="sidebar">
			<DrillHeader drill={s} name={data.repertoire.name} color={data.repertoire.color} />

			<!-- Drill-all mode banner -->
			{#if data.drillMode === 'all'}
				<div class="drill-all-banner">
					{data.fromFen ? 'Drilling subtree' : 'Drilling all cards'}
					<a href="/drill" class="drill-all-exit">Exit</a>
				</div>
			{/if}

			<!-- Drill type toggle: Cards vs Lines -->
			{#if s.phase !== 'complete'}
				<DrillTypeToggle drill={s} />
			{/if}

			<!-- ECO opening name -->
			<OpeningName currentFen={s.currentFen} fenHistory={s.fenHistory} />

			<!-- Depth section filter (card mode only) -->
			{#if s.drillType === 'card' && s.allDueCards.length > 0 && s.phase !== 'complete'}
				<SectionFilter drill={s} />
			{/if}

			<!-- Drill-all shortcut (only in normal due-cards mode, card drill type) -->
			{#if s.drillType === 'card' && data.drillMode !== 'all' && s.phase !== 'complete'}
				<a href="/drill?mode=all" class="drill-all-link">Drill all cards</a>
			{/if}

			<!-- Progress bar -->
			{#if s.started && s.phase !== 'complete' && (s.drillType === 'card' ? s.filteredCards.length : s.allLines.length) > 0}
				<DrillProgress drill={s} />
			{/if}

			<!-- ── Phase-specific content ─────────────────────────────────────────── -->

			{#if !s.started}
				<!-- Start screen — shown before the user begins drilling -->
				{#if s.allDueCards.length === 0}
					{@render caughtUp()}
				{:else}
					<DrillStartScreen drill={s} />
				{/if}
			{:else if s.drillType === 'line' && s.lineComplete}
				<!-- Line-complete interstitial -->
				<LineComplete drill={s} />
			{:else if s.drillType === 'line' && s.allLines.length === 0 && s.phase !== 'playing'}
				<!-- Line mode but no lines to drill -->
				<DrillEmptyState
					icon
					title="No lines to drill"
					hint="Your repertoire has no complete lines yet. Build more moves first."
				>
					<a href="/build" class="btn btn--primary">Build Mode</a>
				</DrillEmptyState>
			{:else if s.drillType === 'card' && s.allDueCards.length === 0}
				<!-- No cards due -->
				{@render caughtUp()}
			{:else if s.drillType === 'card' && s.filteredCards.length === 0}
				<!-- Due cards exist but none match the selected section -->
				<DrillEmptyState
					title="No cards in this range"
					hint="Try a different section, or select &quot;All&quot; to drill everything."
				/>
			{:else if s.phase === 'complete'}
				<!-- Session complete screen -->
				<DrillComplete
					drillType={s.drillType}
					totalReviewed={s.totalReviewed}
					correctCount={s.correctCount}
					linesDrilled={s.currentLineIdx}
					nextDueAt={s.nextDueAt}
					onRestart={s.restartSession}
				/>
			{:else if s.phase === 'playing'}
				<!-- Auto-playing through the line -->
				<div class="section">
					<div class="section-label">PLAYING THROUGH LINE</div>
					<p class="phase-hint">Watch the moves — your turn is coming…</p>
				</div>

				<!-- Current line display -->
				<DrillLineDisplay navHistory={s.navHistory} />
			{:else if s.phase === 'waiting'}
				<!-- User's turn to play -->
				<WaitingPanel drill={s} />
			{:else if s.phase === 'correct'}
				<!-- Correct! Show grading buttons or Next (if hint-used / already graded). -->
				<CorrectPanel drill={s} />
			{:else if s.phase === 'incorrect'}
				<!-- Wrong move — reveal the correct answer, show note, and Next button. -->
				<IncorrectPanel drill={s} />
			{/if}
		</div>
	</div>
</div>

{#snippet caughtUp()}
	<DrillEmptyState
		icon
		title="All caught up!"
		hint="No cards due right now. Come back later or build more repertoire."
	>
		<a href="/build" class="btn btn--primary">Build Mode</a>
		<a href="/drill?mode=all" class="btn btn--secondary">Drill all cards</a>
	</DrillEmptyState>
{/snippet}

<style>
	/* ── Page layout ──────────────────────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.board-col {
		width: 100%;
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

	/* ── Drill-all banner ───────────────────────────────────────────────────── */

	.drill-all-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--color-accent-subtle, rgba(59, 130, 246, 0.1));
		border: 1px solid var(--color-accent, #3b82f6);
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-accent, #3b82f6);
	}

	.drill-all-link {
		display: block;
		text-align: center;
		padding: var(--space-2) var(--space-3);
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		text-decoration: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.drill-all-link:hover {
		border-color: var(--color-accent, rgba(59, 130, 246, 0.4));
		color: var(--color-accent, #3b82f6);
	}

	.drill-all-exit {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-decoration: underline;
	}

	/* ── Phase hints ─────────────────────────────────────────────────────────── */

	.phase-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
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
