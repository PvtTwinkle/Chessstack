// Game import from Lichess and Chess.com, shared by POST /api/import/fetch and
// the background auto-import scheduler so both behave the same way.
//
// Games are fetched oldest first from the platform's watermark (the playedAt
// of the newest game imported so far), inserted into imported_game as
// 'pending', and the watermark moves to the newest game kept. Fetching oldest
// first matters: the watermark skips everything before it, so a fetch that
// kept the newest games of a busy stretch would lose the older ones for good.

import { db } from '$lib/db';
import { userSettings, importedGame } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { fetchLichessGames, type LichessGame } from '$lib/lichess';
import { fetchChesscomGames, type ChesscomGame } from '$lib/chesscom';
import { log } from '$lib/server/log';

export type ImportSource = 'LICHESS' | 'CHESSCOM';

/** Games fetched per import. */
export const IMPORT_MAX_GAMES = 50;

/**
 * How far back the first import of an account reaches. Chess.com's first
 * import takes the last three monthly archives, so Lichess matches it rather
 * than starting from the account's very first game.
 */
export const FIRST_IMPORT_DAYS = 90;

export interface ImportResult {
	imported: number;
	skipped: number;
	total: number;
}

export type Game = LichessGame | ChesscomGame;

/** Fetch games from the platform, oldest first from the watermark. */
export async function fetchNewGames(
	source: ImportSource,
	username: string,
	watermark: Date | null,
	now = Date.now()
): Promise<Game[]> {
	if (source === 'LICHESS') {
		const since = watermark
			? watermark.getTime() + 1
			: now - FIRST_IMPORT_DAYS * 24 * 60 * 60 * 1000;
		return fetchLichessGames(username, { since, max: IMPORT_MAX_GAMES, sort: 'dateAsc' });
	}
	return fetchChesscomGames(username, {
		since: watermark ?? undefined,
		max: IMPORT_MAX_GAMES,
		oldestFirst: true
	});
}

// Postgres text columns can't hold a NUL byte; one in a PGN or a name would
// fail the insert.
function stripNul<T extends string | null>(value: T): T {
	return (value === null ? null : value.replaceAll('\u0000', '')) as T;
}

/**
 * Fetch and store new games for one user and platform, then move the
 * watermark. Platform errors (LichessApiError / ChesscomApiError) propagate
 * for the caller to report.
 */
export async function importGames(
	userId: number,
	source: ImportSource,
	username: string,
	watermark: Date | null
): Promise<ImportResult> {
	const games = await fetchNewGames(source, username, watermark);
	return saveImportedGames(userId, source, username, watermark, games);
}

/** Store fetched games as pending and move the watermark to the newest one. */
export async function saveImportedGames(
	userId: number,
	source: ImportSource,
	username: string,
	watermark: Date | null,
	games: Game[]
): Promise<ImportResult> {
	let imported = 0;
	let skipped = 0;
	let latestPlayedAt: Date | null = watermark;

	// One transaction so the watermark can't move without the games behind it.
	await db.transaction(async (tx) => {
		for (const game of games) {
			try {
				// A savepoint per game: a failed statement aborts the whole
				// transaction in Postgres, so without one, one bad game would fail
				// every insert after it and the watermark update.
				const rows = await tx.transaction((sp) =>
					sp
						.insert(importedGame)
						.values({
							userId,
							pgn: stripNul(game.pgn),
							source,
							externalGameId: stripNul(game.id),
							playerColor: game.playerColor,
							opponentName: stripNul(game.opponentName),
							opponentRating: game.opponentRating,
							playerRating: game.playerRating,
							timeControl: stripNul(game.timeControl),
							result: stripNul(game.result),
							playedAt: game.playedAt,
							importedAt: new Date(),
							status: 'pending'
						})
						.onConflictDoNothing()
						.returning({ id: importedGame.id })
				);
				if (rows.length > 0) imported++;
				else skipped++;
			} catch (err) {
				skipped++;
				log.warn('Skipping a game that could not be saved', {
					userId,
					source,
					reason: err instanceof Error ? err.message : String(err)
				});
			}

			// The watermark passes a game that failed too, or the next import
			// would fetch it, fail again and never move on.
			if (game.playedAt && (!latestPlayedAt || game.playedAt > latestPlayedAt)) {
				latestPlayedAt = game.playedAt;
			}
		}

		if (latestPlayedAt && latestPlayedAt !== watermark) {
			const field =
				source === 'LICHESS'
					? { lastLichessImport: latestPlayedAt }
					: { lastChesscomImport: latestPlayedAt };
			const usernameColumn =
				source === 'LICHESS' ? userSettings.lichessUsername : userSettings.chesscomUsername;
			// Only while the username is still the one these games came from: if
			// it changed mid-import, the settings route has reset the watermark
			// for the new account and this one must not overwrite it.
			await tx
				.update(userSettings)
				.set({ ...field, updatedAt: new Date() })
				.where(and(eq(userSettings.userId, userId), eq(usernameColumn, username)));
		}
	});

	if (imported > 0) log.info('Imported games', { source, userId, imported });
	return { imported, skipped, total: games.length };
}

/**
 * The watermark columns to clear when a settings update changes a platform
 * username: the old account's watermark would skip the new account's games
 * played before it. Usernames are case-insensitive on both platforms.
 */
export function watermarkResets(
	current: { lichessUsername: string | null; chesscomUsername: string | null } | undefined,
	update: { lichessUsername?: string | null; chesscomUsername?: string | null }
): { lastLichessImport?: null; lastChesscomImport?: null } {
	const changed = (before: string | null | undefined, after: string | null | undefined) =>
		after !== undefined && (before ?? '').toLowerCase() !== (after ?? '').toLowerCase();
	return {
		...(changed(current?.lichessUsername, update.lichessUsername) && { lastLichessImport: null }),
		...(changed(current?.chesscomUsername, update.chesscomUsername) && {
			lastChesscomImport: null
		})
	};
}
