import { beforeEach, describe, expect, it } from 'vitest';
import { isRepertoireLocked } from './tiers.server';
import { resetDb, createUser, createRepertoire } from '$lib/test/db-helpers';

describe('isRepertoireLocked', () => {
	beforeEach(resetDb);

	it('leaves only the oldest repertoire unlocked for free users', async () => {
		const u = await createUser();
		const newer = await createRepertoire(u, new Date('2026-02-01'));
		const oldest = await createRepertoire(u, new Date('2026-01-01'));

		expect(await isRepertoireLocked(u, oldest, 'free')).toBe(false);
		expect(await isRepertoireLocked(u, newer, 'free')).toBe(true);
		expect(await isRepertoireLocked(u, newer, 'paid')).toBe(false);
	});

	it('breaks createdAt ties by id', async () => {
		const u = await createUser();
		const t = new Date('2026-01-01');
		const first = await createRepertoire(u, t);
		const second = await createRepertoire(u, t);
		expect(await isRepertoireLocked(u, first, 'free')).toBe(false);
		expect(await isRepertoireLocked(u, second, 'free')).toBe(true);
	});

	it("doesn't let another user's oldest repertoire affect locking", async () => {
		const a = await createUser();
		const b = await createUser();
		await createRepertoire(a, new Date('2025-01-01'));
		const bRep = await createRepertoire(b, new Date('2026-01-01'));
		expect(await isRepertoireLocked(b, bRep, 'free')).toBe(false);
	});
});
