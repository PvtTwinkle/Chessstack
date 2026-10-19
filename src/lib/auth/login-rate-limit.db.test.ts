import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '$lib/test/db-helpers';
import { clearLoginFailures, isLoginRateLimited } from './login-rate-limit';
import { LOGIN_ACCOUNT_RATE_LIMIT, LOGIN_RATE_LIMIT } from './rate-limit-config';

describe('login rate limit', () => {
	beforeEach(resetDb);

	it("signing in to your own account doesn't reset the count against another", async () => {
		// The attack: guess at the victim, sign in to your own account, repeat.
		for (let i = 0; i < LOGIN_ACCOUNT_RATE_LIMIT.max; i++) {
			expect(await isLoginRateLimited('1.1.1.1', 'victim')).toBe(false);
			if (i % 5 === 4) {
				await isLoginRateLimited('1.1.1.1', 'attacker');
				await clearLoginFailures('attacker');
			}
		}
		expect(await isLoginRateLimited('1.1.1.1', 'victim')).toBe(true);
	});

	it('limits guesses at one account from many addresses', async () => {
		for (let i = 0; i < LOGIN_ACCOUNT_RATE_LIMIT.max; i++) {
			expect(await isLoginRateLimited(`10.0.0.${i}`, 'victim')).toBe(false);
		}
		expect(await isLoginRateLimited('10.0.1.1', 'Victim')).toBe(true);
		// Other accounts are unaffected.
		expect(await isLoginRateLimited('10.0.1.1', 'someone-else')).toBe(false);
	});

	it('limits one address across many usernames', async () => {
		for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
			expect(await isLoginRateLimited('2.2.2.2', `user${i}`)).toBe(false);
		}
		expect(await isLoginRateLimited('2.2.2.2', 'fresh-name')).toBe(true);
		expect(await isLoginRateLimited('3.3.3.3', 'fresh-name')).toBe(false);
	});

	it("a successful sign-in clears that account's count", async () => {
		for (let i = 0; i < LOGIN_ACCOUNT_RATE_LIMIT.max; i++) {
			await isLoginRateLimited(`10.0.0.${i}`, 'me');
		}
		await clearLoginFailures('Me');
		expect(await isLoginRateLimited('10.0.2.1', 'me')).toBe(false);
	});
});
