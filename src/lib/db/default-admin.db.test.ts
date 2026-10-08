import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { createDefaultAdmin, db } from '$lib/db';
import { user } from './schema';
import { resetDb, createUser } from '$lib/test/db-helpers';

describe('createDefaultAdmin', () => {
	beforeEach(resetDb);
	afterEach(() => {
		delete process.env.DEFAULT_USERNAME;
		delete process.env.DEFAULT_PASSWORD;
	});

	it('creates an admin from DEFAULT_USERNAME and DEFAULT_PASSWORD on an empty database', async () => {
		// Random so the secret scanner doesn't take it for a committed credential.
		const ownerPassword = randomUUID();
		process.env.DEFAULT_USERNAME = 'owner';
		process.env.DEFAULT_PASSWORD = ownerPassword;
		await createDefaultAdmin(db);

		const rows = await db.select().from(user);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ username: 'owner', role: 'admin', enabled: true, email: null });
		expect(await bcrypt.compare(ownerPassword, rows[0].passwordHash)).toBe(true);
	});

	it('falls back to admin / changeme', async () => {
		await createDefaultAdmin(db);
		const [row] = await db.select().from(user);
		expect(row.username).toBe('admin');
		expect(await bcrypt.compare('changeme', row.passwordHash)).toBe(true);
	});

	it('does nothing once any account exists', async () => {
		await createUser();
		await createDefaultAdmin(db);
		expect(await db.select().from(user)).toHaveLength(1);
	});
});
