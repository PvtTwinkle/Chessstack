import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { updateEmailSchema, changePasswordSchema, deleteAccountSchema } from './account';

const STRONG = 'Correct-Horse-9';

describe('updateEmailSchema', () => {
	it('trims and lowercases the address', () => {
		expect(validate(updateEmailSchema, { email: '  Kevin@Example.COM ' })).toEqual({
			success: true,
			data: { email: 'kevin@example.com' }
		});
	});

	it.each([
		[{}, 'Email is required.'],
		[{ email: '  ' }, 'Email is required.'],
		[{ email: 'not-an-email' }, 'Please enter a valid email address.'],
		[{ email: `${'a'.repeat(250)}@x.io` }, 'Please enter a valid email address.']
	])('rejects %j', (body, message) => {
		expect(validate(updateEmailSchema, body)).toEqual({ success: false, message });
	});
});

describe('changePasswordSchema', () => {
	it('accepts a strong new password', () => {
		expect(validate(changePasswordSchema, { currentPassword: 'old', newPassword: STRONG })).toEqual(
			{
				success: true,
				data: { currentPassword: 'old', newPassword: STRONG }
			}
		);
	});

	it.each([
		[{ newPassword: STRONG }, 'Current password is required'],
		[{ currentPassword: '', newPassword: STRONG }, 'Current password is required'],
		[{ currentPassword: 'old' }, 'New password is required'],
		[{ currentPassword: 'old', newPassword: 'short' }, 'Password must be at least 12 characters.'],
		[
			{ currentPassword: 'old', newPassword: 'correct-horse-9' },
			'Password must include at least one uppercase letter.'
		]
	])('rejects %j', (body, message) => {
		expect(validate(changePasswordSchema, body)).toEqual({ success: false, message });
	});
});

describe('deleteAccountSchema', () => {
	it('requires the password', () => {
		expect(validate(deleteAccountSchema, { password: 'x' }).success).toBe(true);
		expect(validate(deleteAccountSchema, { password: '' })).toEqual({
			success: false,
			message: 'Password is required'
		});
		expect(validate(deleteAccountSchema, {})).toEqual({
			success: false,
			message: 'Password is required'
		});
	});
});
