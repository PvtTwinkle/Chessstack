import { describe, expect, it, vi } from 'vitest';

const reserve = vi.hoisted(() => vi.fn());
vi.mock('$lib/db', () => ({ db: {}, getRawSql: () => ({ reserve }) }));
const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('$lib/server/log', () => ({ log }));

const { runScheduledCycle, runImportCycle } = await import('./import-scheduler');

describe('runScheduledCycle', () => {
	it('logs a database outage instead of rejecting', async () => {
		const outage = new Error('connect ECONNREFUSED 127.0.0.1:5432');
		reserve.mockRejectedValueOnce(outage);

		await expect(runScheduledCycle()).resolves.toBeUndefined();
		expect(log.error).toHaveBeenCalledWith('Auto-import cycle error', { err: outage });
	});

	it('runs the next cycle after a failed one', async () => {
		reserve.mockRejectedValueOnce(new Error('connection reset'));
		await runScheduledCycle();

		const conn = Object.assign(vi.fn().mockResolvedValue([{ acquired: false }]), {
			release: vi.fn()
		});
		reserve.mockResolvedValueOnce(conn);
		expect(await runImportCycle()).toBe('skipped');
		expect(conn.release).toHaveBeenCalled();
	});
});
