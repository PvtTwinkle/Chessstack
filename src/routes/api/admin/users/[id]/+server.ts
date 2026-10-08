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
import {
	user,
	session,
	userSettings,
	repertoire,
	userMove,
	userRepertoireMove,
	reviewedGame,
	drillSession,
	puzzleAttempt,
	importedGame,
	subscription,
	passwordResetToken,
	auditLog
} from '$lib/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { getStripe } from '$lib/stripe/client';

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

	// Toggle enabled
	if (body.enabled !== undefined) {
		// Cannot disable yourself
		if (targetId === admin.id) {
			throw error(400, 'You cannot disable your own account.');
		}

		await db.update(user).set({ enabled: body.enabled }).where(eq(user.id, targetId));

		// When disabling, immediately invalidate all their sessions
		if (!body.enabled) {
			await db.delete(session).where(eq(session.userId, targetId));
		}
	}

	// Change role
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

		await db.update(user).set({ role: body.role }).where(eq(user.id, targetId));
	}

	// Change username
	if (body.username !== undefined) {
		const newUsername = body.username;
		// Check uniqueness (skip if unchanged)
		if (newUsername !== target.username) {
			const [existing] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.username, newUsername));
			if (existing) {
				throw error(409, 'That username is already taken.');
			}
			await db.update(user).set({ username: newUsername }).where(eq(user.id, targetId));
		}
	}

	// Toggle emailVerified
	if (body.emailVerified !== undefined) {
		await db.update(user).set({ emailVerified: body.emailVerified }).where(eq(user.id, targetId));
	}

	// Audit log — record what changed.
	const changes: string[] = [];
	if (body.enabled !== undefined) changes.push(`enabled=${body.enabled}`);
	if (body.role !== undefined) changes.push(`role=${body.role}`);
	if (body.username !== undefined) changes.push(`username="${body.username}"`);
	if (body.emailVerified !== undefined) changes.push(`emailVerified=${body.emailVerified}`);
	if (changes.length > 0) {
		await db.insert(auditLog).values({
			adminUserId: admin.id,
			action: 'update_user',
			targetUserId: targetId,
			details: changes.join(', '),
			createdAt: new Date()
		});
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

	// Audit log — record before deletion (the target row will be gone after).
	await db.insert(auditLog).values({
		adminUserId: admin.id,
		action: 'delete_user',
		targetUserId: targetId,
		details: `Deleted user id=${targetId}`,
		createdAt: new Date()
	});

	// Cancel Stripe subscription if one exists.
	const [sub] = await db
		.select({ stripeSubscriptionId: subscription.stripeSubscriptionId })
		.from(subscription)
		.where(eq(subscription.userId, targetId));

	if (sub?.stripeSubscriptionId) {
		const stripe = getStripe();
		if (stripe) {
			try {
				await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
			} catch {
				// Subscription may already be cancelled or invalid in Stripe — proceed anyway.
			}
		}
	}

	// Cascade-delete all user data in FK-safe order (children before parents).
	await db.transaction(async (tx) => {
		await tx.delete(passwordResetToken).where(eq(passwordResetToken.userId, targetId));
		await tx.delete(subscription).where(eq(subscription.userId, targetId));
		await tx.delete(session).where(eq(session.userId, targetId));
		await tx.delete(puzzleAttempt).where(eq(puzzleAttempt.userId, targetId));
		await tx.delete(drillSession).where(eq(drillSession.userId, targetId));
		await tx.delete(importedGame).where(eq(importedGame.userId, targetId));
		await tx.delete(reviewedGame).where(eq(reviewedGame.userId, targetId));
		await tx.delete(userRepertoireMove).where(eq(userRepertoireMove.userId, targetId));
		await tx.delete(userMove).where(eq(userMove.userId, targetId));
		await tx.delete(repertoire).where(eq(repertoire.userId, targetId));
		await tx.delete(userSettings).where(eq(userSettings.userId, targetId));
		await tx.delete(user).where(eq(user.id, targetId));
	});

	return json({ success: true });
};
