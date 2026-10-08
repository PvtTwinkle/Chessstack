// POST /api/auth/change-password — securely update the user's password.
//
// Requires authentication. Validates the current password, then hashes
// and stores the new one. Does NOT invalidate the current session, but
// all other sessions for this user are deleted (forces re-login elsewhere).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import bcrypt from 'bcryptjs';
import { db } from '$lib/db';
import { user, session } from '$lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { SESSION_COOKIE_NAME } from '$lib/auth';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { changePasswordSchema } from '$lib/server/schemas/account';

export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	const authedUser = requireAuth(locals);

	// The schema also enforces the password strength rules on newPassword.
	const { currentPassword, newPassword } = await parseBody(request, changePasswordSchema);

	// Look up the current password hash.
	const [currentUser] = await db
		.select({ passwordHash: user.passwordHash })
		.from(user)
		.where(eq(user.id, authedUser.id));

	if (!currentUser) {
		throw error(500, 'User not found');
	}

	// Verify the current password — use the same generic error message for
	// wrong password as the login page (avoid leaking information).
	if (!(await bcrypt.compare(currentPassword, currentUser.passwordHash))) {
		throw error(403, 'Current password is incorrect');
	}

	// Hash the new password and update.
	const newHash = await bcrypt.hash(newPassword, 10);
	await db.update(user).set({ passwordHash: newHash }).where(eq(user.id, authedUser.id));

	// Invalidate all other sessions for this user (good security practice).
	// The current session stays valid so the user doesn't get logged out.
	const currentToken = cookies.get(SESSION_COOKIE_NAME);
	if (currentToken) {
		await db
			.delete(session)
			.where(and(eq(session.userId, authedUser.id), ne(session.id, currentToken)));
	}

	return json({ success: true });
};
