<!--
	Review → confirmation shown after a review is saved.
-->
<script lang="ts">
	import type { GameAnalysis } from '$lib/pgn';

	let {
		analysis,
		resolvedCount,
		onReviewAnother
	}: {
		analysis: GameAnalysis | null;
		/** How many of the analysis issues the user resolved before saving. */
		resolvedCount: number;
		onReviewAnother: () => void;
	} = $props();
</script>

<div class="saved-page">
	<div class="saved-card">
		<div class="saved-icon">✓</div>
		<h2 class="saved-title">Review saved</h2>
		{#if analysis && analysis.issues.length === 0}
			<p class="saved-subtitle">Your opening was perfectly on book.</p>
		{:else if analysis}
			<p class="saved-subtitle">
				{resolvedCount} of {analysis.issues.length}
				issue{analysis.issues.length !== 1 ? 's' : ''} resolved.
			</p>
		{/if}
		<div class="saved-actions">
			<button class="btn btn--primary" onclick={onReviewAnother}>Review another game</button>
			<a href="/drill" class="btn btn--secondary">Drill mode</a>
			<a href="/build" class="btn btn--secondary">Build mode</a>
		</div>
	</div>
</div>

<style>
	/* ── Saved page ─────────────────────────────────────────────────────────── */

	.saved-page {
		display: flex;
		justify-content: center;
		padding: var(--space-12) var(--space-4);
	}

	.saved-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		text-align: center;
		max-width: 380px;
	}

	.saved-icon {
		font-size: 2.5rem;
		color: var(--color-success);
	}

	.saved-title {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-body);
		margin: 0;
	}

	.saved-subtitle {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.saved-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}
</style>
