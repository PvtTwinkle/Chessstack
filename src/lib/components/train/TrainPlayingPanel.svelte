<!--
	TrainPlayingPanel — sidebar during a training game: move list, whose turn
	it is, progress towards the depth limit, and the Stop button.
-->

<script lang="ts">
	import TrainMoveList from './TrainMoveList.svelte';
	import type { TrainState } from './trainState.svelte';

	let { s }: { s: TrainState } = $props();
</script>

<div class="section">
	<div class="section-label">Move List</div>
	<TrainMoveList pairs={s.moveListDisplay} />
</div>

<div class="turn-indicator" class:user-turn={s.isUserTurn && !s.waitingForComputer}>
	<span class="turn-dot"></span>
	{#if s.waitingForComputer}
		Computer is thinking...
	{:else if s.isUserTurn}
		Your move
	{:else}
		Computer's turn
	{/if}
</div>

{#if s.depthLimit > 0}
	<div class="progress-section">
		<span class="progress-label">
			Move {s.fullMovesPlayed} / {s.depthLimit}
		</span>
		<div class="progress-bar">
			<div
				class="progress-fill"
				style="width: {Math.min(100, (s.fullMovesPlayed / s.depthLimit) * 100)}%"
			></div>
		</div>
	</div>
{:else}
	<div class="move-counter">
		{s.fullMovesPlayed} move{s.fullMovesPlayed === 1 ? '' : 's'} played
	</div>
{/if}

<button class="btn btn-secondary" onclick={s.stopTraining}> Stop Training </button>

<style>
	/* ── Turn indicator ──────────────────────────────────────────────────────── */

	.turn-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		color: var(--color-text-secondary);
	}

	.turn-indicator.user-turn {
		background: rgba(91, 127, 164, 0.1);
		border-color: rgba(91, 127, 164, 0.3);
		color: var(--color-accent);
	}

	.turn-dot {
		width: var(--space-2);
		height: var(--space-2);
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	/* ── Progress bar ────────────────────────────────────────────────────────── */

	.progress-section {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.progress-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.progress-bar {
		height: 6px;
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		border-radius: var(--radius-sm);
		transition: width var(--dur-base) ease;
	}

	.move-counter {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		padding: var(--space-2) 0;
	}
</style>
