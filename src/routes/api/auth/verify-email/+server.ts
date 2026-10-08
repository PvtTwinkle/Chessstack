// GET /api/auth/verify-email?token=<token>
//
// This is the link the user clicks in their verification email.
// It is a public route (no session required) — the token itself
// is the proof of identity. On success, redirects to the dashboard, or to the
// page the user was on when they registered (see POST_VERIFY_REDIRECT_COOKIE).

import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { verifyEmailToken } from '$lib/auth/email-verification';
import { POST_VERIFY_REDIRECT_COOKIE, safeRedirectPath } from '$lib/auth/redirect';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const token = url.searchParams.get('token');
	if (!token) {
		redirect(302, '/verify-email?error=missing-token');
	}

	const result = await verifyEmailToken(token);
	if (result.success) {
		const next = safeRedirectPath(cookies.get(POST_VERIFY_REDIRECT_COOKIE));
		if (next) {
			cookies.delete(POST_VERIFY_REDIRECT_COOKIE, { path: '/' });
			redirect(302, next);
		}
		redirect(302, '/?verified=1');
	} else {
		redirect(302, '/verify-email?error=' + encodeURIComponent(result.reason));
	}
};
