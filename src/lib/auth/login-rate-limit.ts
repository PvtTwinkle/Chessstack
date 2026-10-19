// Brute-force protection for the login form.
//
// Attempts are counted per client IP and separately per username, so guesses
// at one account are limited however many addresses they come from. A
// successful sign-in clears only that account's count, never the IP's: an
// attacker could otherwise reset the IP count by signing in to their own
// account between guesses at someone else's.

import { isRateLimited, resetRateLimit } from '$lib/auth/rate-limit';
import { LOGIN_ACCOUNT_RATE_LIMIT, LOGIN_RATE_LIMIT } from '$lib/auth/rate-limit-config';

// Usernames are matched exactly at login, but "Kevin" and "kevin" share a count
// so changing the case doesn't buy more guesses.
function accountKey(username: string): string {
	return username.toLowerCase();
}

/** Counts one login attempt; true when the IP or the username is over its limit. */
export async function isLoginRateLimited(ip: string, username: string): Promise<boolean> {
	// Both counts go up on every attempt, even when the first is already over.
	const [ipLimited, accountLimited] = await Promise.all([
		isRateLimited(ip, LOGIN_RATE_LIMIT),
		isRateLimited(accountKey(username), LOGIN_ACCOUNT_RATE_LIMIT)
	]);
	return ipLimited || accountLimited;
}

/** Clears an account's failed attempts after it signs in or resets its password. */
export async function clearLoginFailures(username: string): Promise<void> {
	await resetRateLimit(accountKey(username), LOGIN_ACCOUNT_RATE_LIMIT.prefix);
}
