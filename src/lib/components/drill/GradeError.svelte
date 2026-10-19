<!--
	Drill → a grade that couldn't be saved: the reason, and a way to move on
	without it (the card stays due). Retrying is the button that sent it.
-->
<script lang="ts">
	import './drill-ui.css';
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

{#if drill.gradeError}
	<div class="grade-error" role="alert">
		<p>{drill.gradeError}</p>
		<button class="btn btn--secondary" onclick={drill.skipFailedGrades} disabled={drill.grading}>
			{drill.drillType === 'line' ? 'Continue without saving' : 'Skip this card'}
		</button>
	</div>
{/if}

<style>
	.grade-error {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		color: var(--color-text-primary);
	}

	.grade-error p {
		margin: 0;
	}
</style>
