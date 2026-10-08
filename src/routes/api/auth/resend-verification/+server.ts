// POST /api/auth/resend-verification
//
// Sends a new verification email to the logged-in user. Rate-limited
// to prevent abuse (3 per IP per 15 minutes).

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { isEmailVerificationEnabled } from '$lib/loops';
import { createAndSendVerification } from '$lib/auth/email-verification';
import { isRateLimited } from '$lib/auth/rate-limit';
import { requireAuth } from '$lib/server/api-helpers';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ locals, getClientAddress }) => {
	const user = requireAuth(locals);
	if (!isEmailVerificationEnabled()) throw error(503, 'Email verification not configured');
	if (user.emailVerified) return json({ message: 'Already verified' });
	if (!user.email) throw error(400, 'No email on account');

	const ip = getClientAddress();
	if (await isRateLimited(ip, { prefix: 'resend-verify', max: 3, windowMs: 15 * 60 * 1000 })) {
		throw error(429, 'Too many requests. Please try again later.');
	}

	try {
		await createAndSendVerification(user.id, user.email);
	} catch (e) {
		log.error('Resend verification email failed', {
			tag: 'EMAIL_SEND_FAILURE',
			userId: user.id,
			email: user.email,
			err: e
		});
		throw error(502, 'Could not send verification email. Please try again later.');
	}

	return json({ message: 'Verification email sent' });
};
