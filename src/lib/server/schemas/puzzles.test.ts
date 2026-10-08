import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { puzzleAttemptSchema } from './puzzles';

describe('puzzleAttemptSchema', () => {
	it('rounds the time and treats a missing time as null', () => {
		expect(
			validate(puzzleAttemptSchema, { puzzleId: 'abc', solved: true, timeMs: 1234.6 })
		).toEqual({ success: true, data: { puzzleId: 'abc', solved: true, timeMs: 1235 } });
		expect(validate(puzzleAttemptSchema, { puzzleId: 'abc', solved: false })).toEqual({
			success: true,
			data: { puzzleId: 'abc', solved: false, timeMs: null }
		});
	});

	it.each([
		[{ puzzleId: '', solved: true }, 'puzzleId must not be empty'],
		[{ puzzleId: 'abc', solved: 'true' }, 'solved must be a boolean'],
		[{ puzzleId: 'abc', solved: true, timeMs: '10' }, 'timeMs must be a number']
	])('rejects %j', (body, message) => {
		expect(validate(puzzleAttemptSchema, body)).toEqual({ success: false, message });
	});
});
