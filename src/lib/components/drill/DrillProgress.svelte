<!--
	Drill → progress through the session: "Card X of N", or "Line X of N" with
	the move count inside the current line.
-->
<script lang="ts">
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

{#if drill.drillType === 'card'}
	<div class="progress-section">
		<div class="progress-label">
			Card {Math.min(drill.currentCardIdx + 1, drill.filteredCards.length)} of {drill.filteredCards
				.length}
		</div>
		<div class="progress-bar">
			<div class="progress-fill" style="width: {drill.progress * 100}%"></div>
		</div>
	</div>
{:else}
	<div class="progress-section">
		<div class="progress-label">
			Line {Math.min(drill.currentLineIdx + 1, drill.allLines.length)} of {drill.allLines.length}
		</div>
		<div class="progress-bar">
			<div
				class="progress-fill"
				style="width: {(drill.currentLineIdx / drill.allLines.length) * 100}%"
			></div>
		</div>
		{#if drill.currentLine.length > 0 && !drill.lineComplete}
			<div class="progress-sub">
				Move {Math.min(drill.lineStepIdx + 1, drill.lineTotal)} of {drill.lineTotal} in this line
			</div>
		{/if}
	</div>
{/if}

<style>
	.progress-section {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		box-shadow: var(--shadow-surface);
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

	.progress-sub {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-top: 0.15rem;
	}
</style>
