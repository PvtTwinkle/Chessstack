<!--
	Puzzle Training — /puzzles
	──────────────────────────
	Puzzles from the Lichess puzzle database (seeded on first boot), filtered to
	the openings in the user's active repertoire. The flow and its phases live
	in puzzlesState.svelte.ts; this page lays them out.
-->

<script lang="ts">
	import { saveBoardSize } from '$lib/settings-client';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import PuzzleInfo from '$lib/components/puzzles/PuzzleInfo.svelte';
	import PuzzleFilters from '$lib/components/puzzles/PuzzleFilters.svelte';
	import { createPuzzlesState } from '$lib/components/puzzles/puzzlesState.svelte';
	import { onMount } from 'svelte';
	import { base, resolveRoute } from '$app/paths';
	import type { PageData } from './$types';
	import { initSounds, setSoundEnabled } from '$lib/sounds';

	let { data }: { data: PageData } = $props();

	const s = createPuzzlesState({
		getBaseUrl: () => base,
		getFamilies: () => data.openingFamilies,
		getRepertoireColor: () => data.repertoireColor
	});

	// Session-only: hidden themes stay hidden from one puzzle to the next.
	let hideThemes = $state(false);

	// ── Keyboard shortcuts ─────────────────────────────────────────────────────

	/** Space and Enter belong to whatever control has focus. */
	function isControl(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target.isContentEditable ||
			target.closest('button, a, input, select, textarea, summary, [contenteditable]') !== null
		);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			if (isControl(e.target)) return;
			e.preventDefault();
			if (s.canFetchNext) s.fetchNext();
		} else if ((e.key === 'h' || e.key === 'H') && !isControl(e.target)) {
			s.showHint();
		}
	}

	onMount(() => {
		initSounds();
		return () => s.destroy();
	});

	$effect(() => {
		setSoundEnabled(data.settings?.soundEnabled ?? true);
	});
</script>

<svelte:head>
	<title>Puzzles | Chessstack</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<!-- ── Empty states ────────────────────────────────────────────────────────── -->

{#if !data.hasImportedPuzzles}
	<div class="empty-state">
		<h2>Puzzles Loading</h2>
		<p>
			The puzzle database is loaded automatically on first startup. If you just started the app, it
			may still be loading &mdash; check the container logs for progress and refresh this page in a
			minute.
		</p>
	</div>
{:else if data.openingFamilies.length === 0}
	<div class="empty-state">
		<h2>No Matching Puzzles</h2>
		<p>
			No puzzles match the openings in your current repertoire. Build your repertoire in <a
				href={resolveRoute('/build')}>Build Mode</a
			> to unlock matching puzzles.
		</p>
	</div>
{:else}
	<!-- ── Main puzzle layout ──────────────────────────────────────────────── -->
	<div class="page">
		<!-- ── Board column ────────────────────────────────────────────────── -->
		<div class="board-col">
			<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={saveBoardSize}>
				<div class="board-wrap">
					<ChessBoard
						fen={s.currentFen}
						orientation={s.orientation}
						boardTheme={data.settings?.boardTheme ?? 'blue'}
						interactive={s.phase === 'waiting'}
						lastMove={s.lastMove}
						autoShapes={s.hintShapes}
						onMove={s.handleMove}
					/>

					<!-- Green/red flash overlay -->
					{#if s.flashColor}
						<div
							class="flash-overlay"
							class:flash-correct={s.flashColor === 'green'}
							class:flash-incorrect={s.flashColor === 'red'}
						></div>
					{/if}

					<!-- Phase indicator -->
					{#if s.phase === 'setup'}
						<div class="autoplay-badge">Setting up...</div>
					{:else if s.phase === 'loading'}
						<div class="autoplay-badge">Loading puzzle...</div>
					{/if}
				</div>
			</ResizableBoard>

			<!-- Turn indicator -->
			{#if s.puzzle && (s.phase === 'waiting' || s.phase === 'setup')}
				<div class="turn-indicator">
					<span
						class="turn-dot"
						class:white={s.orientation === 'white'}
						class:black={s.orientation === 'black'}
					></span>
					Your turn — find the best move
				</div>
			{/if}
		</div>

		<!-- ── Sidebar ─────────────────────────────────────────────────────── -->
		<div class="sidebar">
			{#if s.puzzle}
				<PuzzleInfo puzzle={s.puzzle} bind:hideThemes />
			{/if}

			<!-- Status / Result: announced as it changes -->
			<div class="banner-region" role="status" aria-live="polite">
				{#if s.phase === 'solved'}
					<div class="result-banner solved">Puzzle solved!</div>
				{:else if s.phase === 'incorrect'}
					<div class="result-banner failed">Incorrect — showing the solution</div>
				{:else if s.message}
					<div class="result-banner neutral">{s.message}</div>
				{:else if s.phase === 'idle' && s.attempted > 0 && !s.puzzle}
					<div class="result-banner neutral">Select filters and click Next Puzzle</div>
				{/if}
			</div>

			<!-- Controls -->
			<div class="controls">
				<button class="btn-primary" onclick={() => s.fetchNext()} disabled={!s.canFetchNext}>
					{s.phase === 'loading' ? 'Loading...' : 'Next Puzzle'}
				</button>

				{#if s.phase === 'waiting'}
					<button class="btn-secondary" onclick={() => s.showHint()}> Hint (H) </button>
				{/if}
			</div>

			<!-- Session stats -->
			{#if s.attempted > 0}
				<div class="session-stats">
					<div class="stat-row">
						<span class="stat-label">Solved</span>
						<span class="stat-value correct">{s.solvedCount}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Failed</span>
						<span class="stat-value incorrect">{s.failedCount}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Accuracy</span>
						<span class="stat-value">{s.accuracy}%</span>
					</div>
				</div>
			{/if}

			<PuzzleFilters
				puzzles={s}
				families={data.openingFamilies}
				themes={data.availableThemes}
				repertoireColor={data.repertoireColor}
			/>

			<!-- Match info -->
			<div class="match-info">
				{data.totalMatchingPuzzles.toLocaleString()} puzzles match your repertoire
			</div>
		</div>
	</div>
{/if}

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

	@media (min-width: 1024px) {
		.page {
			grid-template-columns: auto 340px;
			gap: var(--space-6);
			max-width: 1100px;
			margin: 0 auto;
		}
	}

	.board-wrap {
		position: relative;
		width: 100%;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		font-family: var(--font-body);
	}

	/* ── Board overlays ──────────────────────────────────────────────────────── */

	.flash-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: var(--radius-sm);
		animation: flash-fade 0.6s ease-out forwards;
	}

	.flash-correct {
		background: rgba(74, 222, 128, 0.35);
	}

	.flash-incorrect {
		background: rgba(248, 113, 113, 0.35);
	}

	@keyframes flash-fade {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.autoplay-badge {
		position: absolute;
		bottom: var(--space-2);
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-family: var(--font-body);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		pointer-events: none;
		white-space: nowrap;
	}

	/* ── Turn indicator ──────────────────────────────────────────────────────── */

	.turn-indicator {
		margin-top: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.turn-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.turn-dot.white {
		background: var(--color-text-primary);
	}

	.turn-dot.black {
		background: var(--color-base);
		border: 1px solid var(--color-text-muted);
	}

	/* ── Result banners ──────────────────────────────────────────────────────── */

	.result-banner {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		font-weight: 600;
		text-align: center;
	}

	.result-banner.solved {
		background: rgba(74, 222, 128, 0.15);
		color: var(--color-success);
		border: 1px solid rgba(74, 222, 128, 0.3);
	}

	.result-banner.failed {
		background: rgba(248, 113, 113, 0.15);
		color: var(--color-danger);
		border: 1px solid rgba(248, 113, 113, 0.3);
	}

	.result-banner.neutral {
		background: var(--color-accent-glow);
		color: var(--color-accent);
		border: 1px solid rgba(91, 127, 164, 0.2);
	}

	/* ── Controls ─────────────────────────────────────────────────────────────── */

	.controls {
		display: flex;
		gap: var(--space-2);
	}

	.btn-primary {
		flex: 1;
		padding: var(--space-3) var(--space-4);
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
		box-shadow: var(--glow-accent);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		padding: var(--space-3) var(--space-2);
		background: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 0.85rem;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.btn-secondary:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
		box-shadow: var(--glow-accent);
	}

	/* ── Session stats ────────────────────────────────────────────────────────── */

	.session-stats {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		box-shadow: var(--shadow-surface);
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.stat-label {
		color: var(--color-text-secondary);
	}

	.stat-value {
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.stat-value.correct {
		color: var(--color-success);
	}

	.stat-value.incorrect {
		color: var(--color-danger);
	}

	.banner-region:empty {
		display: none;
	}

	/* ── Match info ───────────────────────────────────────────────────────────── */

	.match-info {
		font-size: 0.78rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	/* ── Empty state ──────────────────────────────────────────────────────────── */

	.empty-state {
		max-width: 520px;
		margin: var(--space-8) auto;
		text-align: center;
	}

	.empty-state h2 {
		color: var(--color-text-primary);
		margin-bottom: var(--space-2);
	}

	.empty-state p {
		color: var(--color-text-secondary);
		line-height: 1.6;
	}

	.empty-state a {
		color: var(--color-accent);
	}

	/* ── Mobile responsive ────────────────────────────────────────────── */

	@media (max-width: 768px) {
		.page {
			flex-direction: column;
		}

		.board-col {
			width: 100%;
		}

		.sidebar {
			max-width: 100%;
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
