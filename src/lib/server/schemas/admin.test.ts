import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import {
	createUserSchema,
	updateUserSchema,
	resetPasswordSchema,
	giftSubscriptionSchema
} from './admin';

const STRONG = 'Correct-Horse-9';
const fail = (message: string) => ({ success: false, message });

describe('createUserSchema', () => {
	const user = { username: ' new_player ', email: ' New@Example.com ', password: STRONG };

	it('trims the username and normalises the email', () => {
		expect(validate(createUserSchema, user)).toEqual({
			success: true,
			data: { username: 'new_player', email: 'new@example.com', password: STRONG }
		});
	});

	it('reads a blank or missing email as none', () => {
		for (const email of ['', '  ', undefined]) {
			expect(validate(createUserSchema, { ...user, email })).toEqual({
				success: true,
				data: { username: 'new_player', email: null, password: STRONG }
			});
		}
	});

	it.each([
		[{ username: undefined }, 'Username, email, and password are required.'],
		[{ password: undefined }, 'Username, email, and password are required.'],
		[{ email: 'nope' }, 'Please enter a valid email address.'],
		[{ username: 'ab' }, 'Username must be 3–30 characters.'],
		[{ username: 'x'.repeat(31) }, 'Username must be 3–30 characters.'],
		[
			{ username: 'bad name' },
			'Username may only contain letters, numbers, hyphens, and underscores.'
		],
		[{ password: 'short' }, 'Password must be at least 12 characters.']
	])('rejects a user with %j', (change, message) => {
		expect(validate(createUserSchema, { ...user, ...change })).toEqual(fail(message));
	});
});

describe('updateUserSchema', () => {
	it('accepts any subset of fields, including none', () => {
		expect(validate(updateUserSchema, {})).toEqual({ success: true, data: {} });
		expect(validate(updateUserSchema, { enabled: false, role: 'admin' })).toEqual({
			success: true,
			data: { enabled: false, role: 'admin' }
		});
		expect(validate(updateUserSchema, { username: ' renamed ' })).toEqual({
			success: true,
			data: { username: 'renamed' }
		});
	});

	it.each([
		[{ role: 'owner' }, 'role must be one of: "admin", "user"'],
		[{ enabled: 'false' }, 'enabled must be a boolean'],
		[{ emailVerified: 1 }, 'emailVerified must be a boolean'],
		[{ username: 'a!' }, 'Username must be 3–30 characters.']
	])('rejects %j', (body, message) => {
		expect(validate(updateUserSchema, body)).toEqual(fail(message));
	});
});

describe('resetPasswordSchema', () => {
	it('requires a strong password', () => {
		expect(validate(resetPasswordSchema, { newPassword: STRONG }).success).toBe(true);
		expect(validate(resetPasswordSchema, {})).toEqual(fail('Password is required.'));
		expect(validate(resetPasswordSchema, { newPassword: 'alllowercase-123' })).toEqual(
			fail('Password must include at least one uppercase letter.')
		);
	});
});

describe('giftSubscriptionSchema', () => {
	it('accepts a grant with a duration, or a revoke', () => {
		expect(validate(giftSubscriptionSchema, { action: 'grant', duration: 'lifetime' })).toEqual({
			success: true,
			data: { action: 'grant', duration: 'lifetime' }
		});
		expect(validate(giftSubscriptionSchema, { action: 'revoke' })).toEqual({
			success: true,
			data: { action: 'revoke' }
		});
	});

	it.each([
		[{}, 'action must be "grant" or "revoke"'],
		[{ action: 'extend' }, 'action must be "grant" or "revoke"'],
		[{ action: 'grant' }, 'duration must be "1_month", "1_year", or "lifetime"'],
		[{ action: 'grant', duration: '1_week' }, 'duration must be "1_month", "1_year", or "lifetime"']
	])('rejects %j', (body, message) => {
		expect(validate(giftSubscriptionSchema, body)).toEqual(fail(message));
	});
});
