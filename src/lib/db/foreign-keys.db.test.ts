// Deleting an account or a repertoire relies on the database to remove
// everything that points at it (see $lib/server/delete-account). A new table
// whose foreign key to "user" or "repertoire" uses the default NO ACTION would
// make those deletes fail, so this checks every such key in the catalog.

import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';

describe('foreign keys to user and repertoire', () => {
	it('all cascade or set null on delete', async () => {
		const rows = await db.execute<{ table: string; name: string; action: string }>(sql`
			SELECT c.conrelid::regclass::text AS table, c.conname AS name, c.confdeltype AS action
			FROM pg_constraint c
			WHERE c.contype = 'f'
				AND c.confrelid IN ('public."user"'::regclass, 'public.repertoire'::regclass)
		`);
		expect(rows.length).toBeGreaterThan(0);
		// 'c' is CASCADE and 'n' is SET NULL.
		const blocking = rows.filter((r) => r.action !== 'c' && r.action !== 'n');
		expect(blocking).toEqual([]);
	});
});
