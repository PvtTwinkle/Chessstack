// Wording and links for the Opening Report page, kept out of the components
// so they can be unit-tested.

import type { Outcome } from '$lib/report';
import type { ReportFixNext } from '$lib/server/report';

// A line is only worth judging once it has a few games: 2 results say nothing.
export const MIN_LINE_GAMES = 5;

/** "6.Bg5" or "6...e5" for the move played after `pliesBefore` plies. */
export function moveLabel(pliesBefore: number, san: string): string {
	const number = Math.floor(pliesBefore / 2) + 1;
	return pliesBefore % 2 === 0 ? `${number}.${san}` : `${number}...${san}`;
}

/** 0.375 → "38%"; no scored games → "–". */
export function formatScore(score: number | null): string {
	return score === null ? '–' : `${Math.round(score * 100)}%`;
}

/** Plies in book as full moves, e.g. 9 → "4.5". */
export function formatMovesInBook(plies: number | null): string {
	return plies === null ? '–' : (plies / 2).toFixed(1);
}

export function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function outcomeLabel(outcome: Outcome | null): string {
	if (outcome === 'WIN') return 'Won';
	if (outcome === 'DRAW') return 'Drew';
	if (outcome === 'LOSS') return 'Lost';
	return 'No result';
}

/** Build replays a comma-separated SAN list from the start (?line=e4,c5). */
export function buildLineUrl(line: string[]): string {
	return `/build?line=${encodeURIComponent(line.join(','))}`;
}

/** One line for the dashboard tile, e.g. "You played 2.Bc4 instead of 2.Nf3 in 2 games". */
export function fixNextHeadline(fix: ReportFixNext): string {
	if (fix.kind === 'DRILL_CARD') {
		const { card } = fix;
		const move = card.line ? moveLabel(card.line.length, card.san) : card.san;
		return `You missed ${move} in ${card.misses} of ${plural(card.grades, 'review')}`;
	}
	const { exit } = fix;
	const played = moveLabel(exit.line.length, exit.playedSan);
	if (fix.kind === 'PREPARE_REPLY') {
		return `Opponents played ${played} in ${plural(exit.games, 'game')} and you have no reply yet`;
	}
	const expected = moveLabel(exit.line.length, exit.repertoireSan ?? '');
	return `You played ${played} instead of ${expected} in ${plural(exit.games, 'game')}`;
}
