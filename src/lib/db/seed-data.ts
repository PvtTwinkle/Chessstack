// Auto-seed large reference datasets on first boot.
//
// After Drizzle migrations create the tables, this module checks whether the
// chessmont_moves and puzzle tables are empty. If they are (and the compressed
// dump files exist on disk), it restores them via `psql`. The dumps are baked
// into the Docker image at /app/data/ — in local dev the files don't exist and
// this module silently does nothing.
//
// Each restore is transactional (pg_dump wraps COPY in BEGIN/COMMIT), so a
// partial failure rolls back cleanly and the next startup retries.

import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { sql } from 'drizzle-orm';
import { getDb } from './index';
import { log } from '$lib/server/log';

// Configurable via SEED_DATA_DIR env var — allows cloud deployments to mount
// seed data from a shared volume or S3 FUSE mount instead of /app/data.
const DATA_DIR = process.env.SEED_DATA_DIR ?? '/app/data';

const SEED_FILES = [
	{
		table: 'chessmont_moves',
		file: path.join(DATA_DIR, 'chessmont-moves-dump.sql.gz'),
		label: 'masters database'
	},
	{
		table: 'puzzle',
		file: path.join(DATA_DIR, 'puzzles-dump.sql.gz'),
		label: 'puzzle database'
	},
	{
		table: 'lichess_moves',
		file: `${DATA_DIR}/lichess-moves-dump.sql.gz`,
		label: 'players database'
	},
	{
		table: 'celebrity_moves',
		file: `${DATA_DIR}/celebrity-moves-dump.sql.gz`,
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
		const psql = spawn('psql', ['--quiet', databaseUrl], { stdio: ['pipe', 'ignore', 'pipe'] });
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
 * data or if the dump files are not present (local dev).
 */
export async function loadSeedData(): Promise<void> {
	const db = getDb();

	for (const { table, file, label } of SEED_FILES) {
		// In local dev the dump files don't exist — skip silently.
		// Resolve + startsWith guard satisfies eslint security/detect-non-literal-fs-filename.
		const resolved = path.resolve(file);
		if (!resolved.startsWith(DATA_DIR)) continue;
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		if (!existsSync(resolved)) continue;

		// Check if the table already has data. LIMIT 1 is fast even on an empty table.
		const rows = await db.execute(sql.raw(`SELECT 1 FROM ${table} LIMIT 1`));
		if (rows.length > 0) continue;

		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) {
			log.warn('DATABASE_URL not set — skipping seed data restore.');
			return;
		}

		log.info(`Loading ${label}...`);
		const start = Date.now();

		try {
			await restoreGzipDump(resolved, databaseUrl);
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			log.info(`Loading ${label}... done`, { seconds: Number(elapsed) });
		} catch (err) {
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			log.error(
				`Failed to load ${label}; the table is still empty and will retry on next restart.`,
				{
					seconds: Number(elapsed),
					err
				}
			);
		}
	}
}
