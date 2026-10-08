<!--
	Review → the body of a DEVIATION issue card: engine evals for the played
	and book moves, plus a collapsible list of the top Masters moves.
-->
<script lang="ts">
	import type { GameIssue } from '$lib/pgn';
	import type { ReviewState } from './reviewState.svelte';

	let { review, issue }: { review: ReviewState; issue: GameIssue } = $props();

	const ev = $derived(review.deviationEvals.get(issue.ply));
</script>

<div class="eval-compare">
	<div class="eval-row">
		<span class="eval-label">Played</span>
		<strong class="eval-san">{issue.playedSan}</strong>
		{#if ev?.played != null}
			<span class="eval-badge {review.evalBadgeClass(ev.played)}"
				>{review.formatEval(ev.played)}</span
			>
		{:else}
			<span class="eval-badge eval-loading">…</span>
		{/if}
	</div>
	<div class="eval-row">
		<span class="eval-label">Book</span>
		<strong class="eval-san">{issue.repertoireSan}</strong>
		{#if ev?.correct != null}
			<span class="eval-badge {review.evalBadgeClass(ev.correct)}"
				>{review.formatEval(ev.correct)}</span
			>
		{:else}
			<span class="eval-badge eval-loading">…</span>
		{/if}
	</div>
</div>
<button type="button" class="masters-toggle" onclick={() => review.toggleMasters(issue)}>
	{review.deviationMastersExpanded.has(issue.ply) ? '▾' : '▸'} Masters
</button>
{#if review.deviationMastersExpanded.has(issue.ply)}
	{@const masters = review.deviationMasters.get(issue.ply)}
	{@const mLoading = review.deviationMastersLoading.get(issue.ply)}
	{@const mError = review.deviationMastersError.get(issue.ply)}
	{#if mLoading}
		<div class="masters-inline-loading">Loading masters…</div>
	{:else if mError}
		<div class="masters-inline-error">Masters unavailable</div>
	{:else if masters && masters.length > 0}
		<div class="masters-mini-list">
			{#each masters as m (m.san)}
				{@const winPct = m.totalGames > 0 ? (m.white / m.totalGames) * 100 : 0}
				{@const drawPct = m.totalGames > 0 ? (m.draws / m.totalGames) * 100 : 0}
				{@const lossPct = m.totalGames > 0 ? (m.black / m.totalGames) * 100 : 0}
				<div class="masters-mini-row">
					<span
						class="masters-mini-san"
						class:masters-mini-highlight={m.san === issue.playedSan}
						class:masters-mini-book={m.san === issue.repertoireSan}>{m.san}</span
					>
					<div class="wdl-bar-mini">
						<div class="wdl-w" style="width: {winPct}%"></div>
						<div class="wdl-d" style="width: {drawPct}%"></div>
						<div class="wdl-b" style="width: {lossPct}%"></div>
					</div>
					<span class="masters-mini-count">{m.totalGames.toLocaleString()}</span>
				</div>
			{/each}
		</div>
	{:else if masters}
		<div class="masters-inline-error">No master games here</div>
	{/if}
{/if}

<style>
	/* ── Eval comparison ────────────────────────────────────────────────────── */

	.eval-compare {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.eval-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.eval-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		width: 2.8rem;
		flex-shrink: 0;
	}

	.eval-san {
		font-size: 0.82rem;
		color: var(--color-text-primary);
		min-width: 2.5rem;
	}

	.eval-badge {
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		margin-left: auto;
	}

	.eval-badge-good {
		color: var(--color-success);
		background: rgba(74, 222, 128, 0.12);
	}

	.eval-badge-bad {
		color: var(--color-danger);
		background: rgba(248, 113, 113, 0.12);
	}

	.eval-badge-neutral {
		color: var(--color-text-muted);
		background: rgba(112, 112, 128, 0.12);
	}

	.eval-loading {
		color: var(--color-text-muted);
	}

	/* ── Masters toggle + mini-list ────────────────────────────────────────── */

	.masters-toggle {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.7rem;
		font-family: var(--font-body);
		cursor: pointer;
		padding: var(--space-1) 0;
		text-align: left;
	}

	.masters-toggle:hover {
		color: var(--color-accent);
	}

	.masters-mini-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-left: var(--space-2);
	}

	.masters-mini-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.masters-mini-san {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		min-width: 2.2rem;
	}

	.masters-mini-highlight {
		color: var(--color-accent-dim);
	}

	.masters-mini-book {
		color: var(--color-success);
	}

	.wdl-bar-mini {
		display: flex;
		height: 3px;
		border-radius: 1.5px;
		overflow: hidden;
		flex: 1;
		min-width: 60px;
	}

	.wdl-w {
		background: var(--color-success);
	}

	.wdl-d {
		background: var(--color-text-muted);
	}

	.wdl-b {
		background: var(--color-danger);
	}

	.masters-mini-count {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		min-width: 2rem;
		text-align: right;
	}

	.masters-inline-loading,
	.masters-inline-error {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-style: italic;
		padding-left: var(--space-2);
	}
</style>
