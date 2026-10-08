// POST /api/admin/users/[id]/reset-password — Admin resets a user's password.
// Hashes the new password, updates the user row, and invalidates all their sessions.

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin, parseIntParam } from '$lib/server/api-helpers';
import { db } from '$lib/db';
import { user, session, auditLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { parseBody } from '$lib/server/validation';
import { resetPasswordSchema } from '$lib/server/schemas/admin';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const admin = requireAdmin(locals);
	const targetId = parseIntParam(params.id, 'user ID');

	const { newPassword } = await parseBody(request, resetPasswordSchema);

	// Verify target exists
	const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId));
	if (!target) throw error(404, 'User not found');

	// Hash and update
	const passwordHash = await bcrypt.hash(newPassword, 10);
	await db.update(user).set({ passwordHash }).where(eq(user.id, targetId));

	// Invalidate all target user's sessions (force re-login)
	await db.delete(session).where(eq(session.userId, targetId));

	await db.insert(auditLog).values({
		adminUserId: admin.id,
		action: 'reset_password',
		targetUserId: targetId,
		createdAt: new Date()
	});

	return json({ success: true });
};
