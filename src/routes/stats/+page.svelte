<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// ── Deck Composition donut (pure CSS conic-gradient, no chart library) ─
	const composition = $derived(data.deckComposition);
	const donutGradient = $derived.by(() => {
		const { new_, youngLearning, mature, total } = composition;
		if (total === 0) return 'var(--color-border)';
		const newPct = (new_ / total) * 100;
		const youngPct = (youngLearning / total) * 100;
		// mature takes the remainder up to 100%, avoids rounding gaps.
		return (
			`conic-gradient(` +
			`var(--color-text-muted) 0% ${newPct}%, ` +
			`var(--color-accent-dim) ${newPct}% ${newPct + youngPct}%, ` +
			`var(--color-success) ${newPct + youngPct}% 100%)`
		);
	});

	// ── Workload forecast bars ──────────────────────────────────────────
	const forecast = $derived(data.forecast);
	const maxForecastDay = $derived.by(() => {
		let max = 1; // avoid divide-by-zero
		for (const d of forecast) {
			const t = d.mature + d.youngLearning;
			if (t > max) max = t;
		}
		return max;
	});

	function dayLabel(offset: number): string {
		if (offset === 0) return 'Today';
		if (offset === 1) return 'Tomorrow';
		const d = new Date();
		d.setUTCDate(d.getUTCDate() + offset);
		return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
	}

	// ── True retention ──────────────────────────────────────────────────
	const retention = $derived(data.retention);
	const retentionDiffClass = $derived.by(() => {
		if (retention.observedRetention === null) return '';
		const diff = retention.observedRetention - retention.targetRetention;
		if (diff >= -0.03) return 'ret-good'; // within 3pts of target or above
		if (diff >= -0.1) return 'ret-warn';
		return 'ret-bad';
	});
</script>

<div class="page-wrapper">
	<h1>Stats</h1>

	{#if composition.total === 0}
		<p class="empty-state">No cards yet — add moves to a repertoire to see stats here.</p>
	{:else}
		<div class="widget-grid">
			<!-- Deck Composition -->
			<div class="widget widget-wide">
				<div class="widget-label">Deck Composition</div>
				<div class="donut-row">
					<div class="donut" style="background: {donutGradient}"></div>
					<div class="donut-legend">
						<span class="legend-item">
							<span class="legend-dot" style="background: var(--color-text-muted)"></span>
							New — {composition.new_}
						</span>
						<span class="legend-item">
							<span class="legend-dot" style="background: var(--color-accent-dim)"></span>
							Young + Learning — {composition.youngLearning}
						</span>
						<span class="legend-item">
							<span class="legend-dot" style="background: var(--color-success)"></span>
							Mature — {composition.mature}
						</span>
					</div>
				</div>
				<p class="widget-note">
					Mature = interval &gt; 21 days (Anki's convention). This differs from the dashboard's
					"mastered" count, which only tracks FSRS state, not interval length.
				</p>
			</div>

			<!-- Workload Forecast -->
			<div class="widget widget-wide">
				<div class="widget-label">Workload — Next 14 Days</div>
				<div class="forecast-row">
					{#each forecast as day (day.dayOffset)}
						<div class="forecast-col" title="{dayLabel(day.dayOffset)}: {day.mature + day.youngLearning} due">
							<div class="forecast-bar">
								<div
									class="forecast-segment forecast-mature"
									style="height: {(day.mature / maxForecastDay) * 100}%"
								></div>
								<div
									class="forecast-segment forecast-young"
									style="height: {(day.youngLearning / maxForecastDay) * 100}%"
								></div>
							</div>
							<span class="forecast-label">{dayLabel(day.dayOffset)}</span>
						</div>
					{/each}
				</div>
				<div class="trend-legend">
					<span class="legend-item"
						><span class="legend-dot" style="background: var(--color-success)"></span> Mature</span
					>
					<span class="legend-item"
						><span class="legend-dot" style="background: var(--color-accent-dim)"></span> Young + Learning</span
					>
				</div>
				<p class="widget-note">
					Based on each card's currently scheduled due date — not a simulation of how you'll
					grade it when it comes up.
				</p>
			</div>

			<!-- True Retention -->
			<div class="widget widget-wide">
				<div class="widget-label">True Retention</div>
				{#if retention.totalReviews === 0}
					<p class="widget-empty">
						No graded reviews logged yet. This starts accumulating from your first drill session
						after this feature was deployed — nothing before that can be reconstructed.
					</p>
				{:else}
					<div class="retention-row">
						<span class="retention-value {retentionDiffClass}"
							>{Math.round((retention.observedRetention ?? 0) * 100)}%</span
						>
						<span class="retention-target">target {Math.round(retention.targetRetention * 100)}%</span>
					</div>
					<p class="widget-note">
						{retention.successCount} of {retention.totalReviews} reviews graded Good/Easy
						{#if retention.since}
							since {new Date(retention.since * 1000).toLocaleDateString()}
						{/if}
						.
						{#if retention.totalReviews < 100}
							Still an early sample — this becomes more reliable as more reviews accumulate.
						{/if}
					</p>
				{/if}
			</div>

			<!-- Per-Opening Stats -->
			<div class="widget widget-wide">
				<div class="widget-label">Trouble by Opening</div>
				{#if data.openingStats.length === 0}
					<p class="widget-empty">No lapses recorded yet — nothing to concentrate on.</p>
				{:else}
					<ul class="opening-list">
						{#each data.openingStats as o (o.name ?? 'unclassified')}
							<li class="opening-item">
								<span class="opening-name">
									{#if o.code}<span class="opening-code">{o.code}</span>{/if}
									{o.name ?? 'Unclassified position'}
								</span>
								<span class="opening-lapses"
									>{o.totalLapses} lapse{o.totalLapses === 1 ? '' : 's'} across {o.totalCards} card{o.totalCards ===
									1
										? ''
										: 's'}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.page-wrapper {
		max-width: 1000px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
	}

	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-body);
		color: var(--color-text-primary);
	}

	.empty-state {
		color: var(--color-text-muted);
	}

	.widget-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-3);
	}

	.widget {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-5) var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	.widget-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-bottom: var(--space-3);
	}

	.widget-empty,
	.widget-note {
		color: var(--color-text-muted);
		font-size: 13px;
		margin: var(--space-2) 0 0;
	}

	/* ── Deck Composition donut ──────────────────────────────────────── */

	.donut-row {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}

	.donut {
		width: 120px;
		height: 120px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.donut-legend {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.legend-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	/* ── Workload forecast ───────────────────────────────────────────── */

	.forecast-row {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		height: 120px;
	}

	.forecast-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1;
		height: 100%;
	}

	.forecast-bar {
		display: flex;
		flex-direction: column-reverse;
		width: 100%;
		height: 100%;
		border-radius: 3px 3px 0 0;
		overflow: hidden;
	}

	.forecast-segment {
		width: 100%;
	}

	.forecast-mature {
		background: var(--color-success);
	}

	.forecast-young {
		background: var(--color-accent-dim);
	}

	.forecast-label {
		font-size: 10px;
		color: var(--color-text-muted);
		margin-top: var(--space-1);
		white-space: nowrap;
	}

	.trend-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-2);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* ── True Retention ──────────────────────────────────────────────── */

	.retention-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.retention-value {
		font-size: 32px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.retention-value.ret-good {
		color: var(--color-success);
	}

	.retention-value.ret-warn {
		color: var(--color-accent-dim);
	}

	.retention-value.ret-bad {
		color: var(--color-danger);
	}

	.retention-target {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	/* ── Per-Opening Stats ───────────────────────────────────────────── */

	.opening-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.opening-item {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
	}

	.opening-item:last-child {
		border-bottom: none;
	}

	.opening-name {
		color: var(--color-text-primary);
	}

	.opening-code {
		color: var(--color-text-muted);
		margin-right: var(--space-1);
	}

	.opening-lapses {
		color: var(--color-text-muted);
		white-space: nowrap;
	}
</style>
