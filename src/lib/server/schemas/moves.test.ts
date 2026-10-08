import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { createMoveSchema, updateMoveNotesSchema } from './moves';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('createMoveSchema', () => {
	it('accepts a move and ignores a client-sent toFen', () => {
		expect(
			validate(createMoveSchema, { repertoireId: 1, fromFen: FEN, san: 'e4', toFen: 'forged' })
		).toEqual({ success: true, data: { repertoireId: 1, fromFen: FEN, san: 'e4' } });
	});

	it.each([
		[{ fromFen: FEN, san: 'e4' }, 'repertoireId is required'],
		[{ repertoireId: '1', fromFen: FEN, san: 'e4' }, 'repertoireId must be a number'],
		[{ repertoireId: 1, san: 'e4' }, 'fromFen is required'],
		[
			{ repertoireId: 1, fromFen: 'x'.repeat(101), san: 'e4' },
			'fromFen must be at most 100 characters'
		],
		[{ repertoireId: 1, fromFen: FEN, san: '' }, 'san must not be empty']
	])('rejects %j', (body, message) => {
		expect(validate(createMoveSchema, body)).toEqual({ success: false, message });
	});
});

describe('updateMoveNotesSchema', () => {
	it('trims notes and stores blank notes as null', () => {
		expect(validate(updateMoveNotesSchema, { notes: '  main line ' })).toEqual({
			success: true,
			data: { notes: 'main line' }
		});
		expect(validate(updateMoveNotesSchema, { notes: '   ' })).toEqual({
			success: true,
			data: { notes: null }
		});
		expect(validate(updateMoveNotesSchema, { notes: null })).toEqual({
			success: true,
			data: { notes: null }
		});
	});

	it.each([
		[{}, 'notes is required'],
		[{ notes: 5 }, 'notes must be a string'],
		[{ notes: 'x'.repeat(501) }, 'notes must be 500 characters or fewer']
	])('rejects %j', (body, message) => {
		expect(validate(updateMoveNotesSchema, body)).toEqual({ success: false, message });
	});

	it('measures the length after trimming', () => {
		expect(validate(updateMoveNotesSchema, { notes: ` ${'x'.repeat(500)} ` }).success).toBe(true);
	});
});
