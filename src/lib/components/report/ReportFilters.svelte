<!--
	Opening Report → period, speed and rated filters. A plain GET form, so the
	filters live in the URL; changing one submits it straight away.
-->
<script lang="ts">
	import type { ReportFilters } from '$lib/report/filters';

	let { filters }: { filters: ReportFilters } = $props();

	const periods = [
		{ value: '30', label: 'Last 30 days' },
		{ value: '90', label: 'Last 90 days' },
		{ value: 'all', label: 'All time' }
	];
	const speeds = [
		{ value: 'all', label: 'All speeds' },
		{ value: 'bullet', label: 'Bullet' },
		{ value: 'blitz', label: 'Blitz' },
		{ value: 'rapid', label: 'Rapid' },
		{ value: 'classical', label: 'Classical' },
		{ value: 'daily', label: 'Daily' }
	];

	function submit(e: Event) {
		(e.currentTarget as HTMLFormElement).requestSubmit();
	}
</script>

<form
	class="filters"
	method="GET"
	data-sveltekit-keepfocus
	data-sveltekit-noscroll
	onchange={submit}
>
	<label>
		<span class="visually-hidden">Period</span>
		<select name="period" value={filters.period}>
			{#each periods as p (p.value)}
				<option value={p.value}>{p.label}</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="visually-hidden">Speed</span>
		<select name="speed" value={filters.speed}>
			{#each speeds as s (s.value)}
				<option value={s.value}>{s.label}</option>
			{/each}
		</select>
	</label>
	<label class="rated">
		<input type="checkbox" name="rated" value="1" checked={filters.ratedOnly} />
		Rated only
	</label>
</form>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}

	select {
		background: var(--color-surface);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-2);
		font: inherit;
		font-size: 13px;
	}

	.rated {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 13px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
