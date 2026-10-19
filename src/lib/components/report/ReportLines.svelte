<!--
	Opening Report → "Your lines": one row per named opening line the user
	reached, with their score and the most common way the line leaves book.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { drillHereUrl } from '$lib/components/build/buildView';
	import type { LineSummary } from '$lib/report';
	import {
		MIN_LINE_GAMES,
		buildLineUrl,
		formatMovesInBook,
		formatScore,
		moveLabel
	} from './reportFormat';

	let { lines }: { lines: LineSummary[] } = $props();

	const exitWords = { YOU_LEFT: 'you played', THEY_LEFT: 'they played', PREP_ENDED: 'prep ends' };
</script>

{#snippet links(line: LineSummary)}
	<a href="{base}{drillHereUrl(line.fen)}">Drill</a>
	<a href="{base}{buildLineUrl(line.line)}">Build</a>
{/snippet}

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th scope="col">Line</th>
				<th scope="col" class="num">Games</th>
				<th scope="col" class="num wide">W / D / L</th>
				<th scope="col" class="num">Score</th>
				<th scope="col" class="num wide">Moves in book</th>
				<th scope="col">Most common exit</th>
				<th scope="col" class="wide"><span class="visually-hidden">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#each lines as line (line.name ?? '')}
				{@const few = line.games < MIN_LINE_GAMES}
				<tr class:few>
					<th scope="row" class="line-name">
						{line.name ?? 'Unnamed line'}
						{#if few}<span class="few-note">too few games</span>{/if}
						<!-- Phones drop the actions column, so the links sit under the name. -->
						<span class="actions inline-actions">{@render links(line)}</span>
					</th>
					<td class="num">{line.games}</td>
					<td class="num wide">{line.wins} / {line.draws} / {line.losses}</td>
					<td class="num score">{few ? '–' : formatScore(line.score)}</td>
					<td class="num wide">{formatMovesInBook(line.averageDepth)}</td>
					<td class="exit">
						{#if line.topExit}
							{exitWords[line.topExit.kind]}
							{moveLabel(line.topExit.line.length, line.topExit.playedSan)}
							({line.topExit.games})
						{:else}
							–
						{/if}
					</td>
					<td class="actions wide">{@render links(line)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	th,
	td {
		padding: var(--space-2) var(--space-2);
		border-bottom: 1px solid var(--color-border);
		text-align: left;
		vertical-align: top;
	}

	thead th {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}

	.num {
		text-align: right;
		white-space: nowrap;
	}

	.line-name {
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.few td,
	.few .line-name {
		color: var(--color-text-muted);
	}

	.few-note {
		display: block;
		font-size: 11px;
		font-weight: 400;
	}

	.score {
		font-weight: 600;
	}

	.exit {
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.actions {
		white-space: nowrap;
	}

	.actions a {
		color: var(--color-accent);
		text-decoration: none;
		margin-left: var(--space-2);
	}

	.inline-actions {
		display: none;
		font-weight: 400;
		margin-top: var(--space-1);
	}

	.inline-actions a {
		margin: 0 var(--space-2) 0 0;
	}

	.actions a:hover {
		color: var(--color-text-primary);
	}

	/* Phones keep the columns that matter most. --bp-md */
	@media (max-width: 767px) {
		.wide {
			display: none;
		}

		.inline-actions {
			display: block;
		}

		.exit,
		thead th {
			white-space: normal;
		}
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
