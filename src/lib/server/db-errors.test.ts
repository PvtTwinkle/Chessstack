import { describe, it, expect } from 'vitest';
import { isUniqueViolation } from './db-errors';

const pgError = { code: '23505', constraint_name: 'idx_user_email' };

describe('isUniqueViolation', () => {
	it('recognises a 23505 from the driver or wrapped by Drizzle', () => {
		expect(isUniqueViolation(pgError)).toBe(true);
		expect(isUniqueViolation(Object.assign(new Error('Failed query'), { cause: pgError }))).toBe(
			true
		);
	});

	it('can be narrowed to one constraint', () => {
		expect(isUniqueViolation(pgError, 'idx_user_email')).toBe(true);
		expect(isUniqueViolation(pgError, 'user_username_key')).toBe(false);
	});

	it('ignores other errors', () => {
		expect(isUniqueViolation({ code: '23503' })).toBe(false);
		expect(isUniqueViolation(new Error('boom'))).toBe(false);
		expect(isUniqueViolation(null)).toBe(false);
	});
});
