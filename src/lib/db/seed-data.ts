// Auto-seed large reference datasets on first boot.
//
// After Drizzle migrations create the tables, this module checks whether the
// reference tables (masters, puzzles, players, stars) are empty. If they are
// (and the compressed dump files exist on disk), it restores them via `psql`.
// The dumps are baked into the Docker image at /app/data/ — in local dev the
// files don't exist and this module does nothing.
//
// The dumps are data-only pg_dump output with no BEGIN/COMMIT of their own, so
// psql runs each one with --single-transaction and ON_ERROR_STOP: a failure
// rolls the whole dump back and the next startup retries it. A dump that fills
// two tables (stars) counts as loaded only when both have rows; a half-loaded
// one from before this rule is emptied and loaded again.

import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { sql } from 'drizzle-orm';
import { getDb, getRawSql } from './index';
import { log } from '$lib/server/log';

// Configurable via SEED_DATA_DIR env var — allows cloud deployments to mount
// seed data from a shared volume or S3 FUSE mount instead of /app/data.
// Resolved so a relative path works too, from the working directory.
const DATA_DIR = path.resolve(process.env.SEED_DATA_DIR ?? '/app/data');

// Held while one instance loads the dumps, so two instances starting together
// don't both load (and duplicate) them.
const SEED_LOCK_KEY = 0x63_73_73_64; // "cssd"

const SEED_FILES = [
	{
		tables: ['chessmont_moves'],
		file: path.join(DATA_DIR, 'chessmont-moves-dump.sql.gz'),
		label: 'masters database'
	},
	{
		tables: ['puzzle'],
		file: path.join(DATA_DIR, 'puzzles-dump.sql.gz'),
		label: 'puzzle database'
	},
	{
		tables: ['lichess_moves'],
		file: path.join(DATA_DIR, 'lichess-moves-dump.sql.gz'),
		label: 'players database'
	},
	{
		tables: ['star_players', 'celebrity_moves'],
		file: path.join(DATA_DIR, 'celebrity-moves-dump.sql.gz'),
		label: 'stars database'
	}
] as const;

/**
 * Stream a gzipped SQL dump into psql: `gunzip -c <file> | psql <url>`, but
 * without a shell, so the connection string (which may contain characters
 * like `$`, `"` or backticks in the password) is never shell-interpreted.
 * Resolves when both processes exit 0.
 */
export function restoreGzipDump(file: string, databaseUrl: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const gunzip = spawn('gunzip', ['-c', file], { stdio: ['ignore', 'pipe', 'pipe'] });
		// Without ON_ERROR_STOP psql carries on past a failed statement and still
		// exits 0, so a broken load would look like a finished one.
		const psql = spawn(
			'psql',
			['--quiet', '--single-transaction', '--set=ON_ERROR_STOP=1', databaseUrl],
			{ stdio: ['pipe', 'ignore', 'pipe'] }
		);
		gunzip.stdout.pipe(psql.stdin);
		// If psql dies early, writing to its stdin raises EPIPE; the exit code
		// check below reports the real failure.
		psql.stdin.on('error', () => {});

		let stderr = '';
		gunzip.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
		psql.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

		// Wait for BOTH processes to exit, then decide — a truncated/corrupt
		// archive makes gunzip fail even if psql happily applied a partial dump.
		const codes: { gunzip?: number | null; psql?: number | null } = {};
		let spawnError: Error | null = null;
		const finish = () => {
			if (!('gunzip' in codes) || !('psql' in codes)) return;
			if (spawnError) return reject(spawnError);
			if (codes.gunzip !== 0) {
				return reject(new Error(`gunzip exited with code ${codes.gunzip}: ${stderr.trim()}`));
			}
			if (codes.psql !== 0) {
				return reject(new Error(`psql exited with code ${codes.psql}: ${stderr.trim()}`));
			}
			resolve();
		};
		gunzip.on('error', (err) => (spawnError ??= err));
		psql.on('error', (err) => (spawnError ??= err));
		gunzip.on('close', (code) => {
			codes.gunzip = code;
			finish();
		});
		psql.on('close', (code) => {
			codes.psql = code;
			finish();
		});
	});
}

/**
 * Seed empty reference tables from embedded dump files.
 *
 * Safe to call on every startup — returns immediately if tables already have
 * data or if the dump files are not present (local dev). If another instance
 * is already loading, this one leaves it to that instance.
 */
export async function loadSeedData(): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		log.warn('DATABASE_URL not set — skipping seed data restore.');
		return;
	}
	// In local dev the dump files don't exist; say so only when someone pointed
	// SEED_DATA_DIR somewhere, since then they expect seeding to happen.
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- DATA_DIR is our own config
	if (!existsSync(DATA_DIR)) {
		if (process.env.SEED_DATA_DIR) {
			log.warn('SEED_DATA_DIR does not exist; skipping seed data.', { dir: DATA_DIR });
		}
		return;
	}

	// The advisory lock belongs to the connection that took it, so it is taken
	// and released on one reserved connection (see import-scheduler.ts).
	const lockConn = await getRawSql().reserve();
	try {
		const [{ acquired }] = await lockConn<[{ acquired: boolean }]>`
			SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS acquired
		`;
		if (!acquired) {
			log.info('Seed data is being loaded by another instance.');
			return;
		}
		try {
			for (const seed of SEED_FILES) await loadSeedFile(seed, databaseUrl);
		} finally {
			await lockConn`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`;
		}
	} finally {
		lockConn.release();
	}
}

async function loadSeedFile(
	{ tables, file, label }: (typeof SEED_FILES)[number],
	databaseUrl: string
): Promise<void> {
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- one of SEED_FILES
	if (!existsSync(file)) return;

	const db = getDb();
	const filled: string[] = [];
	for (const table of tables) {
		// LIMIT 1 is fast even on a large table.
		const rows = await db.execute(sql.raw(`SELECT 1 FROM ${table} LIMIT 1`));
		if (rows.length > 0) filled.push(table);
	}
	if (filled.length === tables.length) return;
	if (filled.length > 0) {
		log.warn(`The ${label} is only partly loaded; loading it again.`, { filled });
		await db.execute(sql.raw(`TRUNCATE ${tables.join(', ')}`));
	}

	log.info(`Loading ${label}...`);
	const start = Date.now();
	try {
		await restoreGzipDump(file, databaseUrl);
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		log.info(`Loading ${label}... done`, { seconds: Number(elapsed) });
	} catch (err) {
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		log.error(`Failed to load ${label}; the table is still empty and will retry on next restart.`, {
			seconds: Number(elapsed),
			err
		});
	}
}
