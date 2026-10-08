// PATCH /api/account/email — update the authenticated user's email address.
//
// Validates format, enforces uniqueness, and stores lowercase.
// Lives under /api/account (not /api/settings) because email is on the
// user table, not the user_settings table.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { updateContactEmail } from '$lib/loops';
import { requireAuth } from '$lib/server/api-helpers';
import { log } from '$lib/server/log';
import { parseBody } from '$lib/server/validation';
import { updateEmailSchema } from '$lib/server/schemas/account';

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const authedUser = requireAuth(locals);

	const { email } = await parseBody(request, updateEmailSchema);

	// Check uniqueness — make sure no other user has this email.
	const [existing] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.email, email), ne(user.id, authedUser.id)));
	if (existing) {
		throw error(409, 'That email address is already in use.');
	}

	const oldEmail = authedUser.email;

	await db.update(user).set({ email }).where(eq(user.id, authedUser.id));

	// Update contact email in Loops if it actually changed.
	if (oldEmail && oldEmail !== email) {
		try {
			await updateContactEmail(oldEmail, email);
		} catch (e) {
			log.error('Failed to update Loops contact email', {
				tag: 'LOOPS_CONTACT_FAILURE',
				userId: authedUser.id,
				oldEmail,
				newEmail: email,
				err: e
			});
		}
	}

	return json({ updated: true, email });
};
