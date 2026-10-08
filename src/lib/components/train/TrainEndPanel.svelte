<!--
	TrainEndPanel — end-of-session sidebar: why the session ended, the engine
	evaluation and rating change, the game's moves, and follow-up actions.
-->

<script lang="ts">
	import TrainMoveList from './TrainMoveList.svelte';
	import { lichessAnalysisUrl, type TrainState } from './trainState.svelte';

	let { s, onReview }: { s: TrainState; onReview: () => void } = $props();
</script>

<div class="section">
	<div class="section-label">Session Complete</div>
	<p class="end-reason">{s.endReason}</p>
</div>

{#if s.evaluating}
	<div class="eval-loading">
		<div class="spinner"></div>
		Evaluating position...
	</div>
{:else if s.evalResult}
	{@const evalResult = s.evalResult}
	<div class="eval-card">
		<div class="eval-row">
			<span class="eval-label">Position Eval</span>
			<span
				class="eval-value"
				class:eval-good={evalResult.evalCp != null && evalResult.evalCp > 0}
				class:eval-bad={evalResult.evalCp != null && evalResult.evalCp < 0}
			>
				{s.evalDisplay ?? 'N/A'}
			</span>
		</div>

		{#if evalResult.ratingBefore != null && evalResult.ratingAfter != null && evalResult.ratingChange != null}
			<div class="eval-row">
				<span class="eval-label">Rating</span>
				<span class="eval-value">
					{evalResult.ratingBefore}
					<span class="rating-arrow">&#8594;</span>
					{evalResult.ratingAfter}
					<span
						class="rating-delta"
						class:delta-positive={evalResult.ratingChange > 0}
						class:delta-negative={evalResult.ratingChange < 0}
					>
						({evalResult.ratingChange > 0 ? '+' : ''}{evalResult.ratingChange})
					</span>
				</span>
			</div>
		{:else if !s.rated}
			<div class="eval-row">
				<span class="eval-label">Rating</span>
				<span class="eval-value eval-unrated">Unrated session</span>
			</div>
		{/if}

		<div class="eval-row">
			<span class="eval-label">Moves Played</span>
			<span class="eval-value">{s.fullMovesPlayed}</span>
		</div>
	</div>
{:else}
	<p class="eval-unavailable">Engine evaluation unavailable.</p>
{/if}

<!-- Move list recap -->
{#if s.gameMoves.length > 0}
	<div class="section">
		<div class="section-label">Game Moves</div>
		<TrainMoveList pairs={s.moveListDisplay} />
	</div>
{/if}

<div class="end-actions">
	<button class="btn btn-primary" onclick={onReview}> Review Game </button>
	<button class="btn btn-secondary" onclick={s.playAgain}> Play Again </button>
	<a
		class="btn btn-secondary lichess-link"
		href={lichessAnalysisUrl(s.currentFen, s.orientation)}
		target="_blank"
		rel="noopener noreferrer"
	>
		Analyze on Lichess
	</a>
</div>

<style>
	/* ── End screen ──────────────────────────────────────────────────────────── */

	.end-reason {
		font-size: 0.85rem;
		color: var(--color-text);
		margin: 0;
	}

	.eval-loading {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		padding: var(--space-3);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.eval-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.eval-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.eval-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
	}

	.eval-value {
		font-size: 0.9rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.eval-good {
		color: var(--color-success);
	}

	.eval-bad {
		color: var(--color-error);
	}

	.eval-unrated {
		color: var(--color-text-muted);
		font-style: italic;
		font-weight: 400;
	}

	.eval-unavailable {
		font-size: 0.82rem;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	.rating-arrow {
		color: var(--color-text-muted);
		margin: 0 var(--space-1);
	}

	.rating-delta {
		font-size: 0.8rem;
		margin-left: var(--space-1);
	}

	.delta-positive {
		color: var(--color-success);
	}

	.delta-negative {
		color: var(--color-error);
	}

	.end-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* ── Lichess link ────────────────────────────────────────────────────────── */

	.lichess-link {
		text-align: center;
		text-decoration: none;
	}
</style>
