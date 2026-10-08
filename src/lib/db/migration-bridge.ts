// Migration bridge for databases created by the self-hosted edition.
//
// When this repository split from the self-hosted one, it inserted its own
// migrations (subscription, audit log, email verification, indexes) into the
// middle of the list and renumbered the self-hosted ones after them, with new
// journal dates. Drizzle only runs migrations dated after the newest one in
// the database, so on a self-hosted database it would re-run the renumbered
// migrations (and fail) while skipping the inserted ones.
//
// The renamed files are byte-identical, so their Drizzle fingerprints (sha256
// of the file) are unchanged. Before Drizzle runs, this bridge recognises each
// applied migration by fingerprint, moves its record to this journal's date,
// and applies the migrations the database is missing, in journal order. After
// that the database looks exactly as if it had always followed this journal,
// and Drizzle carries on normally. On this repository's own databases, and on
// fresh installs, it does nothing.

import { readFileSync } from 'node:fs';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type postgres from 'postgres';

// Fingerprints that self-hosted releases recorded for a migration whose file
// later changed. v1.0.0 shipped 0003 with a different comment line.
const LEGACY_HASHES: Record<string, string> = {
	feaed3cf7d4d1bba821c812b6448f568c0ad8b293d33d2704bb43c14fde5ad68: '0003_chessmont_moves'
};

// Only this repository's databases have it: the self-hosted edition never had
// the subscription migration, so its absence marks a self-hosted database.
const CLOUD_MARKER = '0016_saas_subscription';

// Arbitrary constant; keeps two instances starting at once from bridging the
// same database twice.
const BRIDGE_LOCK_KEY = 0x63_73_62_72; // "csbr"

export type BridgeResult =
	{ status: 'fresh' | 'current' } | { status: 'bridged'; redated: string[]; applied: string[] };

interface JournalEntry extends MigrationMeta {
	tag: string;
}

function readJournal(migrationsFolder: string): JournalEntry[] {
	const migrations = readMigrationFiles({ migrationsFolder });
	// readMigrationFiles drops the tags, but returns entries in journal order.
	const tags = migrationTags(migrationsFolder);
	return migrations.map((m, i) => ({ ...m, tag: tags[i] }));
}

function migrationTags(migrationsFolder: string): string[] {
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file inside the migrations folder
	const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
		entries: { tag: string }[];
	};
	return journal.entries.map((e) => e.tag);
}

/**
 * The index of the last migration the bridge has to handle: the newest one
 * the database already has, extended until every later journal entry is
 * dated after everything up to it, so Drizzle's "newer than the newest
 * applied" rule picks up exactly the rest.
 */
export function bridgeEnd(whens: number[], lastApplied: number): number {
	let end = lastApplied;
	for (;;) {
		const newest = Math.max(...whens.slice(0, end + 1));
		const laterOlder = whens.findLastIndex((w, i) => i > end && w <= newest);
		if (laterOlder === -1) return end;
		end = laterOlder;
	}
}

export async function bridgeSelfHostedMigrations(
	sql: postgres.Sql,
	migrationsFolder: string
): Promise<BridgeResult> {
	const [{ exists }] = await sql<{ exists: boolean }[]>`
		SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`;
	if (!exists) return { status: 'fresh' };

	const journal = readJournal(migrationsFolder);
	const indexByHash = new Map(journal.map((m, i) => [m.hash, i]));
	for (const [hash, tag] of Object.entries(LEGACY_HASHES)) {
		indexByHash.set(
			hash,
			journal.findIndex((m) => m.tag === tag)
		);
	}
	const marker = journal.find((m) => m.tag === CLOUD_MARKER);
	if (!marker) throw new Error(`Migration bridge: ${CLOUD_MARKER} is missing from the journal`);

	return sql.begin(async (tx) => {
		await tx`SELECT pg_advisory_xact_lock(${BRIDGE_LOCK_KEY})`;
		const rows = await tx<{ id: number; hash: string; created_at: string }[]>`
			SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
		if (rows.length === 0) return { status: 'fresh' } as const;
		if (rows.some((r) => r.hash === marker.hash)) return { status: 'current' } as const;

		const applied = new Map<number, (typeof rows)[number]>();
		const unknown: string[] = [];
		for (const row of rows) {
			const index = indexByHash.get(row.hash);
			if (index === undefined) unknown.push(row.hash);
			else applied.set(index, row);
		}
		if (unknown.length > 0) {
			// Guessing here could re-run or skip a migration on someone's data.
			throw new Error(
				`Migration bridge: the database has applied migrations this version does not ` +
					`recognise (${unknown.join(', ')}). It was probably created by a newer or ` +
					`modified version of Chessstack; restore a backup or upgrade to that version.`
			);
		}

		const end = bridgeEnd(
			journal.map((m) => m.folderMillis),
			Math.max(...applied.keys())
		);
		const redated: string[] = [];
		const ran: string[] = [];
		for (let i = 0; i <= end; i++) {
			const m = journal[i];
			const row = applied.get(i);
			if (row) {
				if (row.hash === m.hash && Number(row.created_at) === m.folderMillis) continue;
				await tx`
					UPDATE drizzle.__drizzle_migrations
					SET hash = ${m.hash}, created_at = ${m.folderMillis}
					WHERE id = ${row.id}`;
				redated.push(m.tag);
			} else {
				for (const stmt of m.sql) await tx.unsafe(stmt);
				await tx`
					INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
					VALUES (${m.hash}, ${m.folderMillis})`;
				ran.push(m.tag);
			}
		}
		return { status: 'bridged', redated, applied: ran } as const;
	});
}
