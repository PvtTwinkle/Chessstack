import { beforeEach, describe, expect, it } from 'vitest';
import { isRateLimited, resetRateLimit } from './rate-limit';
import { getRawSql } from '$lib/db';
import { resetDb } from '$lib/test/db-helpers';

const opts = { prefix: 'login', max: 3, windowMs: 15 * 60 * 1000 };

describe('isRateLimited', () => {
	beforeEach(resetDb);

	it('allows up to max attempts, then limits', async () => {
		const results = [];
		for (let i = 0; i < 5; i++) results.push(await isRateLimited('1.2.3.4', opts));
		expect(results).toEqual([false, false, false, true, true]);
	});

	it('tracks keys independently per IP and per prefix', async () => {
		for (let i = 0; i < 3; i++) await isRateLimited('1.1.1.1', opts);
		expect(await isRateLimited('1.1.1.1', opts)).toBe(true);
		expect(await isRateLimited('2.2.2.2', opts)).toBe(false);
		expect(await isRateLimited('1.1.1.1', { ...opts, prefix: 'register' })).toBe(false);
	});

	it('starts a fresh window once the old one has expired', async () => {
		for (let i = 0; i < 4; i++) await isRateLimited('9.9.9.9', opts);
		expect(await isRateLimited('9.9.9.9', opts)).toBe(true);

		await getRawSql()`
			UPDATE rate_limit SET window_start = NOW() - INTERVAL '16 minutes' WHERE key = 'login:9.9.9.9'
		`;
		expect(await isRateLimited('9.9.9.9', opts)).toBe(false);
	});

	it('counts concurrent attempts atomically', async () => {
		const results = await Promise.all(
			Array.from({ length: 10 }, () => isRateLimited('5.5.5.5', opts))
		);
		expect(results.filter((limited) => !limited)).toHaveLength(3);
	});

	it('resetRateLimit clears the counter', async () => {
		for (let i = 0; i < 4; i++) await isRateLimited('7.7.7.7', opts);
		await resetRateLimit('7.7.7.7', 'login');
		expect(await isRateLimited('7.7.7.7', opts)).toBe(false);
	});
});
