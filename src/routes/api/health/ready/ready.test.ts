import { describe, expect, it, vi } from 'vitest';

const sql = vi.hoisted(() => vi.fn());
vi.mock('$lib/db', () => ({ getRawSql: () => sql }));

const { GET } = await import('./+server');

describe('GET /api/health/ready', () => {
	it('returns 200 when the database answers', async () => {
		sql.mockResolvedValueOnce([{ '?column?': 1 }]);
		const res = await GET({} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 'ok', db: 'ok' });
	});

	it('returns 503 when the database query fails', async () => {
		sql.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		const res = await GET({} as never);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ status: 'error', db: 'unreachable' });
	});

	it('returns 503 when the database hangs', async () => {
		vi.useFakeTimers();
		sql.mockReturnValueOnce(new Promise(() => {}));
		const pending = GET({} as never);
		await vi.advanceTimersByTimeAsync(2001);
		expect((await pending).status).toBe(503);
		vi.useRealTimers();
	});
});
