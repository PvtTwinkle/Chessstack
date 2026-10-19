// Loops API client — sends transactional emails and manages contacts.
//
// If LOOPS_API_KEY or LOOPS_TRANSACTIONAL_ID is not set, email verification
// is disabled entirely. If LOOPS_API_KEY or LOOPS_PASSWORD_RESET_ID is not set,
// password reset is disabled entirely. Contact management is enabled whenever
// LOOPS_API_KEY is set. Each feature degrades independently.

import { log } from '$lib/server/log';

const LOOPS_TRANSACTIONAL_URL = 'https://app.loops.so/api/v1/transactional';
const LOOPS_CONTACTS_CREATE_URL = 'https://app.loops.so/api/v1/contacts/create';
const LOOPS_CONTACTS_UPDATE_URL = 'https://app.loops.so/api/v1/contacts/update';
const LOOPS_CONTACTS_DELETE_URL = 'https://app.loops.so/api/v1/contacts/delete';

export class LoopsApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
		this.name = 'LoopsApiError';
	}
}

let _initialized = false;
let _apiKey: string | null = null;
let _transactionalId: string | null = null;
let _passwordResetId: string | null = null;
let _emailVerificationEnabled = false;
let _passwordResetEnabled = false;
let _contactManagementEnabled = false;

function init() {
	if (_initialized) return;
	_initialized = true;
	_apiKey = process.env.LOOPS_API_KEY ?? null;
	_transactionalId = process.env.LOOPS_TRANSACTIONAL_ID ?? null;
	_passwordResetId = process.env.LOOPS_PASSWORD_RESET_ID ?? null;
	_emailVerificationEnabled = !!_apiKey && !!_transactionalId;
	_passwordResetEnabled = !!_apiKey && !!_passwordResetId;
	_contactManagementEnabled = !!_apiKey;
	if (_emailVerificationEnabled) {
		log.info('Loops email verification enabled.');
	}
	if (_passwordResetEnabled) {
		log.info('Loops password reset enabled.');
	}
	if (_contactManagementEnabled) {
		log.info('Loops contact management enabled.');
	}
}

/** Returns true if both LOOPS_API_KEY and LOOPS_TRANSACTIONAL_ID are set. */
export function isEmailVerificationEnabled(): boolean {
	init();
	return _emailVerificationEnabled;
}

/** Returns true if both LOOPS_API_KEY and LOOPS_PASSWORD_RESET_ID are set. */
export function isPasswordResetEnabled(): boolean {
	init();
	return _passwordResetEnabled;
}

// Loops normally answers in well under a second. A hung request must not hold
// up registration or an email change, which wait on these calls.
const LOOPS_TIMEOUT_MS = 10_000;

/** POSTs or PUTs to Loops and throws LoopsApiError unless it answers 2xx. */
async function loopsRequest(url: string, method: 'POST' | 'PUT', body: object): Promise<void> {
	const response = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${_apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(LOOPS_TIMEOUT_MS)
	});

	if (!response.ok) {
		const text = await response.text().catch(() => 'unknown error');
		throw new LoopsApiError(response.status, `Loops API error: ${response.status} — ${text}`);
	}
}

/**
 * Send a verification email via the Loops transactional API.
 * No-op when email verification is disabled.
 */
export async function sendVerificationEmail(email: string, verifyUrl: string): Promise<void> {
	init();
	if (!_emailVerificationEnabled) return;
	await loopsRequest(LOOPS_TRANSACTIONAL_URL, 'POST', {
		transactionalId: _transactionalId,
		email,
		dataVariables: { verifyUrl }
	});
}

/**
 * Send a password reset email via the Loops transactional API.
 * No-op when password reset is disabled.
 */
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
	init();
	if (!_passwordResetEnabled) return;
	await loopsRequest(LOOPS_TRANSACTIONAL_URL, 'POST', {
		transactionalId: _passwordResetId,
		email,
		dataVariables: { resetUrl }
	});
}

/**
 * Create a contact in Loops with registration details. The username is the
 * contact's userId, which later updates and deletes identify it by.
 * No-op when contact management is disabled (LOOPS_API_KEY not set).
 */
export async function createContact(data: { email: string; username: string }): Promise<void> {
	init();
	if (!_contactManagementEnabled) return;
	await loopsRequest(LOOPS_CONTACTS_CREATE_URL, 'POST', {
		email: data.email,
		userId: data.username
	});
}

/**
 * Change a contact's email address in Loops. Loops finds the contact by its
 * userId (the username, see createContact) and sets `email` to the new
 * address; sending the old address as `email` would only look it up.
 * No-op when contact management is disabled.
 */
export async function updateContactEmail(username: string, newEmail: string): Promise<void> {
	init();
	if (!_contactManagementEnabled) return;
	await loopsRequest(LOOPS_CONTACTS_UPDATE_URL, 'PUT', { userId: username, email: newEmail });
}

/**
 * Delete a contact from Loops when its account is deleted, so a deleted user
 * gets no more email. No-op when contact management is disabled.
 */
export async function deleteContact(username: string): Promise<void> {
	init();
	if (!_contactManagementEnabled) return;
	await loopsRequest(LOOPS_CONTACTS_DELETE_URL, 'POST', { userId: username });
}
