import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import {
	createRepertoireSchema,
	updateRepertoireSchema,
	setActiveRepertoireSchema
} from './repertoires';

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('createRepertoireSchema', () => {
	it('accepts a name and colour, trimming the name', () => {
		expect(validate(createRepertoireSchema, { name: '  Sicilian ', color: 'BLACK' })).toEqual({
			success: true,
			data: { name: 'Sicilian', color: 'BLACK' }
		});
	});

	it.each([
		[{ color: 'WHITE' }, 'name is required'],
		[{ name: '   ', color: 'WHITE' }, 'name must be a non-empty string'],
		[{ name: 'x', color: 'white' }, 'color must be one of: "WHITE", "BLACK"']
	])('rejects %j', (body, message) => {
		expect(validate(createRepertoireSchema, body)).toEqual({ success: false, message });
	});
});

describe('updateRepertoireSchema', () => {
	it('accepts a name, a start FEN, or null to reset the start', () => {
		expect(validate(updateRepertoireSchema, { name: 'New' }).success).toBe(true);
		expect(validate(updateRepertoireSchema, { startFen: FEN })).toEqual({
			success: true,
			data: { startFen: FEN }
		});
		expect(validate(updateRepertoireSchema, { startFen: null })).toEqual({
			success: true,
			data: { startFen: null }
		});
	});

	it.each([
		[{}, 'At least one field (name, startFen) is required'],
		[{ name: '' }, 'name must be a non-empty string'],
		[{ startFen: '  ' }, 'startFen must not be empty'],
		[{ startFen: 'x'.repeat(101) }, 'startFen must be at most 100 characters'],
		[{ startFen: 3 }, 'startFen must be a string']
	])('rejects %j', (body, message) => {
		expect(validate(updateRepertoireSchema, body)).toEqual({ success: false, message });
	});
});

describe('setActiveRepertoireSchema', () => {
	it('accepts an integer id', () => {
		expect(validate(setActiveRepertoireSchema, { id: 7 })).toEqual({
			success: true,
			data: { id: 7 }
		});
	});

	it('rejects a string id', () => {
		expect(validate(setActiveRepertoireSchema, { id: '7' })).toEqual({
			success: false,
			message: 'id must be a number'
		});
	});
});
