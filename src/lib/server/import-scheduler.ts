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
import { userSettings, importedGame } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchLichessGames } from '$lib/lichess';
import { fetchChesscomGames } from '$lib/chesscom';
import { log } from '$lib/server/log';

const STARTUP_DELAY_MS = 5000;
const DELAY_BETWEEN_USERS_MS = 2000;

// Advisory lock key — arbitrary 64-bit integer unique to the import scheduler.
// Prevents multiple app instances from running the import cycle simultaneously.
const IMPORT_LOCK_KEY = 42001;

let started = false;

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
	setTimeout(runImportCycle, STARTUP_DELAY_MS);
	setInterval(runImportCycle, intervalMinutes * 60 * 1000);
}

async function runImportCycle(): Promise<void> {
	// Try to acquire a PostgreSQL advisory lock. If another instance already
	// holds this lock, skip this cycle entirely. pg_try_advisory_lock is
	// non-blocking — it returns false immediately instead of waiting.
	const sql = getRawSql();
	const [{ acquired }] = await sql<[{ acquired: boolean }]>`
		SELECT pg_try_advisory_lock(${IMPORT_LOCK_KEY}) AS acquired
	`;
	if (!acquired) {
		log.info('Auto-import skipped — another instance holds the lock.');
		return;
	}

	log.info('Starting auto-import cycle');

	try {
		// Find all users with at least one platform username configured.
		const allSettings = await db
			.select({
				userId: userSettings.userId,
				lichessUsername: userSettings.lichessUsername,
				chesscomUsername: userSettings.chesscomUsername,
				lastLichessImport: userSettings.lastLichessImport,
				lastChesscomImport: userSettings.lastChesscomImport
			})
			.from(userSettings);

		let totalImported = 0;

		for (const settings of allSettings) {
			// Lichess
			if (settings.lichessUsername) {
				try {
					const count = await importGamesForUser(
						settings.userId,
						'LICHESS',
						settings.lichessUsername,
						settings.lastLichessImport
					);
					totalImported += count;
				} catch (e) {
					// Usually an outage or rate limit on Lichess's side: logged, not reported to Sentry.
					log.error('Lichess import failed', {
						userId: settings.userId,
						reason: e instanceof Error ? e.message : String(e)
					});
				}
				await sleep(DELAY_BETWEEN_USERS_MS);
			}

			// Chess.com
			if (settings.chesscomUsername) {
				try {
					const count = await importGamesForUser(
						settings.userId,
						'CHESSCOM',
						settings.chesscomUsername,
						settings.lastChesscomImport
					);
					totalImported += count;
				} catch (e) {
					log.error('Chess.com import failed', {
						userId: settings.userId,
						reason: e instanceof Error ? e.message : String(e)
					});
				}
				await sleep(DELAY_BETWEEN_USERS_MS);
			}
		}

		log.info('Auto-import cycle complete', { imported: totalImported });
	} catch (e) {
		log.error('Auto-import cycle error', { err: e });
	} finally {
		// Release the advisory lock so the next cycle (on any instance) can acquire it.
		await sql`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`;
	}
}

async function importGamesForUser(
	userId: number,
	source: 'LICHESS' | 'CHESSCOM',
	username: string,
	watermark: Date | null
): Promise<number> {
	// Fetch games from the platform.
	const games =
		source === 'LICHESS'
			? await fetchLichessGames(username, {
					since: watermark ? watermark.getTime() + 1 : undefined,
					max: 50
				})
			: await fetchChesscomGames(username, {
					since: watermark ?? undefined,
					max: 50
				});

	let latestPlayedAt = watermark;
	let imported = 0;

	for (const game of games) {
		try {
			const rows = await db
				.insert(importedGame)
				.values({
					userId,
					pgn: game.pgn,
					source,
					externalGameId: game.id,
					playerColor: game.playerColor,
					opponentName: game.opponentName,
					opponentRating: game.opponentRating,
					playerRating: game.playerRating,
					timeControl: game.timeControl,
					result: game.result,
					playedAt: game.playedAt,
					importedAt: new Date(),
					status: 'pending'
				})
				.onConflictDoNothing()
				.returning({ id: importedGame.id });

			if (rows.length > 0) {
				imported++;
			}

			if (game.playedAt && (!latestPlayedAt || game.playedAt > latestPlayedAt)) {
				latestPlayedAt = game.playedAt;
			}
		} catch (err) {
			log.warn('Skipping game insertion failure', { err });
		}
	}

	// Update the watermark.
	if (latestPlayedAt && latestPlayedAt !== watermark) {
		const field =
			source === 'LICHESS'
				? { lastLichessImport: latestPlayedAt }
				: { lastChesscomImport: latestPlayedAt };

		await db
			.update(userSettings)
			.set({ ...field, updatedAt: new Date() })
			.where(eq(userSettings.userId, userId));
	}

	if (imported > 0) {
		log.info('Imported games', { source, userId, imported });
	}

	return imported;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
