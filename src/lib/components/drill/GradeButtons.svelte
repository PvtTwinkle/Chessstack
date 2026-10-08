<!--
	Drill → Forgot / Unsure / Easy buttons with the resulting review intervals.
	Ratings are the FSRS grades: 1 = Again ("Forgot"), 3 = Good ("Unsure"), 4 = Easy.
	(The 1/2/3 keyboard shortcuts are handled by the page.)
-->
<script lang="ts">
	import type { DueCard } from '$lib/drill/types';

	let {
		intervalLabels,
		disabled,
		onGrade
	}: {
		intervalLabels: DueCard['intervalLabels'] | undefined;
		disabled: boolean;
		onGrade: (rating: number) => void;
	} = $props();
</script>

<div class="section">
	<div class="section-label">HOW CONFIDENT WAS YOUR RESPONSE?</div>
	<div class="grade-buttons">
		<button class="grade-btn grade-btn--forgot" onclick={() => onGrade(1)} {disabled}>
			<span class="grade-label">Forgot</span>
			{#if intervalLabels}
				<span class="grade-interval">{intervalLabels.forgot}</span>
			{/if}
		</button>
		<button class="grade-btn grade-btn--unsure" onclick={() => onGrade(3)} {disabled}>
			<span class="grade-label">Unsure</span>
			{#if intervalLabels}
				<span class="grade-interval">{intervalLabels.unsure}</span>
			{/if}
		</button>
		<button class="grade-btn grade-btn--easy" onclick={() => onGrade(4)} {disabled}>
			<span class="grade-label">Easy</span>
			{#if intervalLabels}
				<span class="grade-interval">{intervalLabels.easy}</span>
			{/if}
		</button>
	</div>
	<div class="shortcut-hints">
		<span class="shortcut"><kbd>1</kbd> Forgot</span>
		<span class="shortcut"><kbd>2</kbd> Unsure</span>
		<span class="shortcut"><kbd>3</kbd> Easy</span>
	</div>
</div>

<style>
	/* ── Keyboard shortcut hints ──────────────────────────────────────────────── */

	.shortcut-hints {
		display: flex;
		gap: var(--space-4);
		margin-top: var(--space-2);
	}

	.shortcut {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	/* ── Grading buttons ──────────────────────────────────────────────────────── */

	.grade-buttons {
		display: flex;
		gap: var(--space-2);
	}

	.grade-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--space-3) var(--space-2);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		font-size: 0.8rem;
		font-family: var(--font-body);
		font-weight: 700;
		cursor: pointer;
		transition: filter var(--dur-fast) var(--ease-snap);
	}

	.grade-interval {
		font-size: 0.65rem;
		font-weight: 500;
		opacity: 0.75;
	}

	.grade-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.grade-btn:not(:disabled):hover {
		filter: brightness(1.15);
	}

	.grade-btn--forgot {
		background: rgba(248, 113, 113, 0.18);
		border-color: rgba(248, 113, 113, 0.45);
		color: var(--color-danger);
	}

	.grade-btn--unsure {
		background: rgba(91, 127, 164, 0.15);
		border-color: rgba(91, 127, 164, 0.4);
		color: var(--color-accent);
	}

	.grade-btn--easy {
		background: rgba(74, 222, 128, 0.18);
		border-color: rgba(74, 222, 128, 0.45);
		color: var(--color-success);
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.grade-btn {
			min-height: 44px;
			padding: var(--space-2);
		}

		.grade-buttons {
			gap: var(--space-1);
		}
	}
</style>
