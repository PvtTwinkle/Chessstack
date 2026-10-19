import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { emailVerificationToken, passwordResetToken, user } from '$lib/db/schema';
import { resetDb, createUser } from '$lib/test/db-helpers';
import { changeEmail, verifyCurrentPassword } from './account';
import { PASSWORD_CHECK_RATE_LIMIT } from './rate-limit-config';

const PASSWORD = 'Correct-Horse-9';

async function insertTokens(userId: number, usedAt: Date | null) {
	for (const table of [emailVerificationToken, passwordResetToken]) {
		await db.insert(table).values({
			userId,
			tokenHash: `${table === emailVerificationToken ? 'v' : 'r'}-${userId}-${usedAt ? 'used' : 'open'}`,
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			usedAt,
			createdAt: new Date()
		});
	}
}

describe('verifyCurrentPassword', () => {
	beforeEach(resetDb);

	it('accepts the right password and rejects a wrong one with 403', async () => {
		const id = await createUser({ passwordHash: bcrypt.hashSync(PASSWORD, 4) });
		await expect(verifyCurrentPassword(id, PASSWORD)).resolves.toBeUndefined();
		await expect(verifyCurrentPassword(id, 'wrong', 'Nope')).rejects.toMatchObject({
			status: 403,
			body: { message: 'Nope' }
		});
	});

	it('limits attempts per user, even with the right password', async () => {
		const id = await createUser({ passwordHash: bcrypt.hashSync(PASSWORD, 4) });
		const other = await createUser({ passwordHash: bcrypt.hashSync(PASSWORD, 4) });
		for (let i = 0; i < PASSWORD_CHECK_RATE_LIMIT.max; i++) {
			await verifyCurrentPassword(id, 'wrong').catch(() => {});
		}
		await expect(verifyCurrentPassword(id, PASSWORD)).rejects.toMatchObject({ status: 429 });
		await expect(verifyCurrentPassword(other, PASSWORD)).resolves.toBeUndefined();
	});
});

describe('changeEmail', () => {
	beforeEach(resetDb);

	it('sets the new address as unverified and drops links sent to the old one', async () => {
		const id = await createUser({ email: 'old@example.com', emailVerified: true });
		const otherId = await createUser({ email: 'other@example.com' });
		await insertTokens(id, null);
		await insertTokens(id, new Date());
		await insertTokens(otherId, null);

		expect(await changeEmail(id, 'new@example.com')).toBe(true);

		const [row] = await db.select().from(user).where(eq(user.id, id));
		expect(row).toMatchObject({ email: 'new@example.com', emailVerified: false });
		for (const table of [emailVerificationToken, passwordResetToken]) {
			const left = await db.select().from(table).where(eq(table.userId, id));
			// Only the already-used token is kept; the other user's are untouched.
			expect(left.map((t) => t.usedAt !== null)).toEqual([true]);
			expect(await db.select().from(table).where(eq(table.userId, otherId))).toHaveLength(1);
		}
	});

	it('leaves an unchanged address (and its verification) alone', async () => {
		const id = await createUser({ email: 'same@example.com', emailVerified: true });
		await insertTokens(id, null);

		expect(await changeEmail(id, 'same@example.com')).toBe(false);

		const [row] = await db.select().from(user).where(eq(user.id, id));
		expect(row.emailVerified).toBe(true);
		expect(await db.select().from(passwordResetToken)).toHaveLength(1);
	});
});
