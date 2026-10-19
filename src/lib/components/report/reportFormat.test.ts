import { describe, expect, it } from 'vitest';
import {
	buildLineUrl,
	fixNextHeadline,
	formatMovesInBook,
	formatScore,
	moveLabel,
	outcomeLabel,
	plural
} from './reportFormat';

describe('reportFormat', () => {
	it('numbers moves from the plies before them', () => {
		expect(moveLabel(0, 'e4')).toBe('1.e4');
		expect(moveLabel(1, 'c5')).toBe('1...c5');
		expect(moveLabel(10, 'Bg5')).toBe('6.Bg5');
		expect(moveLabel(11, 'e5')).toBe('6...e5');
	});

	it('formats scores and moves in book', () => {
		expect(formatScore(0.375)).toBe('38%');
		expect(formatScore(null)).toBe('–');
		expect(formatMovesInBook(9)).toBe('4.5');
		expect(formatMovesInBook(null)).toBe('–');
	});

	it('words counts and outcomes', () => {
		expect(plural(1, 'game')).toBe('1 game');
		expect(plural(3, 'game')).toBe('3 games');
		expect(outcomeLabel('WIN')).toBe('Won');
		expect(outcomeLabel(null)).toBe('No result');
	});

	it('links a line into Build', () => {
		expect(buildLineUrl(['e4', 'c5', 'Nf3'])).toBe('/build?line=e4%2Cc5%2CNf3');
	});

	it('sums up the "Fix this next" pick in one line', () => {
		const exit = {
			fen: 'fen',
			playedSan: 'Bc4',
			repertoireSan: 'Nf3',
			line: ['e4', 'e5'],
			gameIds: [1, 2],
			games: 2,
			wins: 0,
			draws: 1,
			losses: 1,
			score: 0.25
		};
		expect(fixNextHeadline({ kind: 'DRILL_EXIT', exit: { ...exit, kind: 'YOU_LEFT' } })).toBe(
			'You played 2.Bc4 instead of 2.Nf3 in 2 games'
		);
		expect(
			fixNextHeadline({
				kind: 'PREPARE_REPLY',
				exit: { ...exit, kind: 'THEY_LEFT', line: ['e4'], playedSan: 'd5', repertoireSan: null }
			})
		).toBe('Opponents played 1...d5 in 2 games and you have no reply yet');
		const card = { cardId: 1, fromFen: 'fen', san: 'e4', misses: 2, grades: 3 };
		expect(fixNextHeadline({ kind: 'DRILL_CARD', card: { ...card, line: [] } })).toBe(
			'You missed 1.e4 in 2 of 3 reviews'
		);
		expect(fixNextHeadline({ kind: 'DRILL_CARD', card: { ...card, line: null } })).toBe(
			'You missed e4 in 2 of 3 reviews'
		);
	});
});
