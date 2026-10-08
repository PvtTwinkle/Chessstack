<!--
	Drill → interstitial between lines in line mode.
-->
<script lang="ts">
	import DrillFeedback from './DrillFeedback.svelte';
	import NextButton from './NextButton.svelte';
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();

	// Build replays a comma-separated SAN list from the start (?line=e4,c5).
	const buildHref = $derived(
		`/build?line=${encodeURIComponent(drill.currentLine.map((s) => s.san).join(','))}`
	);
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
	<a href={buildHref} class="btn btn--secondary">Build from this line</a>
</div>

<style>
	.line-complete-screen {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
</style>
