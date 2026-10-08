// Server-side logic for the email verification waiting page.
//
// Redirects away if the user is already verified or if email
// verification is not enabled. Otherwise returns the user's
// email address so the page can tell them where to look.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { isEmailVerificationEnabled } from '$lib/loops';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	if (!isEmailVerificationEnabled() || locals.user.emailVerified) redirect(302, '/');
	return { email: locals.user.email };
};
