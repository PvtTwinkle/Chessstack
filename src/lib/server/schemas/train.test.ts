import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { trainerEvaluateSchema, savePositionSchema, deletePositionSchema } from './train';

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const fail = (message: string) => ({ success: false, message });

describe('trainerEvaluateSchema', () => {
	const game = {
		fen: FEN,
		rated: true,
		repertoireId: 1,
		pgn: '1. e4',
		movesPlayed: 1,
		startFen: FEN,
		moveSource: 'PLAYERS',
		playerColor: 'WHITE',
		ratingBracket: 3
	};

	it('accepts a finished game, with or without a bracket', () => {
		expect(validate(trainerEvaluateSchema, game)).toEqual({ success: true, data: game });
		expect(
			validate(trainerEvaluateSchema, { ...game, moveSource: 'MASTERS', ratingBracket: null })
				.success
		).toBe(true);
	});

	it('rounds the browser engine score and clamps it to ±100 pawns', () => {
		const parse = (change: object) => validate(trainerEvaluateSchema, { ...game, ...change });
		expect(parse({ evalCp: 35.6, evalMate: null })).toMatchObject({ data: { evalCp: 36 } });
		expect(parse({ evalCp: -250_000 })).toMatchObject({ data: { evalCp: -10_000 } });
		expect(parse({ evalCp: null, evalMate: -3 })).toMatchObject({ data: { evalMate: -3 } });
	});

	it.each([
		[{ evalCp: '35' }, 'evalCp must be a number'],
		[{ evalMate: 1.5 }, 'evalMate must be an integer'],
		[{ fen: undefined }, 'fen is required'],
		[{ pgn: '' }, 'pgn must not be empty'],
		[{ movesPlayed: '3' }, 'movesPlayed must be a number'],
		[{ startFen: undefined }, 'startFen is required'],
		[{ moveSource: 'LICHESS' }, 'moveSource must be one of: "PLAYERS", "MASTERS"'],
		[{ playerColor: 'white' }, 'playerColor must be one of: "WHITE", "BLACK"'],
		[{ rated: 'yes' }, 'rated must be a boolean']
	])('rejects a game with %j', (change, message) => {
		expect(validate(trainerEvaluateSchema, { ...game, ...change })).toEqual(fail(message));
	});
});

describe('savePositionSchema', () => {
	it('trims the FEN and name and keeps lead-in moves', () => {
		expect(
			validate(savePositionSchema, { fen: ` ${FEN} `, name: ' Open game ', leadInMoves: ['e4'] })
		).toEqual({ success: true, data: { fen: FEN, name: 'Open game', leadInMoves: ['e4'] } });
	});

	it.each([
		[{ name: 'x' }, 'Invalid FEN'],
		[{ fen: '   ', name: 'x' }, 'Invalid FEN'],
		[{ fen: FEN, name: '  ' }, 'Name must be 1-100 characters'],
		[{ fen: FEN, name: 'x'.repeat(101) }, 'Name must be 1-100 characters'],
		[{ fen: FEN, name: 'x', leadInMoves: ['e4', 5] }, 'leadInMoves[1] must be a string']
	])('rejects %j', (body, message) => {
		expect(validate(savePositionSchema, body)).toEqual(fail(message));
	});
});

describe('deletePositionSchema', () => {
	it('requires the id', () => {
		expect(validate(deletePositionSchema, { id: 4 }).success).toBe(true);
		expect(validate(deletePositionSchema, {})).toEqual(fail('id is required'));
	});
});
