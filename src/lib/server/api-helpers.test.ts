import { describe, it, expect, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/auth/rate-limit', () => ({ isRateLimited: vi.fn() }));

import { isRateLimited } from '$lib/auth/rate-limit';
import { rateLimitResponse, parseIntParam, requireAdmin, requireAuth } from './api-helpers';

const user = { id: 7, role: 'user' } as App.Locals['user'];
const admin = { id: 1, role: 'admin' } as App.Locals['user'];
const locals = (u: App.Locals['user']) => ({ user: u }) as App.Locals;

function statusOf(fn: () => unknown): number | undefined {
	try {
		fn();
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
	return undefined;
}

describe('requireAuth and requireAdmin', () => {
	it('returns the user, or 401 when signed out', () => {
		expect(requireAuth(locals(user))).toBe(user);
		expect(statusOf(() => requireAuth(locals(null)))).toBe(401);
	});

	it('answers 401 for signed-out callers and 403 for non-admins', () => {
		expect(requireAdmin(locals(admin))).toBe(admin);
		expect(statusOf(() => requireAdmin(locals(null)))).toBe(401);
		expect(statusOf(() => requireAdmin(locals(user)))).toBe(403);
	});
});

describe('parseIntParam', () => {
	it('accepts a positive int4', () => {
		expect(parseIntParam('12', 'id')).toBe(12);
		expect(parseIntParam('2147483647', 'id')).toBe(2_147_483_647);
	});

	it.each(['12abc', '-1', '0', '1.5', '', ' 3', '2147483648', '99999999999'])(
		'rejects %j with 400',
		(value) => {
			expect(statusOf(() => parseIntParam(value, 'id'))).toBe(400);
		}
	);

	it('rejects a missing param', () => {
		expect(statusOf(() => parseIntParam(undefined, 'id'))).toBe(400);
	});
});

describe('rateLimitResponse', () => {
	const limit = { prefix: 'test', max: 1, windowMs: 5 * 60 * 1000 };

	it('lets the request through under the limit', async () => {
		vi.mocked(isRateLimited).mockResolvedValueOnce(false);
		await expect(rateLimitResponse(7, limit)).resolves.toBeNull();
		expect(isRateLimited).toHaveBeenCalledWith('7', limit);
	});

	it('returns a JSON 429 with Retry-After over the limit', async () => {
		vi.mocked(isRateLimited).mockResolvedValueOnce(true);
		const res = (await rateLimitResponse(7, limit))!;
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('300');
		expect(await res.json()).toEqual({ message: 'Too many requests. Please try again later.' });
	});
});
