// Background scheduler for automatic game import.
//
// When the GAME_IMPORT_INTERVAL_MINUTES environment variable is set to a
// positive number, this module runs a setInterval that periodically fetches
// new games from Lichess and Chess.com for all users who have configured
// platform usernames in their settings.
//
// This module is imported and started from hooks.server.ts — it only runs
// at runtime on the actual server, never during vite build.

import { db, getRawSql } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { isNotNull, or } from 'drizzle-orm';
import { importGames, type ImportSource } from '$lib/server/game-import';
import { log } from '$lib/server/log';

const STARTUP_DELAY_MS = 5000;
const DELAY_BETWEEN_USERS_MS = 2000;

// Advisory lock key — arbitrary 64-bit integer unique to the import scheduler.
// Prevents multiple app instances from running the import cycle simultaneously.
const IMPORT_LOCK_KEY = 42001;

let started = false;
// True while a cycle runs in this process, so a slow cycle and the next tick
// never overlap.
let cycleRunning = false;

/**
 * Start the background import scheduler. Safe to call multiple times —
 * only the first call actually starts the interval.
 */
export function startImportScheduler(): void {
	if (started) return;
	started = true;

	const intervalMinutes = parseInt(process.env.GAME_IMPORT_INTERVAL_MINUTES ?? '0');
	if (intervalMinutes <= 0) {
		log.info('Auto-import disabled (GAME_IMPORT_INTERVAL_MINUTES=0).');
		return;
	}

	log.info('Auto-import enabled', { intervalMinutes });

	// Run once on startup (after a short delay to let the app finish initialising),
	// then at the configured interval.
	setTimeout(runScheduledCycle, STARTUP_DELAY_MS);
	setInterval(runScheduledCycle, intervalMinutes * 60 * 1000);
}

/**
 * The timer callback. It never rejects: a rejection nobody handles makes Node
 * exit, so a database blip during a cycle would take the whole server down
 * (unless Sentry is on, which installs its own handler).
 */
export async function runScheduledCycle(): Promise<void> {
	try {
		await runImportCycle();
	} catch (e) {
		log.error('Auto-import cycle error', { err: e });
	}
}

type ImportUser = typeof importGamesForUser;

/**
 * One import cycle across every user with a platform username. Returns
 * 'busy' when a cycle is already running in this process and 'skipped' when
 * another instance holds the lock. Exported for tests, which pass their own
 * importUser so no request leaves the machine.
 */
export async function runImportCycle({
	importUser = importGamesForUser,
	delayMs = DELAY_BETWEEN_USERS_MS
}: { importUser?: ImportUser; delayMs?: number } = {}): Promise<'ran' | 'skipped' | 'busy'> {
	if (cycleRunning) return 'busy';
	cycleRunning = true;

	try {
		// pg_try_advisory_lock belongs to the connection that took it, and
		// getRawSql() is a pool: the unlock has to run on the same connection, or
		// it fails and the lock stays held until that connection closes. So the
		// cycle reserves one connection for the lock and its release.
		const lockConn = await getRawSql().reserve();
		try {
			// Non-blocking: if another instance holds the lock, skip this cycle.
			const [{ acquired }] = await lockConn<[{ acquired: boolean }]>`
				SELECT pg_try_advisory_lock(${IMPORT_LOCK_KEY}) AS acquired
			`;
			if (!acquired) {
				log.info('Auto-import skipped — another instance holds the lock.');
				return 'skipped';
			}

			try {
				await importAllUsers(importUser, delayMs);
			} finally {
				// Release the lock so the next cycle (on any instance) can take it.
				await lockConn`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`;
			}
			return 'ran';
		} finally {
			lockConn.release();
		}
	} finally {
		cycleRunning = false;
	}
}

async function importAllUsers(importUser: ImportUser, delayMs: number): Promise<void> {
	log.info('Starting auto-import cycle');

	const allSettings = await db
		.select({
			userId: userSettings.userId,
			lichessUsername: userSettings.lichessUsername,
			chesscomUsername: userSettings.chesscomUsername,
			lastLichessImport: userSettings.lastLichessImport,
			lastChesscomImport: userSettings.lastChesscomImport
		})
		.from(userSettings)
		.where(or(isNotNull(userSettings.lichessUsername), isNotNull(userSettings.chesscomUsername)));

	let totalImported = 0;

	for (const settings of allSettings) {
		const platforms = [
			['LICHESS', settings.lichessUsername, settings.lastLichessImport],
			['CHESSCOM', settings.chesscomUsername, settings.lastChesscomImport]
		] as const;

		for (const [source, username, watermark] of platforms) {
			if (!username) continue;
			try {
				totalImported += await importUser(settings.userId, source, username, watermark);
			} catch (e) {
				// Usually an outage or rate limit on the platform's side: logged as a
				// warning, not reported to Sentry, and the cycle moves on.
				log.warn(`${source === 'LICHESS' ? 'Lichess' : 'Chess.com'} import failed`, {
					userId: settings.userId,
					reason: e instanceof Error ? e.message : String(e)
				});
			}
			await sleep(delayMs);
		}
	}

	log.info('Auto-import cycle complete', { imported: totalImported });
}

async function importGamesForUser(
	userId: number,
	source: ImportSource,
	username: string,
	watermark: Date | null
): Promise<number> {
	return (await importGames(userId, source, username, watermark)).imported;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
