<!--
	Opening Report — /report
	────────────────────────
	How the active repertoire holds up in the user's imported and reviewed
	games: their score in each line, where games leave book, how well they
	remember the moves, and the one thing to fix next. The numbers
	come from +page.server.ts; the sections are components in
	$lib/components/report/.
-->

<script lang="ts">
	import { base } from '$app/paths';
	import ReportExits from '$lib/components/report/ReportExits.svelte';
	import ReportFilters from '$lib/components/report/ReportFilters.svelte';
	import ReportFixNext from '$lib/components/report/ReportFixNext.svelte';
	import ReportLines from '$lib/components/report/ReportLines.svelte';
	import ReportMemory from '$lib/components/report/ReportMemory.svelte';
	import { formatMovesInBook, formatScore, plural } from '$lib/components/report/reportFormat';
	import { REPORT_GAME_LIMIT } from '$lib/report/filters';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const report = $derived(data.report);
	const totals = $derived(report.totals);
	const orientation = $derived(data.repertoire.color === 'WHITE' ? 'white' : 'black');
	const overallScore = $derived.by(() => {
		const scored = totals.wins + totals.draws + totals.losses;
		return scored ? (totals.wins + totals.draws / 2) / scored : null;
	});

	const exitSections = [
		{
			kind: 'YOU_LEFT',
			title: 'You left book',
			hint: 'Positions where you played something other than your repertoire move.'
		},
		{
			kind: 'THEY_LEFT',
			title: 'They left book',
			hint: 'Opponent moves your repertoire has no reply to yet.'
		},
		{
			kind: 'PREP_ENDED',
			title: 'Your prep ran out',
			hint: 'Positions you reach where your repertoire has no move.'
		}
	] as const;
</script>

<svelte:head>
	<title>Opening Report | Chessstack</title>
</svelte:head>

<div class="page-wrapper">
	<header class="page-header">
		<div>
			<h1>Opening Report</h1>
			<p class="subtitle">How {data.repertoire.name} holds up in your games</p>
		</div>
		<ReportFilters filters={data.filters} />
	</header>

	{#if report.fixNext}
		<ReportFixNext
			fix={report.fixNext}
			weeks={report.memory.weeks}
			{orientation}
			boardTheme={data.settings?.boardTheme}
		/>
	{/if}

	{#if totals.games === 0}
		<section class="panel empty">
			{#if !data.hasUsernames}
				<p class="empty-title">Bring in your games</p>
				<p class="empty-hint">
					Add your Lichess or Chess.com username in <a href="{base}/settings">Settings</a>, then
					fetch your games from the Import tab in <a href="{base}/review">Review</a>. The report
					shows how your repertoire holds up in them.
				</p>
			{:else}
				<p class="empty-title">No games for this repertoire yet</p>
				<p class="empty-hint">
					No games match these filters. Fetch your latest games from the Import tab in
					<a href="{base}/review">Review</a>, or widen the period.
				</p>
			{/if}
			{#if totals.otherRepertoire > 0}
				<p class="empty-hint">
					{plural(totals.otherRepertoire, 'game')} fit another of your {data.repertoire.color ===
					'WHITE'
						? 'White'
						: 'Black'} repertoires better. Switch repertoire to see them.
				</p>
			{/if}
		</section>
	{:else}
		<div class="summary">
			<div class="stat">
				<span class="stat-label">Games</span>
				<span class="stat-value">{totals.games}</span>
				<span class="stat-hint">{totals.wins} / {totals.draws} / {totals.losses}</span>
			</div>
			<div class="stat">
				<span class="stat-label">Score</span>
				<span class="stat-value">{formatScore(overallScore)}</span>
			</div>
			<div class="stat">
				<span class="stat-label">Moves in book</span>
				<span class="stat-value">{formatMovesInBook(totals.averageDepth)}</span>
				<span class="stat-hint">on average</span>
			</div>
		</div>

		<section class="panel">
			<h2>Your lines</h2>
			<ReportLines lines={report.lines} />
		</section>

		<section class="panel">
			<h2>Where you leave book</h2>
			{#each exitSections as section (section.kind)}
				{#if report.exits[section.kind].length > 0}
					<div class="exit-section">
						<h3>{section.title}</h3>
						<p class="section-hint">{section.hint}</p>
						<ReportExits
							kind={section.kind}
							exits={report.exits[section.kind]}
							{orientation}
							boardTheme={data.settings?.boardTheme}
						/>
					</div>
				{/if}
			{/each}
		</section>

		{#if totals.capped || totals.otherRepertoire > 0 || data.filters.ratedOnly}
			<p class="footnote">
				{#if totals.capped}
					Based on your newest {REPORT_GAME_LIMIT} games.
				{/if}
				{#if totals.otherRepertoire > 0}
					{plural(totals.otherRepertoire, 'other game')} fit another of your repertoires better.
				{/if}
				{#if data.filters.ratedOnly}
					Chess.com games always count, since they don't say whether they were rated.
				{/if}
			</p>
		{/if}
	{/if}

	<section class="panel">
		<h2>Your memory</h2>
		<ReportMemory memory={report.memory} {orientation} boardTheme={data.settings?.boardTheme} />
	</section>
</div>

<style>
	.page-wrapper {
		max-width: 960px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.page-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-end;
		gap: var(--space-3);
	}

	h1 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	.subtitle {
		margin: var(--space-1) 0 0;
		color: var(--color-text-muted);
		font-size: 13px;
	}

	h2 {
		margin: 0 0 var(--space-3);
		font-size: 1rem;
		color: var(--color-text-primary);
	}

	h3 {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-text-primary);
	}

	.panel {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-5) var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	.summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3);
	}

	.stat {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		box-shadow: var(--shadow-surface);
	}

	.stat-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.stat-value {
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.stat-hint,
	.section-hint,
	.footnote {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.exit-section + .exit-section {
		margin-top: var(--space-6);
	}

	.section-hint {
		margin: var(--space-1) 0 var(--space-3);
	}

	.footnote {
		margin: 0;
	}

	.empty {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.empty-title {
		margin: 0;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.empty-hint {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.empty a {
		color: var(--color-accent);
	}
</style>
