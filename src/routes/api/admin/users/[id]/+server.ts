// PATCH /api/admin/users/[id] — Update user properties (enable/disable, change role).
// DELETE /api/admin/users/[id] — Hard-delete a user and all their data.
//
// Access is guarded by hooks.server.ts (admin role required).

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin, parseIntParam } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { updateUserSchema } from '$lib/server/schemas/admin';
import { db } from '$lib/db';
import { user, session, auditLog } from '$lib/db/schema';
import { eq, and, count, ne } from 'drizzle-orm';
import { deleteUserAccount, SubscriptionNotCancelledError } from '$lib/server/delete-account';
import { usernameMatches } from '$lib/auth/username';
import { isUniqueViolation } from '$lib/server/db-errors';
import { log } from '$lib/server/log';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const admin = requireAdmin(locals);
	const targetId = parseIntParam(params.id, 'user ID');

	const body = await parseBody(request, updateUserSchema);

	// Look up the target user
	const [target] = await db
		.select({ id: user.id, username: user.username, role: user.role, enabled: user.enabled })
		.from(user)
		.where(eq(user.id, targetId));
	if (!target) throw error(404, 'User not found');

	// Every rule is checked before anything is written, and the writes and
	// their audit entry then go in one transaction, so a refused change never
	// leaves an earlier one half-applied.
	if (body.enabled !== undefined && targetId === admin.id) {
		throw error(400, 'You cannot disable your own account.');
	}

	if (body.role !== undefined) {
		// Cannot demote yourself
		if (targetId === admin.id && body.role !== 'admin') {
			throw error(400, 'You cannot remove your own admin role.');
		}

		// Cannot remove the last admin
		if (body.role === 'user' && target.role === 'admin') {
			const [adminCount] = await db
				.select({ count: count() })
				.from(user)
				.where(and(eq(user.role, 'admin'), eq(user.enabled, true)));
			if (adminCount.count <= 1) {
				throw error(400, 'Cannot remove the last admin. Promote another user first.');
			}
		}
	}

	// A new username must not match another user's, ignoring case.
	const newUsername =
		body.username !== undefined && body.username !== target.username ? body.username : undefined;
	if (newUsername !== undefined) {
		const [existing] = await db
			.select({ id: user.id })
			.from(user)
			.where(and(usernameMatches(newUsername), ne(user.id, targetId)));
		if (existing) {
			throw error(409, 'That username is already taken.');
		}
	}

	const updates: Partial<typeof user.$inferInsert> = {};
	if (body.enabled !== undefined) updates.enabled = body.enabled;
	if (body.role !== undefined) updates.role = body.role;
	if (newUsername !== undefined) updates.username = newUsername;
	if (body.emailVerified !== undefined) updates.emailVerified = body.emailVerified;

	// Audit log — record what changed.
	const changes: string[] = [];
	if (body.enabled !== undefined) changes.push(`enabled=${body.enabled}`);
	if (body.role !== undefined) changes.push(`role=${body.role}`);
	if (body.username !== undefined) changes.push(`username="${body.username}"`);
	if (body.emailVerified !== undefined) changes.push(`emailVerified=${body.emailVerified}`);

	try {
		await db.transaction(async (tx) => {
			if (Object.keys(updates).length > 0) {
				await tx.update(user).set(updates).where(eq(user.id, targetId));
			}
			// When disabling, immediately invalidate all their sessions.
			if (body.enabled === false) {
				await tx.delete(session).where(eq(session.userId, targetId));
			}
			if (changes.length > 0) {
				await tx.insert(auditLog).values({
					adminUserId: admin.id,
					action: 'update_user',
					targetUserId: targetId,
					details: changes.join(', '),
					createdAt: new Date()
				});
			}
		});
	} catch (e) {
		// Another request took the username since the check above.
		if (isUniqueViolation(e)) throw error(409, 'That username is already taken.');
		throw e;
	}

	// Return updated user
	const [updated] = await db
		.select({
			id: user.id,
			username: user.username,
			role: user.role,
			enabled: user.enabled,
			emailVerified: user.emailVerified,
			createdAt: user.createdAt
		})
		.from(user)
		.where(eq(user.id, targetId));

	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const admin = requireAdmin(locals);
	const targetId = parseIntParam(params.id, 'user ID');

	// Cannot delete yourself
	if (targetId === admin.id) {
		throw error(400, 'You cannot delete your own account.');
	}

	// Verify target exists
	const [target] = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.id, targetId));
	if (!target) throw error(404, 'User not found');

	// Cannot delete the last admin
	if (target.role === 'admin') {
		const [adminCount] = await db
			.select({ count: count() })
			.from(user)
			.where(and(eq(user.role, 'admin'), eq(user.enabled, true)));
		if (adminCount.count <= 1) {
			throw error(400, 'Cannot delete the last admin. Promote another user first.');
		}
	}

	// The audit entry is written in the same transaction as the deletion, so
	// a deletion that fails (or a Stripe cancel that fails first) logs nothing.
	try {
		await deleteUserAccount(targetId, async (tx) => {
			await tx.insert(auditLog).values({
				adminUserId: admin.id,
				action: 'delete_user',
				targetUserId: targetId,
				details: `Deleted user id=${targetId}`,
				createdAt: new Date()
			});
		});
	} catch (err) {
		if (!(err instanceof SubscriptionNotCancelledError)) throw err;
		log.error('Stripe cancel failed; user not deleted', { targetUserId: targetId, err: err.cause });
		throw error(
			502,
			"Couldn't cancel this user's Stripe subscription, so they were not deleted. Try again, or cancel it in the Stripe dashboard first."
		);
	}

	return json({ success: true });
};
