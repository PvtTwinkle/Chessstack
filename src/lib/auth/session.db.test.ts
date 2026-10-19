import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { session } from '$lib/db/schema';
import { resetDb, createUser } from '$lib/test/db-helpers';
import { createSession, deleteSession, hashSessionToken, validateSession } from './index';

const DAY_MS = 24 * 60 * 60 * 1000;

async function expiresAt(token: string): Promise<number | undefined> {
	const [row] = await db
		.select()
		.from(session)
		.where(eq(session.id, hashSessionToken(token)));
	return row?.expiresAt.getTime();
}

async function setExpiry(token: string, msFromNow: number): Promise<void> {
	await db
		.update(session)
		.set({ expiresAt: new Date(Date.now() + msFromNow) })
		.where(eq(session.id, hashSessionToken(token)));
}

describe('validateSession', () => {
	beforeEach(resetDb);

	it('leaves a session started today alone', async () => {
		const userId = await createUser();
		const token = await createSession(userId);
		const before = await expiresAt(token);

		await expect(validateSession(token)).resolves.toEqual({ userId, renewed: false });
		expect(await expiresAt(token)).toBe(before);
	});

	it('pushes the expiry back to 14 days once a session is over a day old', async () => {
		const userId = await createUser();
		const token = await createSession(userId);
		await setExpiry(token, 3 * DAY_MS);

		await expect(validateSession(token)).resolves.toEqual({ userId, renewed: true });
		const renewed = (await expiresAt(token))! - Date.now();
		expect(renewed).toBeGreaterThan(14 * DAY_MS - 60_000);
		expect(renewed).toBeLessThanOrEqual(14 * DAY_MS);

		// The next request the same day writes nothing.
		await expect(validateSession(token)).resolves.toEqual({ userId, renewed: false });
	});

	it('rejects and deletes an expired session', async () => {
		const userId = await createUser();
		const token = await createSession(userId);
		await setExpiry(token, -1000);

		await expect(validateSession(token)).resolves.toBeNull();
		expect(await expiresAt(token)).toBeUndefined();
	});

	it('rejects an unknown token', async () => {
		await expect(validateSession('no-such-token')).resolves.toBeNull();
	});

	it('stores only a hash of the token', async () => {
		const userId = await createUser();
		const token = await createSession(userId);
		const rows = await db.select().from(session);
		expect(rows.map((r) => r.id)).toEqual([hashSessionToken(token)]);
		expect(rows[0].id).not.toContain(token);
	});

	it('deletes a session by its token', async () => {
		const userId = await createUser();
		const token = await createSession(userId);
		await deleteSession(token);
		await expect(validateSession(token)).resolves.toBeNull();
	});
});
