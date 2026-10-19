import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getRawSql } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { resetDb, createUser } from '$lib/test/db-helpers';
import { runImportCycle } from './import-scheduler';

const IMPORT_LOCK_KEY = 42001;

async function heldImportLocks(): Promise<number> {
	const [{ n }] = await getRawSql()<[{ n: number }]>`
		SELECT count(*)::int AS n FROM pg_locks
		WHERE locktype = 'advisory' AND objid = ${IMPORT_LOCK_KEY}
	`;
	return n;
}

async function addSettings(
	userId: number,
	usernames: { lichessUsername?: string; chesscomUsername?: string }
) {
	await db.insert(userSettings).values({ userId, updatedAt: new Date(), ...usernames });
}

describe('auto-import cycle', () => {
	beforeEach(resetDb);

	it('releases the lock while other queries keep the pool busy', async () => {
		const u = await createUser();
		await addSettings(u, { lichessUsername: 'alice' });
		const sql = getRawSql();
		// Other requests using the pool during the cycle: without a reserved
		// connection, the unlock would usually land on a different connection.
		const importUser = vi.fn(async () => {
			await Promise.all(Array.from({ length: 8 }, () => sql`SELECT pg_sleep(0.02)`));
			return 0;
		});

		for (let i = 0; i < 5; i++) {
			const busy = Array.from({ length: 5 }, () => sql`SELECT pg_sleep(0.02)`);
			expect(await runImportCycle({ importUser, delayMs: 0 })).toBe('ran');
			await Promise.all(busy);
			expect(await heldImportLocks()).toBe(0);
		}
		expect(importUser).toHaveBeenCalledTimes(5);
	});

	it('skips the cycle while another instance holds the lock', async () => {
		const u = await createUser();
		await addSettings(u, { lichessUsername: 'alice' });
		const other = await getRawSql().reserve();
		try {
			await other`SELECT pg_advisory_lock(${IMPORT_LOCK_KEY})`;
			const importUser = vi.fn(async () => 0);
			expect(await runImportCycle({ importUser, delayMs: 0 })).toBe('skipped');
			expect(importUser).not.toHaveBeenCalled();
		} finally {
			await other`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`;
			other.release();
		}
	});

	it('does not start a second cycle while one is running', async () => {
		const u = await createUser();
		await addSettings(u, { lichessUsername: 'alice' });
		let finish!: () => void;
		const importUser = vi.fn(() => new Promise<number>((resolve) => (finish = () => resolve(0))));

		const first = runImportCycle({ importUser, delayMs: 0 });
		await vi.waitFor(() => expect(importUser).toHaveBeenCalled());
		expect(await runImportCycle({ importUser, delayMs: 0 })).toBe('busy');
		finish();
		expect(await first).toBe('ran');
		expect(await heldImportLocks()).toBe(0);
	});

	it('imports each configured platform and carries on after a failure', async () => {
		const both = await createUser();
		const none = await createUser();
		await addSettings(both, { lichessUsername: 'alice', chesscomUsername: 'alice_cc' });
		await addSettings(none, {});
		const importUser = vi.fn(async (_userId: number, source: string) => {
			if (source === 'LICHESS') throw new Error('Lichess is down');
			return 1;
		});

		expect(await runImportCycle({ importUser, delayMs: 0 })).toBe('ran');
		expect(importUser).toHaveBeenCalledTimes(2);
		expect(importUser).toHaveBeenNthCalledWith(1, both, 'LICHESS', 'alice', null);
		expect(importUser).toHaveBeenNthCalledWith(2, both, 'CHESSCOM', 'alice_cc', null);
		expect(await heldImportLocks()).toBe(0);
	});
});
