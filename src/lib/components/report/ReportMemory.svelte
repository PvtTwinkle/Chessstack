<!--
	Opening Report → "Your memory": how often the user remembers this
	repertoire's moves (drill grades plus deviations found in Review), week by
	week, and the moves they forget most.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { drillHereUrl } from '$lib/components/build/buildView';
	import { toFullFen } from '$lib/fen';
	import type { OpeningReport } from '$lib/server/report';
	import { formatScore, moveLabel, plural } from './reportFormat';

	let {
		memory,
		orientation,
		boardTheme
	}: {
		memory: OpeningReport['memory'];
		orientation: 'white' | 'black';
		boardTheme?: string;
	} = $props();

	function weekLabel(d: Date): string {
		return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

{#if memory.grades === 0}
	<p class="empty">
		No drills in the last {memory.weeks} weeks. <a href="{base}/drill">Drill this repertoire</a> and this
		section shows which moves stick.
	</p>
{:else}
	<div class="headline">
		<div>
			<span class="value">{formatScore(memory.retention)}</span>
			<span class="label">
				of {plural(memory.grades, 'review')} remembered in the last {memory.weeks} weeks
			</span>
		</div>
		<ol class="weeks" aria-label="Share remembered each week, oldest first">
			{#each memory.weekly as week (week.weekStart)}
				<li
					class="week"
					class:none={week.retention === null}
					title="Week of {weekLabel(week.weekStart)}: {week.retention === null
						? 'no reviews'
						: `${formatScore(week.retention)} of ${plural(week.grades, 'review')}`}"
				>
					<span class="bar" style="height: {Math.max(4, (week.retention ?? 0) * 100)}%"></span>
					<span class="visually-hidden">
						Week of {weekLabel(week.weekStart)}: {week.retention === null
							? 'no reviews'
							: formatScore(week.retention)}
					</span>
				</li>
			{/each}
		</ol>
	</div>

	{#if memory.forgotten.length > 0}
		<h3>Moves you forget most</h3>
		<ul class="forgotten">
			{#each memory.forgotten as card (card.cardId)}
				<li>
					<div class="board">
						<ChessBoard
							fen={toFullFen(card.fromFen)}
							{orientation}
							{boardTheme}
							interactive={false}
						/>
					</div>
					<div class="info">
						<p>
							<strong>{card.line ? moveLabel(card.line.length, card.san) : card.san}</strong>
						</p>
						<p class="misses">Missed {card.misses} of {plural(card.grades, 'review')}</p>
						<a href="{base}{drillHereUrl(card.fromFen)}">Drill this</a>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.empty {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.headline {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	.value {
		display: block;
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.label {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.weeks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 48px;
	}

	.week {
		display: flex;
		align-items: flex-end;
		width: 8px;
		height: 100%;
		background: var(--color-surface-alt);
		border-radius: 2px;
	}

	.bar {
		display: block;
		width: 100%;
		background: var(--color-accent);
		border-radius: 2px;
	}

	.week.none .bar {
		background: transparent;
	}

	h3 {
		margin: 0 0 var(--space-3);
		font-size: 0.9rem;
		color: var(--color-text-primary);
	}

	.forgotten {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: var(--space-4);
	}

	.board {
		width: 100%;
		max-width: 140px;
	}

	.info {
		margin-top: var(--space-2);
		font-size: 13px;
	}

	.info p {
		margin: 0;
		color: var(--color-text-primary);
	}

	.info .misses {
		color: var(--color-text-muted);
		font-size: 12px;
		margin-bottom: var(--space-1);
	}

	a {
		color: var(--color-accent);
	}

	/* The link inside the empty-state sentence keeps its underline: colour
	   alone doesn't set it apart from the text around it (axe link-in-text-block). */
	.forgotten a {
		text-decoration: none;
	}

	a:hover {
		color: var(--color-text-primary);
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
