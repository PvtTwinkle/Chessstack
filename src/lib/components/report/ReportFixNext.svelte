<!--
	Opening Report → "Fix this next": the one exit or forgotten move that has
	cost the most, with the board and a single button to fix it.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { drillHereUrl } from '$lib/components/build/buildView';
	import { toFullFen } from '$lib/fen';
	import type { ReportFixNext } from '$lib/server/report';
	import { buildLineUrl, formatScore, moveLabel, plural } from './reportFormat';

	let {
		fix,
		weeks,
		orientation,
		boardTheme
	}: {
		fix: ReportFixNext;
		weeks: number;
		orientation: 'white' | 'black';
		boardTheme?: string;
	} = $props();

	const fen = $derived(fix.kind === 'DRILL_CARD' ? fix.card.fromFen : fix.exit.fen);
</script>

<section class="fix" aria-labelledby="fix-heading">
	<div class="board">
		<ChessBoard fen={toFullFen(fen)} {orientation} {boardTheme} interactive={false} />
	</div>
	<div class="info">
		<h2 id="fix-heading">Fix this next</h2>
		{#if fix.kind === 'DRILL_EXIT'}
			{@const exit = fix.exit}
			<p>
				You played <strong>{moveLabel(exit.line.length, exit.playedSan)}</strong> instead of
				<strong>{moveLabel(exit.line.length, exit.repertoireSan ?? '')}</strong> in
				{plural(exit.games, 'game')} and scored {formatScore(exit.score)}. Drilling the move fixes
				it for next time.
			</p>
			<a class="cta" href="{base}{drillHereUrl(exit.fen)}">Drill this move</a>
		{:else if fix.kind === 'PREPARE_REPLY'}
			{@const exit = fix.exit}
			<p>
				Opponents played <strong>{moveLabel(exit.line.length, exit.playedSan)}</strong> in
				{plural(exit.games, 'game')}, you scored {formatScore(exit.score)}, and your repertoire has
				no reply to it yet.
			</p>
			<a class="cta" href="{base}{buildLineUrl([...exit.line, exit.playedSan])}">Prepare a reply</a>
		{:else if fix.kind === 'DRILL_CARD'}
			{@const card = fix.card}
			<p>
				You missed <strong>{card.line ? moveLabel(card.line.length, card.san) : card.san}</strong>
				{plural(card.misses, 'time')} in {plural(card.grades, 'review')} over the last {weeks}
				weeks.
			</p>
			<a class="cta" href="{base}{drillHereUrl(card.fromFen)}">Drill this move</a>
		{/if}
	</div>
</section>

<style>
	.fix {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		background: var(--color-surface);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-lg);
		padding: var(--space-5) var(--space-4);
		box-shadow: var(--glow-accent);
	}

	.board {
		flex: 0 0 160px;
		width: 160px;
	}

	.info {
		flex: 1;
		min-width: 0;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 1rem;
		color: var(--color-text-primary);
	}

	p {
		margin: 0 0 var(--space-3);
		font-size: 14px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	strong {
		color: var(--color-text-primary);
	}

	.cta {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: var(--color-base);
		font-weight: 600;
		font-size: 13px;
		text-decoration: none;
	}

	.cta:hover {
		background: var(--color-accent-dim);
	}

	/* Stack the board above the text on narrow phones. --bp-sm */
	@media (max-width: 479px) {
		.fix {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
