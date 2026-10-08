<!--
	Review → board column on the analysis screen: the board, the colour-coded
	move list, engine-evaluation progress and the navigation row. Left/right
	arrow keys step through the game while this column is shown.
-->
<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import type { GameAnalysis } from '$lib/pgn';
	import { isUserPly, plyToLabel } from '$lib/review/evaluation';
	import type { ReviewState } from './reviewState.svelte';

	let {
		review,
		analysis,
		boardSize,
		boardTheme
	}: {
		review: ReviewState;
		/** The analysis being shown (review.analysis, narrowed to non-null by the page). */
		analysis: GameAnalysis;
		boardSize: number;
		boardTheme: string;
	} = $props();

	// Fire-and-forget: the ResizableBoard component already shows the new size
	// via localWidth; no invalidateAll() needed (which would reset review state).
	function handleBoardResize(size: number) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ boardSize: size })
		});
	}

	// Keyboard navigation: ← / → step through the game.
	$effect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.ctrlKey || e.altKey || e.metaKey) return;

			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				review.goBack();
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				review.goForward();
			}
		}

		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	});
</script>

<div class="board-col">
	<ResizableBoard {boardSize} onResize={handleBoardResize}>
		<div class="board-wrap">
			<ChessBoard
				fen={review.currentFen}
				orientation={review.orientation}
				{boardTheme}
				interactive={false}
				lastMove={review.lastMove}
				autoShapes={review.boardShapes}
			/>
		</div>
	</ResizableBoard>

	<!-- Move list — full game, colour-coded -->
	<div class="move-list-wrap">
		{#each analysis.sanHistory as san, i (i)}
			{@const ply = i + 1}
			{@const plyEval = isUserPly(ply, review.analysedPlayerColor)
				? review.positionEvals.get(ply)
				: null}
			{#if i % 2 === 0}
				<span class="move-num">{Math.floor(i / 2) + 1}.</span>
			{/if}
			<button
				class="move-san"
				class:move-san--active={review.currentPlyIdx === ply}
				style="color: {review.getMoveColor(ply)}"
				onclick={() => {
					review.currentPlyIdx = ply;
				}}
				>{san}{#if plyEval}<span class="move-eval">{review.formatPositionEval(plyEval)}</span
					>{/if}</button
			>
		{/each}
	</div>
	{#if review.evalProgress}
		<div class="eval-progress">
			<div
				class="eval-progress-bar"
				style="width: {(review.evalProgress.done / review.evalProgress.total) * 100}%"
			></div>
			<span class="eval-progress-text"
				>Evaluating {review.evalProgress.done}/{review.evalProgress.total}</span
			>
		</div>
	{/if}

	<!-- Navigation controls -->
	<div class="nav-row">
		<button class="nav-btn" onclick={review.reviewAnother} title="Back to input">
			← New game
		</button>
		<div class="nav-arrows">
			<button
				class="nav-btn"
				onclick={review.goBack}
				disabled={review.currentPlyIdx === 0}
				aria-label="Previous move"
			>
				◀
			</button>
			<span class="nav-pos">
				{#if review.isAutoPlaying}
					Playing…
				{:else if review.currentPlyIdx === 0}
					Start
				{:else}
					{plyToLabel(review.currentPlyIdx) + ' ' + analysis.sanHistory[review.currentPlyIdx - 1]}
				{/if}
			</span>
			<button
				class="nav-btn"
				onclick={review.goForward}
				disabled={review.currentPlyIdx === analysis.fenHistory.length - 1}
				aria-label="Next move"
			>
				▶
			</button>
		</div>
	</div>
</div>

<style>
	.board-col {
		width: 100%;
		min-width: 0;
		max-width: min(100%, calc(100vh - 100px));
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.board-wrap {
		width: 100%;
	}

	/* ── Move list below board ──────────────────────────────────────────────── */

	.move-list-wrap {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: 0.82rem;
		background: var(--color-base);
		border: 1px solid var(--color-surface);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		max-height: 96px;
		overflow-y: auto;
		line-height: 1.7;
	}

	.move-num {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
	}

	.move-san {
		background: none;
		border: none;
		cursor: pointer;
		padding: var(--space-1) var(--space-1);
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		font-family: var(--font-body);
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.move-san:hover {
		background: rgba(255, 255, 255, 0.07);
	}

	.move-eval {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
		margin-left: 1px;
		vertical-align: super;
		font-weight: 400;
	}

	.eval-progress {
		position: relative;
		height: 18px;
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-top: var(--space-1);
	}

	.eval-progress-bar {
		height: 100%;
		background: var(--color-accent);
		opacity: 0.4;
		transition: width 0.3s var(--ease-snap);
	}

	.eval-progress-text {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.65rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.move-san--active {
		background: var(--color-accent-glow) !important;
		outline: 1px solid rgba(91, 127, 164, 0.5);
		border-radius: var(--radius-sm);
	}

	/* ── Navigation row ─────────────────────────────────────────────────────── */

	.nav-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.nav-arrows {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.nav-btn {
		background: var(--color-base);
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.nav-btn:not(:disabled):hover {
		color: var(--color-text-primary);
		border-color: var(--color-accent);
	}

	.nav-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.nav-pos {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		min-width: 5rem;
		text-align: center;
	}
</style>
