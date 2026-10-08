// Request bodies for account and auth routes. These messages are shown in the
// settings page as-is, so they are written for people rather than developers.

import { z } from 'zod';
import { validatePassword } from '$lib/auth/password';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_EMAIL = 'Please enter a valid email address.';

/** PATCH /api/account/email. Stored trimmed and lowercased. */
export const updateEmailSchema = z.object({
	email: z
		.string({ error: 'Email is required.' })
		.trim()
		.toLowerCase()
		.min(1, { error: 'Email is required.' })
		.max(254, { error: INVALID_EMAIL })
		.regex(EMAIL_RE, { error: INVALID_EMAIL })
});

/** A password field that must be present and non-empty (strength is not checked). */
function requiredPassword(message: string) {
	return z.string({ error: message }).min(1, { error: message });
}

/** POST /api/auth/change-password */
export const changePasswordSchema = z.object({
	currentPassword: requiredPassword('Current password is required'),
	newPassword: requiredPassword('New password is required').superRefine((password, ctx) => {
		const problem = validatePassword(password);
		if (problem) ctx.addIssue({ code: 'custom', message: problem });
	})
});

/** DELETE /api/auth/delete-account */
export const deleteAccountSchema = z.object({
	password: requiredPassword('Password is required')
});
