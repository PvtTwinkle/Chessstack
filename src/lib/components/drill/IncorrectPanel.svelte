<!--
	Drill → after a wrong move: the correct answer, the move note, and Next.
-->
<script lang="ts">
	import DrillFeedback from './DrillFeedback.svelte';
	import DrillNote from './DrillNote.svelte';
	import NextButton from './NextButton.svelte';
	import RevealedMove from './RevealedMove.svelte';
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

<DrillFeedback correct={false}>Incorrect</DrillFeedback>

{#if drill.revealedSan}
	<RevealedMove san={drill.revealedSan} />
{/if}

<!-- Note on the card's move (the user's annotation for this move) -->
{#if drill.currentMoveNote}
	<DrillNote text={drill.currentMoveNote} />
{/if}

<p class="auto-advance-hint">Will be graded as Forgot</p>
<NextButton onclick={drill.handleNext} />

<style>
	.auto-advance-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
		font-style: italic;
	}
</style>
