<!--
	Drill → interstitial between lines in line mode.
-->
<script lang="ts">
	import DrillFeedback from './DrillFeedback.svelte';
	import NextButton from './NextButton.svelte';
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

<div class="line-complete-screen">
	<DrillFeedback correct>Line complete</DrillFeedback>
	<div class="complete-stats">
		<div class="stat-row">
			<span class="stat-label">Moves correct</span>
			<span class="stat-value">
				{drill.lineCorrect} / {drill.lineTotal}
				{#if drill.lineTotal > 0}
					<span class="stat-pct">({Math.round((drill.lineCorrect / drill.lineTotal) * 100)}%)</span>
				{/if}
			</span>
		</div>
	</div>
	<NextButton label="Next Line" onclick={drill.advanceToNextLine} />
</div>

<style>
	.line-complete-screen {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
</style>
