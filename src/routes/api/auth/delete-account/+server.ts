// DELETE /api/auth/delete-account — Self-service account deletion.
//
// Requires the user's current password in the request body. Cancels any
// active Stripe subscription (and stops with a 502 if it can't), deletes the
// account and all its data ($lib/server/delete-account), clears the session
// cookie, and returns success so the client can redirect.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE_NAME, SECURE_COOKIE } from '$lib/auth';
import { verifyCurrentPassword } from '$lib/auth/account';
import { deleteUserAccount, SubscriptionNotCancelledError } from '$lib/server/delete-account';
import { log } from '$lib/server/log';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { deleteAccountSchema } from '$lib/server/schemas/account';

export const DELETE: RequestHandler = async ({ locals, request, cookies }) => {
	const authedUser = requireAuth(locals);

	const { password } = await parseBody(request, deleteAccountSchema);

	// Verify the password before doing anything destructive.
	await verifyCurrentPassword(authedUser.id, password);

	try {
		await deleteUserAccount(authedUser.id);
	} catch (err) {
		if (!(err instanceof SubscriptionNotCancelledError)) throw err;
		log.error('Stripe cancel failed; account not deleted', {
			userId: authedUser.id,
			err: err.cause
		});
		throw error(
			502,
			"We couldn't cancel your subscription, so your account has not been deleted. Please try again in a few minutes."
		);
	}

	// Clear the session cookie so the browser forgets the (now-deleted) token.
	cookies.delete(SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE });

	return json({ success: true });
};
