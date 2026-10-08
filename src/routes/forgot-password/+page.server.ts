// Server-side logic for the forgot-password page.
//
// Accepts an email address and sends a password reset link via Loops.
// Always returns the same success message regardless of whether the email
// exists in the system — this prevents email enumeration attacks.

import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isRateLimited } from '$lib/auth/rate-limit';
import { isPasswordResetEnabled } from '$lib/loops';
import { createAndSendPasswordReset } from '$lib/auth/password-reset';
import { log } from '$lib/server/log';

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		const ip = getClientAddress();
		if (await isRateLimited(ip, { prefix: 'password-reset', max: 3, windowMs: 15 * 60 * 1000 })) {
			return fail(429, { error: 'Too many requests. Please try again in 15 minutes.' });
		}

		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();

		if (!email) {
			return fail(400, { error: 'Please enter your email address.' });
		}
		if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { error: 'Please enter a valid email address.' });
		}

		// Look up the user but never reveal whether the email exists.
		if (isPasswordResetEnabled()) {
			const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));

			if (found) {
				try {
					await createAndSendPasswordReset(found.id, email);
				} catch (e) {
					log.error('Failed to send password reset email', { err: e });
				}
			}
		}

		// Always return the same message to prevent email enumeration.
		return { success: true };
	}
};
