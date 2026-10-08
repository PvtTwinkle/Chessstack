// POST /api/import/fetch — trigger a game import from Lichess or Chess.com.
//
// Fetches new games for the authenticated user from the specified platform,
// inserts them into imported_game with status='pending', and updates the
// watermark timestamp so the next import only fetches newer games.
//
// Body: { source: 'LICHESS' | 'CHESSCOM' }
// Returns: { imported, skipped, total } or { rateLimited: true } on 429.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userSettings, importedGame } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchLichessGames, LichessApiError } from '$lib/lichess';
import { fetchChesscomGames, ChesscomApiError } from '$lib/chesscom';
import { isRateLimited } from '$lib/auth/rate-limit';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { fetchImportSchema } from '$lib/server/schemas/import';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);
	const userId = user.id;

	if (await isRateLimited(String(userId), RATE_LIMITS.importFetch)) {
		return json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
	}

	const { source } = await parseBody(request, fetchImportSchema);

	// Load user settings to get platform username and watermark.
	const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

	const username = source === 'LICHESS' ? settings?.lichessUsername : settings?.chesscomUsername;

	if (!username) {
		throw error(
			400,
			`No ${source === 'LICHESS' ? 'Lichess' : 'Chess.com'} username configured. Set it in Settings first.`
		);
	}

	const watermark =
		source === 'LICHESS' ? settings?.lastLichessImport : settings?.lastChesscomImport;

	// Fetch games from the platform.
	let games;
	try {
		if (source === 'LICHESS') {
			games = await fetchLichessGames(username, {
				since: watermark ? watermark.getTime() + 1 : undefined,
				max: 50
			});
		} else {
			games = await fetchChesscomGames(username, {
				since: watermark ?? undefined,
				max: 50
			});
		}
	} catch (e) {
		if (e instanceof LichessApiError || e instanceof ChesscomApiError) {
			if (e.status === 429) {
				return json({ imported: 0, skipped: 0, total: 0, rateLimited: true }, { status: 429 });
			}
			if (e.status === 404) {
				throw error(404, e.message);
			}
		}
		throw error(
			502,
			`Failed to fetch games from ${source}: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	// Insert all games and update the watermark in a single transaction so
	// a crash mid-loop can't leave the watermark out of sync with the data.
	let imported = 0;
	let skipped = 0;
	let latestPlayedAt: Date | null = watermark ?? null;

	await db.transaction(async (tx) => {
		for (const game of games) {
			try {
				const rows = await tx
					.insert(importedGame)
					.values({
						userId: userId,
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
				} else {
					skipped++;
				}

				if (game.playedAt && (!latestPlayedAt || game.playedAt > latestPlayedAt)) {
					latestPlayedAt = game.playedAt;
				}
			} catch {
				skipped++;
			}
		}

		// Update the watermark so the next import only fetches newer games.
		if (latestPlayedAt) {
			const watermarkField =
				source === 'LICHESS'
					? { lastLichessImport: latestPlayedAt }
					: { lastChesscomImport: latestPlayedAt };

			if (settings) {
				await tx
					.update(userSettings)
					.set({ ...watermarkField, updatedAt: new Date() })
					.where(eq(userSettings.userId, userId));
			} else {
				// No settings row yet — create one with the watermark.
				await tx.insert(userSettings).values({
					userId: userId,
					updatedAt: new Date(),
					...watermarkField
				});
			}
		}
	});

	// Provide a reason when no games were imported so the UI can explain why.
	let reason: string | undefined;
	if (games.length === 0 && imported === 0) {
		reason = watermark ? 'no_new_games' : 'no_games';
	} else if (games.length > 0 && imported === 0) {
		reason = 'all_skipped';
	}

	return json({ imported, skipped, total: games.length, ...(reason && { reason }) });
};
