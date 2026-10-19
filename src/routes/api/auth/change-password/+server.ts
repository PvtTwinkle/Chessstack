// POST /api/auth/change-password — securely update the user's password.
//
// Requires authentication and the current password. Every existing session
// for the user is deleted, including this one, which is replaced with a new
// session so the user stays signed in here. A session token that leaked
// before the change stops working.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import bcrypt from 'bcryptjs';
import { db } from '$lib/db';
import { user, session } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { createSession, setSessionCookie } from '$lib/auth';
import { verifyCurrentPassword } from '$lib/auth/account';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { changePasswordSchema } from '$lib/server/schemas/account';

export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	const authedUser = requireAuth(locals);

	// The schema also enforces the password strength rules on newPassword.
	const { currentPassword, newPassword } = await parseBody(request, changePasswordSchema);

	await verifyCurrentPassword(authedUser.id, currentPassword, 'Current password is incorrect');

	const newHash = await bcrypt.hash(newPassword, 10);
	await db.transaction(async (tx) => {
		await tx.update(user).set({ passwordHash: newHash }).where(eq(user.id, authedUser.id));
		await tx.delete(session).where(eq(session.userId, authedUser.id));
	});

	setSessionCookie(cookies, await createSession(authedUser.id));

	return json({ success: true });
};
