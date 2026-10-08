// Server-side logic for the login page.
//
// In SvelteKit, "actions" are functions that handle form submissions.
// When the user fills in the login form and clicks "Sign in", the browser
// sends a POST request here. This code runs on the server — never in the browser.
//
// If login succeeds: create a session, set a cookie, redirect to dashboard.
// If login fails:    return an error message that the page can display.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { createSession, SESSION_COOKIE_NAME, SECURE_COOKIE } from '$lib/auth';
import { isRateLimited, resetRateLimit } from '$lib/auth/rate-limit';
import { isEmailVerificationEnabled, isPasswordResetEnabled } from '$lib/loops';
import { createAndSendVerification } from '$lib/auth/email-verification';
import { safeRedirectPath } from '$lib/auth/redirect';
import { log } from '$lib/server/log';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';

// Pre-computed bcrypt hash used when a login attempt targets a non-existent username.
// Without this, requests for missing users skip bcrypt entirely and return ~100ms faster,
// letting an attacker enumerate valid usernames by measuring response times.
const DUMMY_HASH = bcrypt.hashSync('dummy-timing-pad', 10);

export const load: PageServerLoad = async ({ url }) => {
	return {
		registrationOpen: REGISTRATION_MODE === 'open',
		passwordResetEnabled: isPasswordResetEnabled(),
		// Where to go after signing in, e.g. back to the opening guide that sent
		// the visitor here. Passed through the form as a hidden field.
		redirectTo: safeRedirectPath(url.searchParams.get('redirectTo'))
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		// Rate limit check — block brute-force login attempts.
		// Uses database-backed rate limiting so it works across multiple instances.
		const clientIp = getClientAddress();
		if (await isRateLimited(clientIp, { prefix: 'login', max: 10, windowMs: 15 * 60 * 1000 })) {
			return fail(429, { error: 'Too many login attempts. Please try again in 15 minutes.' });
		}

		// Read the values the user typed into the form.
		const formData = await request.formData();
		const username = formData.get('username')?.toString().trim();
		const password = formData.get('password')?.toString();
		const redirectTo = safeRedirectPath(formData.get('redirectTo')) ?? '/';

		// Basic presence check — both fields must be filled in.
		if (!username || !password) {
			return fail(400, { error: 'Username and password are required.' });
		}

		// Look up the user by username.
		const [foundUser] = await db.select().from(user).where(eq(user.username, username));

		// Always run bcrypt regardless of whether the user exists — this prevents
		// timing-based username enumeration (bcrypt takes ~100ms, so skipping it
		// for missing users would reveal which usernames are valid).
		const hashToCompare = foundUser?.passwordHash ?? DUMMY_HASH;
		const passwordValid = await bcrypt.compare(password, hashToCompare);
		if (!foundUser || !passwordValid) {
			log.warn('Failed login attempt', { username });
			return fail(400, { error: 'Invalid username or password.' });
		}

		// Account disabled by admin — specific message since the user already knows their username.
		if (!foundUser.enabled) {
			log.warn('Login blocked — account is disabled', { username });
			return fail(403, { error: 'This account has been disabled.' });
		}

		// Credentials are correct — clear the rate limit counter for this IP.
		await resetRateLimit(clientIp, 'login');

		// Create a session in the database.
		// createSession() returns the random UUID token to put in the cookie.
		const token = await createSession(foundUser.id);

		// Set the session cookie in the browser.
		cookies.set(SESSION_COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: SECURE_COOKIE,
			maxAge: 60 * 60 * 24 * 14 // 14 days in seconds
		});

		// If the user's email is unverified and Loops is configured, send a
		// verification email and redirect to /verify-email instead of the dashboard.
		// This handles admin-created users on their first login.
		if (isEmailVerificationEnabled() && !foundUser.emailVerified && foundUser.email) {
			try {
				await createAndSendVerification(foundUser.id, foundUser.email);
			} catch (e) {
				log.error('Failed to send verification email', { err: e });
			}
			redirect(303, '/verify-email');
		}

		// Redirect to the dashboard, or back to the page that sent the user here.
		// The browser follows this automatically. The 303 status tells the browser
		// to use GET for the redirect (important after a POST — prevents
		// "resubmit form?" warnings on refresh).
		redirect(303, redirectTo);
	}
};
