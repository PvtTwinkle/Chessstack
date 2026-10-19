import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { id, san } from './common';

describe('id', () => {
	it.each([1, 42, 2_147_483_647])('accepts %d', (value) => {
		expect(validate(id, value)).toEqual({ success: true, data: value });
	});

	it.each([
		[0, 'Request body must be at least 1'],
		[-5, 'Request body must be at least 1'],
		[2_147_483_648, 'Request body must be at most 2147483647'],
		[1.5, 'Request body must be an integer']
	])('rejects %d, which int4 ids can never be', (value, message) => {
		expect(validate(id, value)).toEqual({ success: false, message });
	});
});

describe('san', () => {
	it('trims and accepts a long but legal move', () => {
		expect(validate(san, ' exd8=Q+ ')).toEqual({ success: true, data: 'exd8=Q+' });
	});

	it('rejects empty and oversized moves', () => {
		expect(validate(san, '').success).toBe(false);
		expect(validate(san, 'x'.repeat(11)).success).toBe(false);
	});
});
