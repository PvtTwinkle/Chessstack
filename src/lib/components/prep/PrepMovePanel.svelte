<script lang="ts">
	import type { PrepState, PrepMoveRow } from './prepState.svelte';
	import GapIndicator from './GapIndicator.svelte';

	let {
		state,
		highlightedIdx = null,
		onDeleteMove
	}: {
		state: PrepState;
		highlightedIdx?: number | null;
		/** Asks before deleting a prep move that has moves after it. */
		onDeleteMove: (move: PrepMoveRow) => void;
	} = $props();

	// The stats are from the games' point of view (White wins, draws, Black
	// wins), the same whichever side the user preps, so the labels say so
	// rather than "W/D/L", which read as the user's own results.
	function wdlTitle(pct: { winPct: number; drawPct: number; lossPct: number }): string {
		return `${pct.winPct.toFixed(1)}% White wins, ${pct.drawPct.toFixed(1)}% draws, ${pct.lossPct.toFixed(1)}% Black wins`;
	}

	function wdlPcts(
		w: number,
		b: number,
		d: number
	): { winPct: number; drawPct: number; lossPct: number; total: number } {
		const total = w + b + d;
		if (total === 0) return { winPct: 0, drawPct: 0, lossPct: 0, total: 0 };
		return {
			winPct: (w / total) * 100,
			drawPct: (d / total) * 100,
			lossPct: (b / total) * 100,
			total
		};
	}
</script>

<div class="move-panel">
	{#if state.isUserTurn}
		<!-- ── USER'S TURN: choose your response ──────────────────────── -->

		<!-- Saved prep moves -->
		{#if state.prepMovesAtPosition.length > 0}
			<section class="panel-section">
				<h3 class="section-title">Your prep moves</h3>
				<div class="move-list">
					{#each state.prepMovesAtPosition as move, idx (move.id)}
						<div
							class="prep-row"
							class:highlighted={highlightedIdx === idx && state.prepMovesAtPosition.length > 0}
						>
							<button class="prep-move-btn" onclick={() => state.handleCandidateSelect(move.san)}>
								{move.san}
							</button>
							<button
								class="remove-btn"
								onclick={() => onDeleteMove(move)}
								title="Remove prep move"
								aria-label="Remove prep move {move.san}"
							>
								&times;
							</button>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Opponent's opponents played here (context/suggestions) -->
		{#if state.suggestionsAtPosition.length > 0}
			<section class="panel-section">
				<h3 class="section-title">Played against your opponent</h3>
				<p class="section-hint">
					Moves others played here against your opponent. The bar shows White wins, draws and Black
					wins.
				</p>
				<div class="move-list">
					{#each state.suggestionsAtPosition as move, idx (idx)}
						{@const pct = wdlPcts(move.whiteWins, move.blackWins, move.draws)}
						<button
							class="move-row wdl-row"
							class:highlighted={highlightedIdx === idx && state.prepMovesAtPosition.length === 0}
							onclick={() => state.handleCandidateSelect(move.moveSan)}
							title={wdlTitle(pct)}
						>
							<div class="candidate-main">
								<span class="move-san">{move.moveSan}</span>
								<span class="wdl-bar-inline">
									<span class="wdl-white" style="width: {pct.winPct}%"></span>
									<span class="wdl-draw" style="width: {pct.drawPct}%"></span>
									<span class="wdl-black" style="width: {pct.lossPct}%"></span>
								</span>
								<span class="move-count">{pct.total}</span>
							</div>
							<div class="wdl-labels">
								<span class="wdl-label-white">{pct.winPct.toFixed(0)}%</span>
								<span class="wdl-label-draw">{pct.drawPct.toFixed(0)}%</span>
								<span class="wdl-label-black">{pct.lossPct.toFixed(0)}%</span>
							</div>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if state.prepMovesAtPosition.length === 0 && state.suggestionsAtPosition.length === 0}
			<section class="panel-section">
				<p class="empty-hint">Play a move on the board or select from the tabs above.</p>
			</section>
		{/if}
	{:else}
		<!-- ── OPPONENT'S TURN: see what they play ────────────────────── -->

		<section class="panel-section">
			<h3 class="section-title">Opponent plays</h3>
			{#if state.opponentMovesAtPosition.length === 0}
				<p class="empty-hint">No data at this position.</p>
			{:else}
				<p class="section-hint">
					Click a move to see what your opponent plays and prepare against it.
				</p>
				<div class="move-list">
					{#each state.opponentMovesAtPosition as move, idx (idx)}
						{@const pct = wdlPcts(move.whiteWins, move.blackWins, move.draws)}
						{@const gapStatus = state.getGapStatus(move.resultingFen)}
						<div class="move-row-with-action" class:highlighted={highlightedIdx === idx}>
							<button
								class="move-row wdl-row"
								onclick={() => state.clickOpponentMove(move.moveSan, move.resultingFen)}
								title={wdlTitle(pct)}
							>
								<div class="candidate-main">
									<GapIndicator status={gapStatus} />
									<span class="move-san">{move.moveSan}</span>
									<span class="wdl-bar-inline">
										<span class="wdl-white" style="width: {pct.winPct}%"></span>
										<span class="wdl-draw" style="width: {pct.drawPct}%"></span>
										<span class="wdl-black" style="width: {pct.lossPct}%"></span>
									</span>
									<span class="move-count">{pct.total}</span>
								</div>
								<div class="wdl-labels">
									<span class="wdl-label-white">{pct.winPct.toFixed(0)}%</span>
									<span class="wdl-label-draw">{pct.drawPct.toFixed(0)}%</span>
									<span class="wdl-label-black">{pct.lossPct.toFixed(0)}%</span>
								</div>
							</button>
							<button
								class="exclude-btn"
								onclick={(e) => {
									e.stopPropagation();
									state.excludeMove(move.positionFen, move.moveSan);
								}}
								title="Hide this move from prep"
								aria-label="Hide {move.moveSan} from prep"
							>
								&times;
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.move-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.panel-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2);
	}

	.section-title {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-1) 0;
	}

	.empty-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.section-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-1) 0;
		line-height: 1.3;
	}

	.move-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.move-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-body);
		font-size: 0.85rem;
		color: var(--color-text-primary);
		text-align: left;
		width: 100%;
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.move-row:hover {
		background: var(--color-surface-alt);
	}

	:global(.highlighted) > .move-row,
	.prep-row:global(.highlighted) {
		background: var(--color-surface-alt);
	}

	.move-san {
		font-weight: 600;
		min-width: 40px;
	}

	.move-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		min-width: 30px;
		text-align: right;
	}

	.move-row.wdl-row {
		flex-direction: column;
		align-items: stretch;
		gap: 0;
	}

	.candidate-main {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.wdl-bar-inline {
		flex: 1;
		display: flex;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		min-width: 0;
	}

	.wdl-white {
		background: var(--color-success);
	}

	.wdl-draw {
		background: var(--color-text-muted);
	}

	.wdl-black {
		background: var(--color-danger);
	}

	.wdl-labels {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.wdl-label-white {
		color: var(--color-success);
	}

	.wdl-label-draw {
		color: var(--color-text-muted);
	}

	.wdl-label-black {
		color: var(--color-danger);
	}

	.move-row-with-action {
		display: flex;
		align-items: flex-start;
		gap: 2px;
	}

	.move-row-with-action .move-row {
		flex: 1;
		min-width: 0;
	}

	.exclude-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.9rem;
		cursor: pointer;
		padding: var(--space-1) 2px;
		line-height: 1;
		flex-shrink: 0;
		opacity: 0;
		transition:
			opacity var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.move-row-with-action:hover .exclude-btn {
		opacity: 1;
	}

	.exclude-btn:hover {
		color: var(--color-eval-blunder);
	}

	.prep-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		font-size: 0.85rem;
	}

	.prep-move-btn {
		background: none;
		border: none;
		color: var(--color-accent);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.prep-move-btn:hover {
		color: var(--color-text-primary);
	}

	.remove-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 1rem;
		cursor: pointer;
		padding: 0 var(--space-1);
		line-height: 1;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.remove-btn:hover {
		color: var(--color-eval-blunder);
	}
</style>
