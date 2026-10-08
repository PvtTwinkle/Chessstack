<!--
	Drill → Cards / Lines switch.
-->
<script lang="ts">
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

<div class="drill-type-toggle">
	<button
		class="drill-type-btn"
		class:active={drill.drillType === 'card'}
		onclick={() => drill.switchDrillType('card')}
	>
		Cards
	</button>
	<button
		class="drill-type-btn"
		class:active={drill.drillType === 'line'}
		onclick={() => drill.switchDrillType('line')}
	>
		Lines
	</button>
</div>

<style>
	.drill-type-toggle {
		display: flex;
		gap: 0.35rem;
	}

	.drill-type-btn {
		flex: 1;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.8rem;
		font-family: var(--font-body);
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		transition: all var(--dur-fast) var(--ease-snap);
	}

	.drill-type-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
	}

	.drill-type-btn.active {
		background: rgba(91, 127, 164, 0.15);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}
</style>
