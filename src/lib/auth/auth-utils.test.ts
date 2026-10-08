import { describe, expect, it } from 'vitest';
import { validatePassword } from './password';
import { hashToken } from './token-hash';
import { generateReferralCode } from './referral-code';

describe('validatePassword', () => {
	it('accepts a password meeting every rule', () => {
		expect(validatePassword('Correct-Horse-9')).toBeNull();
	});

	it.each([
		['Short-1a', 'at least 12'],
		['ALLUPPERCASE-123', 'lowercase'],
		['alllowercase-123', 'uppercase'],
		['NoNumbersHere-!', 'number'],
		['NoSpecials12345', 'special']
	])('rejects %s (%s)', (pw, msg) => {
		expect(validatePassword(pw)).toContain(msg);
	});
});

describe('hashToken', () => {
	it('is a deterministic 64-char hex SHA-256 digest', () => {
		const h = hashToken('abc');
		expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(hashToken('abc')).toBe(h);
		expect(hashToken('abd')).not.toBe(h);
	});
});

describe('generateReferralCode', () => {
	it('produces 8 unambiguous uppercase characters', () => {
		for (let i = 0; i < 200; i++) {
			expect(generateReferralCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
		}
	});
});
