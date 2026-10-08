import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import {
	updateImportedGameSchema,
	fetchImportSchema,
	parseImportSchema,
	executeImportSchema
} from './import';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const fail = (message: string) => ({ success: false, message });

describe('updateImportedGameSchema', () => {
	it('accepts skipped or pending', () => {
		expect(validate(updateImportedGameSchema, { status: 'skipped' }).success).toBe(true);
		expect(validate(updateImportedGameSchema, { status: 'reviewed' })).toEqual(
			fail('status must be one of: "skipped", "pending"')
		);
	});
});

describe('fetchImportSchema', () => {
	it('requires a known source', () => {
		expect(validate(fetchImportSchema, { source: 'LICHESS' }).success).toBe(true);
		expect(validate(fetchImportSchema, {})).toEqual(
			fail('source must be one of: "LICHESS", "CHESSCOM"')
		);
	});
});

describe('parseImportSchema', () => {
	it.each([
		[{ repertoireId: 1, pgn: '1. e4 e5' }, null],
		[{ repertoireId: 1, pgn: '' }, 'pgn must not be empty'],
		[{ pgn: '1. e4' }, 'repertoireId is required']
	])('validates %j', (body, message) => {
		const result = validate(parseImportSchema, body);
		expect(result.success ? null : result.message).toBe(message);
	});
});

describe('executeImportSchema', () => {
	it('accepts moves with optional annotations and defaults replacements', () => {
		const moves = [
			{ fromFen: FEN, san: 'e4', annotation: 'Best by test' },
			{ fromFen: FEN, san: 'd4' }
		];
		expect(validate(executeImportSchema, { repertoireId: 1, moves })).toEqual({
			success: true,
			data: { repertoireId: 1, moves, replacements: [] }
		});
	});

	it.each([
		[{ repertoireId: 1, moves: [] }, 'moves must not be empty'],
		[{ repertoireId: 1 }, 'moves is required'],
		[{ repertoireId: 1, moves: [{ fromFen: FEN }] }, 'moves[0].san is required'],
		[
			{ repertoireId: 1, moves: [{ fromFen: FEN, san: 'e4' }], replacements: {} },
			'replacements must be an array'
		]
	])('rejects %j', (body, message) => {
		expect(validate(executeImportSchema, body)).toEqual(fail(message));
	});
});
