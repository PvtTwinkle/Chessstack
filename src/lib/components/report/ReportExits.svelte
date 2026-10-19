<!--
	Opening Report → "Where you leave book": the most common exits of one kind,
	each with the position, what happened, the score after it and its games.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { drillHereUrl } from '$lib/components/build/buildView';
	import { toFullFen } from '$lib/fen';
	import type { ReportExit } from '$lib/server/report';
	import { buildLineUrl, formatScore, moveLabel, outcomeLabel, plural } from './reportFormat';

	let {
		kind,
		exits,
		orientation,
		boardTheme
	}: {
		kind: 'YOU_LEFT' | 'THEY_LEFT' | 'PREP_ENDED';
		exits: ReportExit[];
		orientation: 'white' | 'black';
		boardTheme?: string;
	} = $props();

	function date(d: Date | null): string {
		return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
	}
</script>

<ul class="exits">
	{#each exits as exit (exit.fen + exit.playedSan)}
		{@const played = moveLabel(exit.line.length, exit.playedSan)}
		<li class="exit">
			<div class="board">
				<ChessBoard fen={toFullFen(exit.fen)} {orientation} {boardTheme} interactive={false} />
			</div>
			<div class="info">
				<p class="what">
					{#if kind === 'YOU_LEFT'}
						You played <strong>{played}</strong> here in {plural(exit.games, 'game')}; your
						repertoire says
						<strong>{moveLabel(exit.line.length, exit.repertoireSan ?? '')}</strong>.
					{:else if kind === 'THEY_LEFT'}
						Opponents played <strong>{played}</strong> in {plural(exit.games, 'game')}, and you have
						no reply prepared.
					{:else}
						Your prep ends here, and you reached it in {plural(exit.games, 'game')} (you played
						<strong>{played}</strong>).
					{/if}
				</p>
				<p class="score">
					You scored <strong>{formatScore(exit.score)}</strong>
					({exit.wins} / {exit.draws} / {exit.losses})
				</p>
				<div class="actions">
					{#if kind === 'YOU_LEFT'}
						<a href="{base}{drillHereUrl(exit.fen)}">Drill this</a>
						<a href="{base}{buildLineUrl(exit.line)}">Open in Build</a>
					{:else if kind === 'THEY_LEFT'}
						<a href="{base}{buildLineUrl([...exit.line, exit.playedSan])}">Prepare a reply</a>
					{:else}
						<a href="{base}{buildLineUrl(exit.line)}">Extend in Build</a>
					{/if}
				</div>
				<ul class="games">
					{#each exit.links as game (game.id)}
						<li>
							{#if game.importedGameId !== null}
								<a href="{base}/review?importedGameId={game.importedGameId}">
									{outcomeLabel(game.outcome)}{game.opponentName ? ` vs ${game.opponentName}` : ''}
								</a>
							{:else}
								{outcomeLabel(game.outcome)}{game.opponentName ? ` vs ${game.opponentName}` : ''}
							{/if}
							<span class="date">{date(game.playedAt)}</span>
						</li>
					{/each}
				</ul>
			</div>
		</li>
	{/each}
</ul>

<style>
	.exits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.exit {
		display: flex;
		gap: var(--space-4);
		align-items: flex-start;
	}

	.board {
		flex: 0 0 160px;
		width: 160px;
	}

	.info {
		flex: 1;
		min-width: 0;
		font-size: 13px;
	}

	.info p {
		margin: 0 0 var(--space-1);
		line-height: 1.5;
	}

	.what {
		color: var(--color-text-primary);
	}

	.score {
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: var(--space-2) 0;
	}

	a {
		color: var(--color-accent);
		text-decoration: none;
	}

	a:hover {
		color: var(--color-text-primary);
	}

	.games {
		list-style: none;
		margin: 0;
		padding: 0;
		color: var(--color-text-secondary);
		font-size: 12px;
	}

	.date {
		color: var(--color-text-muted);
		margin-left: var(--space-1);
	}

	/* Stack the board above the text on narrow phones. --bp-sm */
	@media (max-width: 479px) {
		.exit {
			flex-direction: column;
		}
	}
</style>
