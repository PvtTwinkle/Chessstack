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

/** Returns true if LOOPS_API_KEY is set. */
export function isContactManagementEnabled(): boolean {
	init();
	return _contactManagementEnabled;
}

/**
 * Send a verification email via the Loops transactional API.
 * No-op when email verification is disabled.
 */
export async function sendVerificationEmail(email: string, verifyUrl: string): Promise<void> {
	init();
	if (!_emailVerificationEnabled) return;

	const response = await fetch(LOOPS_TRANSACTIONAL_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${_apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			transactionalId: _transactionalId,
			email,
			dataVariables: { verifyUrl }
		})
	});

	if (!response.ok) {
		const text = await response.text().catch(() => 'unknown error');
		throw new LoopsApiError(response.status, `Loops API error: ${response.status} — ${text}`);
	}
}

/**
 * Send a password reset email via the Loops transactional API.
 * No-op when password reset is disabled.
 */
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
	init();
	if (!_passwordResetEnabled) return;

	const response = await fetch(LOOPS_TRANSACTIONAL_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${_apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			transactionalId: _passwordResetId,
			email,
			dataVariables: { resetUrl }
		})
	});

	if (!response.ok) {
		const text = await response.text().catch(() => 'unknown error');
		throw new LoopsApiError(response.status, `Loops API error: ${response.status} — ${text}`);
	}
}

/**
 * Create a contact in Loops with registration details.
 * No-op when contact management is disabled (LOOPS_API_KEY not set).
 */
export async function createContact(data: { email: string; username: string }): Promise<void> {
	init();
	if (!_contactManagementEnabled) return;

	const response = await fetch(LOOPS_CONTACTS_CREATE_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${_apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			email: data.email,
			userId: data.username
		})
	});

	if (!response.ok) {
		const text = await response.text().catch(() => 'unknown error');
		throw new LoopsApiError(response.status, `Loops API error: ${response.status} — ${text}`);
	}
}

/**
 * Update a contact's email address in Loops.
 * The old email identifies the existing contact; the new email replaces it.
 * No-op when contact management is disabled.
 */
export async function updateContactEmail(oldEmail: string, newEmail: string): Promise<void> {
	init();
	if (!_contactManagementEnabled) return;

	const response = await fetch(LOOPS_CONTACTS_UPDATE_URL, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${_apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			email: oldEmail,
			newEmail
		})
	});

	if (!response.ok) {
		const text = await response.text().catch(() => 'unknown error');
		throw new LoopsApiError(response.status, `Loops API error: ${response.status} — ${text}`);
	}
}
