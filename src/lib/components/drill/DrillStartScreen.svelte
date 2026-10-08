<!--
	Drill → start screen: how many cards or lines are due, the depth breakdown
	(card mode), and the Start Drilling button.
-->
<script lang="ts">
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

<div class="start-screen">
	<div class="start-count">
		{drill.drillType === 'card' ? drill.filteredCards.length : drill.allDueCards.length}
	</div>
	<div class="start-label">{drill.drillType === 'card' ? 'cards' : 'lines'} to drill</div>

	{#if drill.drillType === 'card'}
		<div class="start-breakdown">
			<div class="start-breakdown-row">
				<span>Foundations (1–5)</span>
				<span>{drill.sectionCounts.foundations}</span>
			</div>
			<div class="start-breakdown-row">
				<span>Mainlines (6–15)</span>
				<span>{drill.sectionCounts.mainlines}</span>
			</div>
			<div class="start-breakdown-row">
				<span>Deep Lines (16+)</span>
				<span>{drill.sectionCounts.deep}</span>
			</div>
		</div>
	{/if}

	<button
		class="btn btn--primary start-btn"
		disabled={drill.drillType === 'card' && drill.filteredCards.length === 0}
		onclick={drill.startDrilling}
	>
		Start Drilling <kbd>Space</kbd>
	</button>
</div>

<style>
	.start-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) 0;
	}

	.start-count {
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1;
	}

	.start-label {
		font-size: 0.95rem;
		color: var(--color-text-secondary);
		margin-top: calc(-1 * var(--space-2));
	}

	.start-breakdown {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	.start-breakdown-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}

	.start-btn {
		width: 100%;
		margin-top: var(--space-2);
	}
</style>
