import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import {
	createPrepSchema,
	updatePrepSchema,
	addPrepToRepertoireSchema,
	exportPrepSchema,
	addPrepMoveSchema,
	deletePrepMoveSchema,
	refreshPrepSchema,
	fetchOpponentGamesSchema
} from './prep';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';
const fail = (message: string) => ({ success: false, message });

const move = {
	positionFen: FEN,
	moveSan: 'e4',
	opponentColor: 'w',
	resultingFen: AFTER_E4,
	gamesPlayed: 10,
	whiteWins: 5,
	blackWins: 3,
	draws: 2
};

describe('createPrepSchema', () => {
	const prep = {
		opponentName: 'Magnus',
		platform: 'LICHESS',
		platformUsername: 'DrNykterstein',
		timeWindow: '3m',
		gamesAsWhite: 12,
		gamesAsBlack: 9
	};

	it('accepts a prep and drops a moves list (moves arrive in batches)', () => {
		expect(validate(createPrepSchema, prep)).toEqual({ success: true, data: prep });
		expect(validate(createPrepSchema, { ...prep, moves: [move] })).toEqual({
			success: true,
			data: prep
		});
		expect(validate(createPrepSchema, { ...prep, timeWindow: null }).success).toBe(true);
	});

	it.each([
		[{ opponentName: '' }, 'opponentName must not be empty'],
		[{ opponentName: 'x'.repeat(101) }, 'opponentName must be at most 100 characters'],
		[{ platform: 'FICS' }, 'platform must be one of: "LICHESS", "CHESSCOM"'],
		[{ timeWindow: '2w' }, 'timeWindow must be one of: "1m", "3m", "6m", "1y", "all"'],
		[{ gamesAsWhite: -1 }, 'gamesAsWhite must be at least 0']
	])('rejects a prep with %j', (change, message) => {
		expect(validate(createPrepSchema, { ...prep, ...change })).toEqual(fail(message));
	});
});

describe('updatePrepSchema', () => {
	it('clamps minGames and keeps excluded moves', () => {
		expect(validate(updatePrepSchema, { minGames: 500 })).toEqual({
			success: true,
			data: { minGames: 100 }
		});
		expect(validate(updatePrepSchema, { minGames: 0, excludedMoves: ['e4'] })).toEqual({
			success: true,
			data: { minGames: 1, excludedMoves: ['e4'] }
		});
	});

	it.each([
		[{}, 'No valid fields to update'],
		[{ excludedMoves: [1] }, 'excludedMoves[0] must be a string'],
		[{ minGames: '5' }, 'minGames must be a number']
	])('rejects %j', (body, message) => {
		expect(validate(updatePrepSchema, body)).toEqual(fail(message));
	});
});

describe('addPrepToRepertoireSchema', () => {
	it('defaults replacements to an empty list', () => {
		expect(
			validate(addPrepToRepertoireSchema, { mode: 'preview', repertoireId: 1, color: 'white' })
		).toEqual({
			success: true,
			data: { mode: 'preview', repertoireId: 1, color: 'white', replacements: [] }
		});
	});

	it.each([
		[
			{ mode: 'apply', repertoireId: 1, color: 'white' },
			'mode must be one of: "preview", "execute"'
		],
		[{ mode: 'execute', color: 'white' }, 'repertoireId is required'],
		[
			{ mode: 'execute', repertoireId: 1, color: 'WHITE' },
			'color must be one of: "white", "black"'
		],
		[
			{ mode: 'execute', repertoireId: 1, color: 'white', replacements: [{ fromFen: FEN }] },
			'replacements[0].san is required'
		]
	])('rejects %j', (body, message) => {
		expect(validate(addPrepToRepertoireSchema, body)).toEqual(fail(message));
	});
});

describe('exportPrepSchema', () => {
	it('requires a colour', () => {
		expect(validate(exportPrepSchema, { color: 'black' }).success).toBe(true);
		expect(validate(exportPrepSchema, {})).toEqual(fail('color must be one of: "white", "black"'));
	});
});

describe('addPrepMoveSchema / deletePrepMoveSchema', () => {
	it('accepts a move and trims the FEN', () => {
		expect(validate(addPrepMoveSchema, { fromFen: ` ${FEN} `, san: 'e4', color: 'white' })).toEqual(
			{
				success: true,
				data: { fromFen: FEN, san: 'e4', color: 'white' }
			}
		);
	});

	it('rejects a missing FEN with the message the UI expects', () => {
		expect(validate(addPrepMoveSchema, { san: 'e4', color: 'white' })).toEqual(fail('Invalid FEN'));
	});

	it('requires a move id to delete', () => {
		expect(validate(deletePrepMoveSchema, { moveId: 3 }).success).toBe(true);
		expect(validate(deletePrepMoveSchema, {})).toEqual(fail('moveId is required'));
	});
});

describe('refreshPrepSchema', () => {
	it('parses each mode with its defaults', () => {
		expect(
			validate(refreshPrepSchema, { mode: 'fetch', timeWindow: 'all', maxGames: null })
		).toEqual({ success: true, data: { mode: 'fetch', timeWindow: 'all', maxGames: 500 } });
		expect(validate(refreshPrepSchema, { mode: 'fetch', maxGames: 10_000 })).toEqual({
			success: true,
			data: { mode: 'fetch', maxGames: 5000 }
		});
		expect(validate(refreshPrepSchema, { mode: 'merge-start' })).toEqual({
			success: true,
			data: { mode: 'merge-start' }
		});
		expect(validate(refreshPrepSchema, { mode: 'merge-batch', moves: [move] }).success).toBe(true);
		expect(validate(refreshPrepSchema, { mode: 'merge-commit', timeWindow: '1y' })).toEqual({
			success: true,
			data: { mode: 'merge-commit', timeWindow: '1y', gamesAsWhite: 0, gamesAsBlack: 0 }
		});
	});

	it('caps a batch at 1000 moves', () => {
		expect(
			validate(refreshPrepSchema, { mode: 'merge-batch', moves: Array(1001).fill(move) })
		).toEqual(fail('moves must have at most 1000 items'));
	});

	const modes = 'mode must be "fetch", "merge-start", "merge-batch", or "merge-commit"';
	it.each([
		[{}, modes],
		[{ mode: 'merge' }, modes],
		[{ mode: 'merge-batch', moves: [] }, 'moves must not be empty'],
		[{ mode: 'merge-batch', moves: 'e4' }, 'moves must be an array'],
		[
			{ mode: 'merge-batch', moves: [{ ...move, opponentColor: 'white' }] },
			'moves[0].opponentColor must be one of: "w", "b"'
		],
		[
			{ mode: 'merge-batch', moves: [{ ...move, gamesPlayed: 1.5 }] },
			'moves[0].gamesPlayed must be an integer'
		],
		[
			{ mode: 'merge-batch', moves: [{ ...move, resultingFen: '' }] },
			'moves[0].resultingFen must not be empty'
		],
		[{ mode: 'merge-commit', gamesAsBlack: -2 }, 'gamesAsBlack must be at least 0'],
		[
			{ mode: 'merge-commit', timeWindow: '2w' },
			'timeWindow must be one of: "1m", "3m", "6m", "1y", "all"'
		]
	])('rejects %j', (body, message) => {
		expect(validate(refreshPrepSchema, body)).toEqual(fail(message));
	});
});

describe('fetchOpponentGamesSchema', () => {
	it('clamps maxGames and defaults it to 500', () => {
		expect(
			validate(fetchOpponentGamesSchema, { opponentUsername: 'hikaru', platform: 'CHESSCOM' })
		).toEqual({
			success: true,
			data: { opponentUsername: 'hikaru', platform: 'CHESSCOM', maxGames: 500 }
		});
		expect(
			validate(fetchOpponentGamesSchema, {
				opponentUsername: 'hikaru',
				platform: 'CHESSCOM',
				maxGames: 10
			})
		).toMatchObject({ success: true, data: { maxGames: 50 } });
	});

	it.each([
		[{ platform: 'LICHESS' }, 'opponentUsername is required'],
		[
			{ opponentUsername: 'x'.repeat(26), platform: 'LICHESS' },
			'opponentUsername must be at most 25 characters'
		],
		[
			{ opponentUsername: 'x', platform: 'lichess' },
			'platform must be one of: "LICHESS", "CHESSCOM"'
		]
	])('rejects %j', (body, message) => {
		expect(validate(fetchOpponentGamesSchema, body)).toEqual(fail(message));
	});
});
