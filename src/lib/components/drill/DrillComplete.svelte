<!--
	Drill → end-of-session summary.
-->
<script lang="ts">
	import { formatNextSession } from '$lib/drill/drill-logic';

	let {
		drillType,
		totalReviewed,
		correctCount,
		linesDrilled,
		nextDueAt,
		onRestart
	}: {
		drillType: 'card' | 'line';
		totalReviewed: number;
		correctCount: number;
		linesDrilled: number;
		nextDueAt: string | null;
		onRestart: () => void;
	} = $props();
</script>

<div class="complete-screen">
	<div class="complete-title">Session complete</div>
	<div class="complete-stats">
		<div class="stat-row">
			<span class="stat-label">{drillType === 'line' ? 'Moves reviewed' : 'Cards reviewed'}</span>
			<span class="stat-value">{totalReviewed}</span>
		</div>
		<div class="stat-row">
			<span class="stat-label">Correct first try</span>
			<span class="stat-value">
				{correctCount}
				{#if totalReviewed > 0}
					<span class="stat-pct">({Math.round((correctCount / totalReviewed) * 100)}%)</span>
				{/if}
			</span>
		</div>
		{#if drillType === 'line'}
			<div class="stat-row">
				<span class="stat-label">Lines drilled</span>
				<span class="stat-value">{linesDrilled}</span>
			</div>
		{/if}
		<div class="stat-row">
			<span class="stat-label">Next session</span>
			<span class="stat-value">
				{#if nextDueAt}
					{formatNextSession(nextDueAt)}
				{:else}
					—
				{/if}
			</span>
		</div>
	</div>
	<button class="btn btn--primary" onclick={onRestart}> Drill again </button>
	<a href="/" class="btn btn--secondary">Dashboard</a>
</div>

<style>
	/* ── Session complete screen ──────────────────────────────────────────────── */

	.complete-screen {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-2) 0;
	}

	.complete-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}
</style>
