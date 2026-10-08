<!--
	Drill → after a correct move: grade buttons, or Next (and Undo) once the
	card is graded or when a hint was used.
-->
<script lang="ts">
	// Imported here so the shared .btn rules load before the .undo-btn overrides.
	import './drill-ui.css';
	import DrillFeedback from './DrillFeedback.svelte';
	import DrillLineDisplay from './DrillLineDisplay.svelte';
	import DrillNote from './DrillNote.svelte';
	import GradeButtons from './GradeButtons.svelte';
	import NextButton from './NextButton.svelte';
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

<DrillFeedback correct>{drill.hintUsed ? 'Correct! (hint used)' : 'Correct!'}</DrillFeedback>

<DrillLineDisplay navHistory={drill.navHistory} />

<!-- Note on the card's move (the user's annotation for this move) -->
{#if drill.currentMoveNote}
	<DrillNote text={drill.currentMoveNote} />
{/if}

{#if drill.hintUsed}
	<!-- Hint was used — will be graded Again when Next is clicked. -->
	<p class="auto-advance-hint">Will be graded as Forgot</p>
	<NextButton onclick={drill.handleNext} />
{:else if drill.awaitingNext}
	<!-- Already graded — show Next + Undo buttons. -->
	<div class="next-row">
		<NextButton onclick={drill.handleNext} />
		{#if drill.undoSnapshot}
			<button
				class="btn btn--ghost undo-btn"
				onclick={drill.undoLastGrade}
				disabled={drill.undoing}
			>
				Undo <kbd>Z</kbd>
			</button>
		{/if}
	</div>
{:else}
	<GradeButtons
		intervalLabels={drill.currentCard?.intervalLabels}
		disabled={drill.grading}
		onGrade={drill.submitGrade}
	/>
{/if}

<style>
	.auto-advance-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
		font-style: italic;
	}

	.next-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.undo-btn {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border-color: var(--color-border);
		color: var(--color-text-secondary);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.undo-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
	}

	.undo-btn kbd {
		font-size: 0.6rem;
		opacity: 0.5;
	}
</style>
