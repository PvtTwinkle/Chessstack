/* eslint-disable security/detect-non-literal-fs-filename -- test writes migration folders into its own mkdtemp directory */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { bridgeEnd, bridgeSelfHostedMigrations } from './migration-bridge';

const MIGRATIONS = path.join(process.cwd(), 'drizzle', 'migrations');

// The self-hosted journal as of v1.3.1: each entry's file is byte-identical to
// the cloud migration named here, but was recorded under its own number and date.
const SELF_HOSTED_JOURNAL: [cloudTag: string, when: number][] = [
	['0000_create_tables', 1771865788871],
	['0001_seed_book_moves', 1771865800000],
	['0002_seed_eco_data', 1771865900000],
	['0003_chessmont_moves', 1772700000000],
	['0004_puzzle_tables', 1772800000000],
	['0005_user_roles', 1772900000000],
	['0006_game_import', 1773000000000],
	['0007_puzzle_goal', 1773100000000],
	['0008_tempo_training', 1773200000000],
	['0009_app_theme', 1773300000000],
	['0010_gap_min_games', 1773400000000],
	['0011_normalize_fen_4field', 1773500000000],
	['0012_add_cascade_rules', 1773600000000],
	['0013_board_size', 1773700000000],
	['0014_tutorial_step', 1773800000000],
	['0015_playback_speed', 1773900000000],
	['0019_gap_default_10000', 1774000000000],
	['0024_add_lichess_moves', 1774100000000],
	['0025_fsrs_settings', 1774200000000],
	['0026_add_celebrity_moves', 1774300000000],
	['0027_star_player_category', 1774400000000],
	['0028_drop_celebrity_resulting_fen', 1774500000000],
	['0029_opponent_prep', 1774615176924],
	['0030_prep_filters', 1774626000000],
	['0031_trainer_mode', 1774700000000],
	['0032_trainer_lead_in_moves', 1774800000000]
];
const V1_3_1 = SELF_HOSTED_JOURNAL.length;
const V1_1_2 = 16; // 0000–0015

const adminUrl = new URL(process.env.DATABASE_URL!);
const admin = postgres(adminUrl.toString(), { onnotice: () => {} });
const created: string[] = [];
let dir: string;

async function freshDatabase(name: string): Promise<postgres.Sql> {
	const dbName = `bridge_test_${name}`;
	await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
	await admin.unsafe(`CREATE DATABASE ${dbName}`);
	created.push(dbName);
	const url = new URL(adminUrl);
	url.pathname = `/${dbName}`;
	return postgres(url.toString(), { onnotice: () => {}, max: 1 });
}

/** A migrations folder laid out the way a self-hosted release shipped it. */
function selfHostedFolder(entries: number): string {
	const folder = path.join(dir, `self-hosted-${entries}`);
	mkdirSync(path.join(folder, 'meta'), { recursive: true });
	const journal = SELF_HOSTED_JOURNAL.slice(0, entries).map(([cloudTag, when], idx) => {
		const tag = `${String(idx).padStart(4, '0')}_${cloudTag.slice(5)}`;
		copyFileSync(path.join(MIGRATIONS, `${cloudTag}.sql`), path.join(folder, `${tag}.sql`));
		return { idx, version: '7', when, tag, breakpoints: true };
	});
	writeFileSync(
		path.join(folder, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'postgresql', entries: journal })
	);
	return folder;
}

async function selfHostedDatabase(name: string, entries: number): Promise<postgres.Sql> {
	const sql = await freshDatabase(name);
	await migrate(drizzle(sql), { migrationsFolder: selfHostedFolder(entries) });
	const [{ id }] = await sql`
		INSERT INTO "user" (username, password_hash, role, created_at)
		VALUES ('selfhoster', 'hash', 'admin', now()) RETURNING id`;
	await sql`
		INSERT INTO repertoire (user_id, name, color, created_at)
		VALUES (${id}, 'White - e4', 'WHITE', now())`;
	return sql;
}

async function upgrade(sql: postgres.Sql) {
	const result = await bridgeSelfHostedMigrations(sql, MIGRATIONS);
	await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
	return result;
}

/** Everything about the schema that a migration can change, in a stable order. */
async function schemaOf(sql: postgres.Sql) {
	const columns = await sql`
		SELECT table_name, column_name, data_type, is_nullable, column_default
		FROM information_schema.columns WHERE table_schema = 'public'
		ORDER BY table_name, column_name`;
	const indexes = await sql`
		SELECT tablename, indexname, indexdef FROM pg_indexes
		WHERE schemaname = 'public' ORDER BY tablename, indexname`;
	const constraints = await sql`
		SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
		FROM pg_constraint WHERE connamespace = 'public'::regnamespace
		ORDER BY 1, 2`;
	return { columns, indexes, constraints };
}

async function migrationRecord(sql: postgres.Sql) {
	return sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, hash`;
}

let reference: postgres.Sql;

beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'bridge-test-'));
	reference = await freshDatabase('reference');
	expect(await upgrade(reference)).toEqual({ status: 'fresh' });
}, 60_000);

afterAll(async () => {
	await reference?.end();
	for (const name of created) await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
	await admin.end();
	rmSync(dir, { recursive: true, force: true });
});

describe('bridgeSelfHostedMigrations', () => {
	it('upgrades a v1.3.1 self-hosted database to the same schema as a fresh install', async () => {
		const sql = await selfHostedDatabase('v131', V1_3_1);
		try {
			const result = await upgrade(sql);
			expect(result).toMatchObject({
				status: 'bridged',
				applied: [
					'0016_saas_subscription',
					'0017_polite_blur',
					'0018_mixed_shen',
					'0020_admin_override',
					'0021_gift_subscription',
					'0022_email_verification',
					'0023_user_id_indexes'
				]
			});
			expect(result.status === 'bridged' && result.redated).toContain('0032_trainer_lead_in_moves');

			expect(await schemaOf(sql)).toEqual(await schemaOf(reference));
			expect(await migrationRecord(sql)).toEqual(await migrationRecord(reference));

			const [user] = await sql`SELECT username, role, email, email_verified FROM "user"`;
			expect(user).toEqual({
				username: 'selfhoster',
				role: 'admin',
				email: null,
				email_verified: true
			});
			const [{ count }] = await sql`SELECT count(*)::int AS count FROM repertoire`;
			expect(count).toBe(1);

			// Later starts are no-ops.
			expect(await upgrade(sql)).toEqual({ status: 'current' });
		} finally {
			await sql.end();
		}
	}, 60_000);

	it('upgrades a v1.1 database, filling in migrations dated before its newest one', async () => {
		const sql = await selfHostedDatabase('v11', V1_1_2);
		try {
			expect(await upgrade(sql)).toMatchObject({
				status: 'bridged',
				redated: [],
				applied: ['0016_saas_subscription', '0017_polite_blur', '0018_mixed_shen']
			});
			expect(await schemaOf(sql)).toEqual(await schemaOf(reference));
			expect(await migrationRecord(sql)).toEqual(await migrationRecord(reference));
		} finally {
			await sql.end();
		}
	}, 60_000);

	it('recognises the 0003 fingerprint that v1.0.0 recorded', async () => {
		const sql = await selfHostedDatabase('v100', V1_1_2);
		try {
			await sql`
				UPDATE drizzle.__drizzle_migrations
				SET hash = 'feaed3cf7d4d1bba821c812b6448f568c0ad8b293d33d2704bb43c14fde5ad68'
				WHERE created_at = 1772700000000`;
			expect(await upgrade(sql)).toMatchObject({
				status: 'bridged',
				redated: ['0003_chessmont_moves']
			});
			expect(await migrationRecord(sql)).toEqual(await migrationRecord(reference));
		} finally {
			await sql.end();
		}
	}, 60_000);

	it('leaves a database it does not recognise untouched', async () => {
		const sql = await selfHostedDatabase('unknown', V1_3_1);
		try {
			await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('abc', 1)`;
			const before = await migrationRecord(sql);
			await expect(bridgeSelfHostedMigrations(sql, MIGRATIONS)).rejects.toThrow(
				/recognise \(abc\)/
			);
			expect(await migrationRecord(sql)).toEqual(before);
			const [{ exists }] = await sql`SELECT to_regclass('subscription') IS NOT NULL AS exists`;
			expect(exists).toBe(false);
		} finally {
			await sql.end();
		}
	}, 60_000);

	it('does nothing on an up-to-date database', async () => {
		const before = await migrationRecord(reference);
		expect(await bridgeSelfHostedMigrations(reference, MIGRATIONS)).toEqual({ status: 'current' });
		expect(await migrationRecord(reference)).toEqual(before);
	});
});

describe('bridgeEnd', () => {
	it('stops at the newest applied migration when the dates are in order', () => {
		expect(bridgeEnd([1, 2, 3, 4], 1)).toBe(1);
	});

	it('extends past later entries that are dated earlier', () => {
		// Entries 2 and 3 are dated before entry 1, so Drizzle would skip them.
		expect(bridgeEnd([1, 5, 2, 3, 6], 1)).toBe(3);
		// Entry 2 is newer than the applied one, but entry 3 still forces it in.
		expect(bridgeEnd([1, 5, 6, 2, 7], 1)).toBe(3);
	});
});
