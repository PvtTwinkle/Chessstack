// Server-side logic for the reset-password page.
//
// Reads the token from the URL on load, then validates it and updates
// the user's password on form submission. All existing sessions for the
// user are invalidated after a successful reset.

import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user, session } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { validatePassword } from '$lib/auth/password';
import { validatePasswordResetToken } from '$lib/auth/password-reset';

export const load: PageServerLoad = async ({ url }) => {
	const token = url.searchParams.get('token');
	return { hasToken: !!token, token: token ?? '' };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const token = formData.get('token')?.toString();
		const password = formData.get('password')?.toString();
		const confirmPassword = formData.get('confirmPassword')?.toString();

		if (!token) {
			return fail(400, { error: 'Missing reset token. Please use the link from your email.' });
		}
		if (!password) {
			return fail(400, { error: 'Please enter a new password.' });
		}

		const passwordErr = validatePassword(password);
		if (passwordErr) {
			return fail(400, { error: passwordErr });
		}
		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		// Validate the token — this also marks it as used if valid.
		const result = await validatePasswordResetToken(token);
		if (!result.success) {
			return fail(400, {
				error: 'This reset link is invalid or has expired. Please request a new one.'
			});
		}

		// Update the user's password.
		const passwordHash = await bcrypt.hash(password, 10);
		await db.update(user).set({ passwordHash }).where(eq(user.id, result.userId));

		// Invalidate all existing sessions for this user. If the password was
		// reset because of a compromise, no old session should remain valid.
		await db.delete(session).where(eq(session.userId, result.userId));

		return { success: true };
	}
};
