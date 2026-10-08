<!--
	TrainMoveList — the trainer's moves grouped into numbered pairs.
	Shown while playing and again on the end screen. The opponent's
	(black's) moves are dimmed.
-->

<script lang="ts">
	import type { MovePair } from './trainState.svelte';

	let { pairs }: { pairs: MovePair[] } = $props();
</script>

<div class="move-list">
	{#each pairs as pair (pair.num)}
		<span class="move-num">{pair.num}.</span>
		{#if pair.white}
			<span class="move-san">{pair.white}</span>
		{/if}
		{#if pair.black}
			<span class="move-san move-san--opponent">{pair.black}</span>
		{/if}
	{/each}
</div>

<style>
	/* ── Move list ────────────────────────────────────────────────────────────── */

	.move-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: 0.85rem;
	}

	.move-num {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.move-san {
		font-weight: 500;
	}

	.move-san--opponent {
		color: var(--color-text-secondary);
	}
</style>
