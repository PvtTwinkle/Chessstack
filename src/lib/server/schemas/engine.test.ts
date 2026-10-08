import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { ecoLookupSchema, bookLookupSchema } from './engine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';
const fail = (message: string) => ({ success: false, message });

describe('ecoLookupSchema', () => {
	it('drops entries that do not look like FENs', () => {
		expect(
			validate(ecoLookupSchema, {
				fens: [
					AFTER_E4,
					42,
					'',
					'not a fen at all',
					'rnbq x KQkq -',
					'xyz w KQkq -',
					'x'.repeat(101),
					START
				]
			})
		).toEqual({ success: true, data: { fens: [AFTER_E4, START] } });
	});

	it('keeps at most 50 positions', () => {
		const result = validate(ecoLookupSchema, { fens: Array(80).fill(START) });
		expect(result.success && result.data.fens).toHaveLength(50);
	});

	it.each([{}, { fens: START }, null])('rejects %j', (body) => {
		expect(validate(ecoLookupSchema, body)).toEqual(
			fail('Request body must be { fens: string[] }')
		);
	});
});

describe('bookLookupSchema', () => {
	it('trims the FEN', () => {
		expect(validate(bookLookupSchema, { fen: ` ${START} ` })).toEqual({
			success: true,
			data: { fen: START }
		});
	});

	it.each([
		[{}, 'fen is required or too long'],
		[{ fen: '  ' }, 'fen is required or too long'],
		[{ fen: 'x'.repeat(101) }, 'fen is required or too long']
	])('rejects %j', (body, message) => {
		expect(validate(bookLookupSchema, body)).toEqual(fail(message));
	});
});
