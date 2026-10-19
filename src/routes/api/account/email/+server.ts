// PATCH /api/account/email — update the authenticated user's email address.
//
// Requires the current password. Validates format, enforces uniqueness, and
// stores lowercase. The new address must be verified again: when email
// verification is on, the user is sent a link and kept on /verify-email until
// they click it (verificationRequired tells the client to go there).
// Lives under /api/account (not /api/settings) because email is on the
// user table, not the user_settings table.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { isEmailVerificationEnabled, updateContactEmail } from '$lib/loops';
import { isUniqueViolation } from '$lib/server/db-errors';
import { changeEmail, verifyCurrentPassword } from '$lib/auth/account';
import { createAndSendVerification } from '$lib/auth/email-verification';
import { requireAuth } from '$lib/server/api-helpers';
import { log } from '$lib/server/log';
import { parseBody } from '$lib/server/validation';
import { updateEmailSchema } from '$lib/server/schemas/account';

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const authedUser = requireAuth(locals);

	const { email, password } = await parseBody(request, updateEmailSchema);

	// Checked before the uniqueness lookup, so the 409 below can't be used to
	// find out which addresses have accounts without knowing the password.
	await verifyCurrentPassword(authedUser.id, password);

	// Check uniqueness — make sure no other user has this email.
	const [existing] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.email, email), ne(user.id, authedUser.id)));
	if (existing) {
		throw error(409, 'That email address is already in use.');
	}

	const hadEmail = authedUser.email !== null;

	let changed: boolean;
	try {
		changed = await changeEmail(authedUser.id, email);
	} catch (e) {
		// Another account took the address between the check above and now.
		if (isUniqueViolation(e)) throw error(409, 'That email address is already in use.');
		throw e;
	}
	if (!changed) {
		return json({ updated: false, email, verificationRequired: false });
	}

	// Update the contact's email in Loops (it has one only if the account did).
	if (hadEmail) {
		try {
			await updateContactEmail(authedUser.username, email);
		} catch (e) {
			log.warn('Failed to update Loops contact email', {
				tag: 'LOOPS_CONTACT_FAILURE',
				userId: authedUser.id,
				reason: e instanceof Error ? e.message : String(e)
			});
		}
	}

	const verificationRequired = isEmailVerificationEnabled();
	if (verificationRequired) {
		// A failed send is not fatal: /verify-email has a resend button.
		try {
			await createAndSendVerification(authedUser.id, email);
		} catch (e) {
			log.error('Verification email for a changed address failed', {
				tag: 'EMAIL_SEND_FAILURE',
				userId: authedUser.id,
				err: e
			});
		}
	}

	return json({ updated: true, email, verificationRequired });
};
