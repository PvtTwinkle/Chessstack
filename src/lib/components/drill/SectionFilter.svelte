<!--
	Drill → depth section tabs (card mode): All / Foundation / Mainlines / Deep.
-->
<script lang="ts">
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

<div class="section-filter">
	<div class="section-label">FOCUS</div>
	<div class="section-tabs">
		<button
			class="section-tab"
			class:active={drill.selectedSection === 'all'}
			onclick={() => drill.setSection('all')}
		>
			All Moves <span class="tab-count">{drill.allDueCards.length}</span>
		</button>
		<button
			class="section-tab"
			class:active={drill.selectedSection === 'foundations'}
			class:dimmed={drill.sectionCounts.foundations === 0}
			onclick={() => drill.setSection('foundations')}
		>
			Foundation (1–5) <span class="tab-count">{drill.sectionCounts.foundations}</span>
		</button>
		<button
			class="section-tab"
			class:active={drill.selectedSection === 'mainlines'}
			class:dimmed={drill.sectionCounts.mainlines === 0}
			onclick={() => drill.setSection('mainlines')}
		>
			Mainlines (6–15) <span class="tab-count">{drill.sectionCounts.mainlines}</span>
		</button>
		<button
			class="section-tab"
			class:active={drill.selectedSection === 'deep'}
			class:dimmed={drill.sectionCounts.deep === 0}
			onclick={() => drill.setSection('deep')}
		>
			Deep Lines (16+) <span class="tab-count">{drill.sectionCounts.deep}</span>
		</button>
	</div>
</div>

<style>
	.section-filter {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-tabs {
		display: flex;
		gap: 0.35rem;
	}

	.section-tab {
		flex: 1;
		padding: 0.35rem 0.25rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.7rem;
		font-family: var(--font-body);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-snap);
		text-align: center;
	}

	.section-tab:hover {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
	}

	.section-tab.active {
		background: rgba(91, 127, 164, 0.15);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.section-tab.dimmed {
		opacity: 0.45;
	}

	.section-tab.dimmed:hover {
		opacity: 0.7;
	}

	.tab-count {
		font-weight: 400;
		opacity: 0.6;
		font-size: 0.65rem;
	}

	/* ── Tablets and phones (< 768px) ── --bp-md */
	@media (max-width: 767px) {
		.section-tab {
			min-height: 44px;
			font-size: 0.8rem;
			padding: var(--space-2) var(--space-3);
			display: flex;
			align-items: center;
			justify-content: center;
		}
	}
</style>
