// Request bodies for /api/admin routes. The admin panel shows these messages
// as-is, so they are written for people.

import { z } from 'zod';
import { validatePassword } from '$lib/auth/password';
import { USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH } from '$lib/validation-limits';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED = 'Username, email, and password are required.';
const USERNAME_LENGTH = `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.`;

const username = z
	.string()
	.trim()
	.min(USERNAME_MIN_LENGTH, { error: USERNAME_LENGTH })
	.max(USERNAME_MAX_LENGTH, { error: USERNAME_LENGTH })
	.regex(/^[a-zA-Z0-9_-]+$/, {
		error: 'Username may only contain letters, numbers, hyphens, and underscores.'
	});

/** A new password, checked against the shared strength rules. */
function newPassword(requiredMessage: string) {
	return z
		.string({ error: requiredMessage })
		.min(1, { error: requiredMessage })
		.superRefine((password, ctx) => {
			const problem = validatePassword(password);
			if (problem) ctx.addIssue({ code: 'custom', message: problem });
		});
}

/**
 * POST /api/admin/users. The email may be left out (null); the route requires
 * it on the cloud edition only.
 */
export const createUserSchema = z.object({
	username: z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED }).pipe(username),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.max(254, { error: 'Please enter a valid email address.' })
		.refine((email) => email === '' || EMAIL_RE.test(email), {
			error: 'Please enter a valid email address.'
		})
		.optional()
		.transform((email) => email || null),
	password: newPassword(REQUIRED)
});

/**
 * PATCH /api/admin/users/[id]. Every field is optional; the route applies the
 * ones sent and enforces the self-demotion and last-admin rules.
 */
export const updateUserSchema = z
	.object({
		enabled: z.boolean(),
		role: z.enum(['admin', 'user']),
		username,
		emailVerified: z.boolean()
	})
	.partial();

/** POST /api/admin/users/[id]/reset-password */
export const resetPasswordSchema = z.object({
	newPassword: newPassword('Password is required.')
});

/** PATCH /api/admin/users/[id]/subscription: gift paid access, or revoke a gift. */
export const giftSubscriptionSchema = z.discriminatedUnion(
	'action',
	[
		z.object({
			action: z.literal('grant'),
			duration: z.enum(['1_month', '1_year', 'lifetime'], {
				error: 'duration must be "1_month", "1_year", or "lifetime"'
			})
		}),
		z.object({ action: z.literal('revoke') })
	],
	{ error: 'action must be "grant" or "revoke"' }
);
