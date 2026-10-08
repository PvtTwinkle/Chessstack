import crypto from 'node:crypto';

// Excludes I, O, 0, 1 — visually ambiguous characters.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateReferralCode(): string {
	const bytes = crypto.randomBytes(8);
	return Array.from({ length: 8 }, (_, i) => CHARS[bytes[i] % CHARS.length]).join('');
}
