// POST /api/admin/users — Create a new user (admin only).
// Used by the admin panel to add accounts in both open and invite modes.

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user, auditLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { createUserSchema } from '$lib/server/schemas/admin';
import { IS_CLOUD } from '$lib/server/edition';
import { usernameMatches } from '$lib/auth/username';
import { isUniqueViolation } from '$lib/server/db-errors';

export const POST: RequestHandler = async ({ locals, request }) => {
	const admin = requireAdmin(locals);

	const { username, email, password } = await parseBody(request, createUserSchema);
	// Self-hosted accounts may have no email.
	if (IS_CLOUD && !email) {
		throw error(400, 'Username, email, and password are required.');
	}

	// Usernames are unique regardless of case (usernameMatches); the unique
	// indexes behind the insert catch a race between these checks and it.
	const [existingUsername] = await db
		.select({ id: user.id })
		.from(user)
		.where(usernameMatches(username));
	if (existingUsername) {
		throw error(409, 'That username is already taken.');
	}

	const [existingEmail] = email
		? await db.select({ id: user.id }).from(user).where(eq(user.email, email))
		: [];
	if (existingEmail) {
		throw error(409, 'That email address is already in use.');
	}

	const passwordHash = await bcrypt.hash(password, 10);
	let newUser;
	try {
		newUser = await db.transaction(async (tx) => {
			const [created] = await tx
				.insert(user)
				.values({
					username,
					email,
					passwordHash,
					role: 'user',
					enabled: true,
					createdAt: new Date()
				})
				.returning({
					id: user.id,
					username: user.username,
					role: user.role,
					enabled: user.enabled,
					createdAt: user.createdAt
				});
			await tx.insert(auditLog).values({
				adminUserId: admin.id,
				action: 'create_user',
				targetUserId: created.id,
				details: `Created user "${username}"`,
				createdAt: new Date()
			});
			return created;
		});
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw error(409, 'That username or email address is already in use.');
		}
		throw err;
	}

	return json(newUser, { status: 201 });
};
