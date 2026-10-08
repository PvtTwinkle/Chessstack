import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { emailVerificationToken, passwordResetToken, user } from '$lib/db/schema';
import { resetDb, createUser } from '$lib/test/db-helpers';
import { hashToken } from './token-hash';
import { verifyEmailToken } from './email-verification';
import { validatePasswordResetToken } from './password-reset';

const HOUR = 60 * 60 * 1000;

async function insertToken(
	table: typeof emailVerificationToken | typeof passwordResetToken,
	userId: number,
	raw: string,
	expiresInMs = HOUR
) {
	await db.insert(table).values({
		userId,
		tokenHash: hashToken(raw),
		expiresAt: new Date(Date.now() + expiresInMs),
		createdAt: new Date()
	});
}

describe('verifyEmailToken', () => {
	beforeEach(resetDb);

	it('verifies the user exactly once', async () => {
		const id = await createUser();
		await insertToken(emailVerificationToken, id, 'good-token');

		expect(await verifyEmailToken('good-token')).toEqual({ success: true, userId: id });
		const [u] = await db.select().from(user).where(eq(user.id, id));
		expect(u.emailVerified).toBe(true);

		expect(await verifyEmailToken('good-token')).toMatchObject({ success: false });
	});

	it('rejects unknown and expired tokens', async () => {
		const id = await createUser();
		await insertToken(emailVerificationToken, id, 'old-token', -1000);

		expect(await verifyEmailToken('nope')).toMatchObject({ success: false });
		expect(await verifyEmailToken('old-token')).toMatchObject({ success: false });
		const [u] = await db.select().from(user).where(eq(user.id, id));
		expect(u.emailVerified).toBe(false);
	});

	it('redeems a token only once under concurrent requests', async () => {
		const id = await createUser();
		await insertToken(emailVerificationToken, id, 'race-token');
		const results = await Promise.all(
			Array.from({ length: 8 }, () => verifyEmailToken('race-token'))
		);
		expect(results.filter((r) => r.success)).toHaveLength(1);
	});
});

describe('validatePasswordResetToken', () => {
	beforeEach(resetDb);

	it('returns the owning user once, then rejects reuse', async () => {
		const a = await createUser();
		const b = await createUser();
		await insertToken(passwordResetToken, a, 'token-a');
		await insertToken(passwordResetToken, b, 'token-b');

		expect(await validatePasswordResetToken('token-b')).toEqual({ success: true, userId: b });
		expect(await validatePasswordResetToken('token-b')).toMatchObject({ success: false });
		expect(await validatePasswordResetToken('token-a')).toEqual({ success: true, userId: a });
	});

	it('rejects expired tokens', async () => {
		const id = await createUser();
		await insertToken(passwordResetToken, id, 'expired', -1);
		expect(await validatePasswordResetToken('expired')).toMatchObject({ success: false });
	});

	it('redeems a token only once under concurrent requests', async () => {
		const id = await createUser();
		await insertToken(passwordResetToken, id, 'race');
		const results = await Promise.all(
			Array.from({ length: 8 }, () => validatePasswordResetToken('race'))
		);
		expect(results.filter((r) => r.success)).toHaveLength(1);
	});
});
