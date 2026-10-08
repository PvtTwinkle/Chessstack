// Shared helpers for *.db.test.ts files.
import { db, getRawSql } from '$lib/db';
import { user, subscription, repertoire } from '$lib/db/schema';

/** Wipe all per-user state. Reference data (masters, puzzles, ECO) is left alone. */
export async function resetDb(): Promise<void> {
	const sql = getRawSql();
	await sql`TRUNCATE "user", rate_limit RESTART IDENTITY CASCADE`;
}

let counter = 0;

export async function createUser(
	overrides: Partial<typeof user.$inferInsert> = {}
): Promise<number> {
	counter++;
	const [row] = await db
		.insert(user)
		.values({
			username: `user${counter}`,
			passwordHash: 'x',
			createdAt: new Date(),
			...overrides
		})
		.returning({ id: user.id });
	return row.id;
}

export async function createSubscription(
	userId: number,
	overrides: Partial<typeof subscription.$inferInsert> = {}
): Promise<void> {
	await db.insert(subscription).values({
		userId,
		tier: 'free',
		status: 'active',
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	});
}

export async function createRepertoire(userId: number, createdAt: Date): Promise<number> {
	const [row] = await db
		.insert(repertoire)
		.values({ userId, name: `rep-${createdAt.getTime()}`, color: 'WHITE', createdAt })
		.returning({ id: repertoire.id });
	return row.id;
}
