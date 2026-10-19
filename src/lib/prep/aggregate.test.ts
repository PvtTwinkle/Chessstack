import { describe, expect, it } from 'vitest';
import { aggregateGames, isStandardGame, MAX_PLY } from './aggregate';
import { fenKey, STARTING_FEN } from '$lib/fen';

function pgn(white: string, black: string, moves: string, extra: Record<string, string> = {}) {
	const result = extra.Result ?? '1-0';
	const tags = { Event: 'Rated blitz game', White: white, Black: black, Result: result, ...extra };
	return (
		Object.entries(tags)
			.map(([k, v]) => `[${k} "${v}"]`)
			.join('\n') + `\n\n${moves} ${result}`
	);
}

const START = fenKey(STARTING_FEN);

describe('aggregateGames', () => {
	it('detects the opponent by name, case-insensitively, and counts their colours', () => {
		const r = aggregateGames(
			[pgn('Rival', 'me', '1. e4 e5'), pgn('me', 'RIVAL', '1. d4 d5'), pgn('a', 'b', '1. c4')],
			'rival'
		);
		expect(r.gamesAsWhite).toBe(1);
		expect(r.gamesAsBlack).toBe(1);
	});

	it('tallies games and results per move, from each position', () => {
		const r = aggregateGames(
			[
				pgn('rival', 'x', '1. e4 e5', { Result: '1-0' }),
				pgn('rival', 'y', '1. e4 c5', { Result: '0-1' }),
				pgn('rival', 'z', '1. e4 c5', { Result: '1/2-1/2' })
			],
			'rival'
		);
		const e4 = r.moves.find((m) => m.moveSan === 'e4')!;
		expect(e4).toMatchObject({
			positionFen: START,
			opponentColor: 'w',
			gamesPlayed: 3,
			whiteWins: 1,
			blackWins: 1,
			draws: 1
		});
		expect(e4.resultingFen.split(' ')[1]).toBe('b');
		expect(r.moves.find((m) => m.moveSan === 'c5')?.gamesPlayed).toBe(2);
	});

	it('keeps single-game moves only where the core tree reaches', () => {
		const r = aggregateGames(
			[
				pgn('rival', 'x', '1. e4 e5 2. Nf3'),
				pgn('rival', 'y', '1. e4 c5'),
				pgn('rival', 'z', '1. d4')
			],
			'rival'
		);
		// e4 was played twice; e5 and c5 continue from it. d4 (once, from the
		// start) is kept since the start is a core position; Nf3 follows e5,
		// which is not core, so it goes.
		expect(r.moves.map((m) => m.moveSan).sort()).toEqual(['c5', 'd4', 'e4', 'e5']);
	});

	it(`stops after ${MAX_PLY} plies`, () => {
		const shuffle = Array.from({ length: 20 }, (_, i) => {
			const n = i * 2 + 1;
			return `${n}. Nf3 Nf6 ${n + 1}. Ng1 Ng8`;
		}).join(' ');
		const games = [pgn('rival', 'x', shuffle), pgn('rival', 'y', shuffle)];
		const r = aggregateGames(games, 'rival');
		const total = r.moves.reduce((sum, m) => sum + m.gamesPlayed, 0);
		expect(total).toBe(MAX_PLY * 2);
	});

	it('skips variants and set-up positions without adding any of their moves', () => {
		const r = aggregateGames(
			[
				pgn('rival', 'x', '1. e4 e5', { Variant: 'Chess960', SetUp: '1', FEN: STARTING_FEN }),
				pgn('rival', 'x', '1. e4 e5', { Variant: 'King of the Hill' }),
				pgn('rival', 'x', '1. e4 e5', { Variant: 'Standard' }),
				pgn('rival', 'x', '1. e4 e5', { Variant: 'Standard' })
			],
			'rival'
		);
		expect(r.gamesAsWhite).toBe(2);
		expect(r.moves.find((m) => m.moveSan === 'e4')?.gamesPlayed).toBe(2);
	});

	it('adds nothing from a game that fails to parse partway', () => {
		const r = aggregateGames(
			[pgn('rival', 'x', '1. e4 e5 2. Ke3'), pgn('rival', 'x', '1. e4 e5 2. Ke3')],
			'rival'
		);
		expect(r).toEqual({ moves: [], gamesAsWhite: 0, gamesAsBlack: 0 });
	});

	it('reports progress per game', () => {
		const seen: number[] = [];
		aggregateGames([pgn('rival', 'x', '1. e4'), pgn('rival', 'x', '1. d4')], 'rival', (c) =>
			seen.push(c)
		);
		expect(seen).toEqual([0, 1]);
	});
});

describe('isStandardGame', () => {
	it('accepts standard games with or without a Variant tag', () => {
		expect(isStandardGame(pgn('a', 'b', '1. e4'))).toBe(true);
		expect(isStandardGame(pgn('a', 'b', '1. e4', { Variant: 'Standard' }))).toBe(true);
	});

	it('rejects variants and custom starting positions', () => {
		expect(isStandardGame(pgn('a', 'b', '1. e4', { Variant: 'Atomic' }))).toBe(false);
		expect(isStandardGame(pgn('a', 'b', '1. e4', { SetUp: '1' }))).toBe(false);
		expect(isStandardGame(pgn('a', 'b', '1. e4', { FEN: STARTING_FEN }))).toBe(false);
	});
});
