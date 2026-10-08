<!--
	RatingSetup — first-visit prompt to pick a starting trainer rating.
-->

<script lang="ts">
	import type { TrainState } from './trainState.svelte';

	let { s }: { s: TrainState } = $props();
</script>

<div class="rating-setup">
	<div class="section-label">Set Your Starting Rating</div>
	<p class="setup-desc">
		Choose a starting rating for the opening trainer. This will update based on your performance in
		rated sessions. You can change it later in Settings.
	</p>
	<div class="rating-input-row">
		<input type="number" class="rating-input" min="100" max="3000" bind:value={s.initialRating} />
		<button class="btn btn-primary" onclick={s.saveInitialRating}>Set Rating</button>
	</div>
</div>

<style>
	/* ── Rating setup (first visit) ──────────────────────────────────────────── */

	.rating-setup {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-accent);
		background: rgba(91, 127, 164, 0.06);
	}

	.rating-input-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.rating-input {
		width: 100px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
		font-family: var(--font-body);
	}
</style>
