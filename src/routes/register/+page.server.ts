// Server-side logic for the registration page.
//
// Only accessible when REGISTRATION_MODE=open.
// Creates a new user with role='user', creates a session, and redirects to the dashboard
// (or to ?redirectTo=, e.g. the opening guide the visitor came from).
// Includes basic rate limiting to prevent registration abuse.
// Self-hosted instances make the email optional and have no referral codes.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq, count } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { generateReferralCode } from '$lib/auth/referral-code';
import { createSession, SESSION_COOKIE_NAME, SECURE_COOKIE } from '$lib/auth';
import { isRateLimited } from '$lib/auth/rate-limit';
import { REGISTER_RATE_LIMIT } from '$lib/auth/rate-limit-config';
import { validatePassword } from '$lib/auth/password';
import { USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH } from '$lib/validation-limits';
import { isEmailVerificationEnabled, createContact } from '$lib/loops';
import { createAndSendVerification } from '$lib/auth/email-verification';
import { POST_VERIFY_REDIRECT_COOKIE, safeRedirectPath } from '$lib/auth/redirect';
import { log } from '$lib/server/log';
import { IS_CLOUD } from '$lib/server/edition';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';

export const load: PageServerLoad = async ({ url }) => {
	if (REGISTRATION_MODE !== 'open') {
		error(404, 'Registration is not available');
	}
	return {
		// Where to go once the account exists, e.g. back to the opening guide
		// that sent the visitor here. Passed through the form as a hidden field.
		redirectTo: safeRedirectPath(url.searchParams.get('redirectTo'))
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		if (REGISTRATION_MODE !== 'open') {
			error(404, 'Registration is not available');
		}

		const ip = getClientAddress();
		if (await isRateLimited(ip, REGISTER_RATE_LIMIT)) {
			return fail(429, { error: 'Too many registration attempts. Please try again later.' });
		}

		const formData = await request.formData();
		const username = formData.get('username')?.toString().trim();
		const email = formData.get('email')?.toString().trim().toLowerCase() || null;
		const password = formData.get('password')?.toString();
		const confirmPassword = formData.get('confirmPassword')?.toString();
		const referralCodeInput = IS_CLOUD
			? formData.get('referralCode')?.toString().trim().toUpperCase() || null
			: null;
		const redirectTo = safeRedirectPath(formData.get('redirectTo'));

		// Validation
		if (IS_CLOUD && (!username || !email || !password)) {
			return fail(400, { error: 'Username, email, and password are required.' });
		}
		if (!username || !password) {
			return fail(400, { error: 'Username and password are required.' });
		}
		if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
			return fail(400, { error: 'Please enter a valid email address.' });
		}
		if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
			return fail(400, {
				error: `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.`
			});
		}
		if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
			return fail(400, {
				error: 'Username may only contain letters, numbers, hyphens, and underscores.'
			});
		}
		const passwordErr = validatePassword(password);
		if (passwordErr) {
			return fail(400, { error: passwordErr });
		}
		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		// Check for duplicate username
		const [existingUsername] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.username, username));
		if (existingUsername) {
			return fail(400, { error: 'That username is already taken.' });
		}

		// Check for duplicate email
		const [existingEmail] = email
			? await db.select({ id: user.id }).from(user).where(eq(user.email, email))
			: [];
		if (existingEmail) {
			return fail(400, { error: 'That email address is already in use.' });
		}

		// Resolve referral code to a referrer user ID.
		let referredByUserId: number | null = null;
		if (referralCodeInput) {
			const [referrer] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.referralCode, referralCodeInput));
			if (!referrer) {
				return fail(400, { referralCodeError: 'That referral code is not valid.' });
			}
			referredByUserId = referrer.id;
		}

		// If this is the very first user on a fresh database, promote them to admin.
		// This solves the bootstrap problem: deploy with REGISTRATION_MODE=open,
		// register once (you become admin), then switch to invite mode.
		const [{ total }] = await db.select({ total: count() }).from(user);
		const role = total === 0 ? 'admin' : 'user';

		// Create user
		const passwordHash = await bcrypt.hash(password, 10);
		const [newUser] = await db
			.insert(user)
			.values({
				username,
				email,
				passwordHash,
				role,
				enabled: true,
				referralCode: generateReferralCode(),
				referredByUserId,
				createdAt: new Date()
			})
			.returning({ id: user.id });

		// Create session and set cookie
		const token = await createSession(newUser.id);
		cookies.set(SESSION_COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: SECURE_COOKIE,
			maxAge: 60 * 60 * 24 * 14
		});

		// Create contact in Loops for self-registered users.
		// Errors are caught — this is non-critical.
		if (email) {
			try {
				await createContact({
					email,
					username
				});
			} catch (e) {
				log.error('Failed to create Loops contact', {
					tag: 'LOOPS_CONTACT_FAILURE',
					userId: newUser.id,
					email,
					err: e
				});
			}
		}

		// Send verification email if Loops is configured.
		// Errors are caught — the user can resend from /verify-email.
		if (email && isEmailVerificationEnabled()) {
			let emailSendFailed = false;
			try {
				await createAndSendVerification(newUser.id, email);
			} catch (e) {
				emailSendFailed = true;
				log.error('Registration verification email failed', {
					tag: 'EMAIL_SEND_FAILURE',
					userId: newUser.id,
					email,
					err: e
				});
			}
			// The verification link brings them back to redirectTo (see
			// /api/auth/verify-email) when it is opened in this browser.
			if (redirectTo) {
				cookies.set(POST_VERIFY_REDIRECT_COOKIE, redirectTo, {
					path: '/',
					httpOnly: true,
					sameSite: 'lax',
					secure: SECURE_COOKIE,
					maxAge: 60 * 60 * 24
				});
			}
			redirect(303, emailSendFailed ? '/verify-email?send=failed' : '/verify-email');
		}

		redirect(303, redirectTo ?? '/');
	}
};
