// POST /api/import/fetch — trigger a game import from Lichess or Chess.com.
//
// Fetches new games for the authenticated user from the specified platform,
// inserts them into imported_game with status='pending', and updates the
// watermark timestamp so the next import only fetches newer games. The work
// is in $lib/server/game-import, shared with the auto-import scheduler.
//
// Body: { source: 'LICHESS' | 'CHESSCOM' }
// Returns: { imported, skipped, total, more } or { rateLimited: true } on 429.
// more is true when the batch came back full, so the platform may have newer
// games still to fetch; the Import tab keeps asking until it is false.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { LichessApiError } from '$lib/lichess';
import { ChesscomApiError } from '$lib/chesscom';
import { IMPORT_MAX_GAMES, fetchNewGames, saveImportedGames } from '$lib/server/game-import';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth, rateLimitResponse } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { fetchImportSchema } from '$lib/server/schemas/import';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);
	const userId = user.id;

	const limited = await rateLimitResponse(userId, RATE_LIMITS.importFetch);
	if (limited) return limited;

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

	let games;
	try {
		games = await fetchNewGames(source, username, watermark ?? null);
	} catch (e) {
		if (e instanceof LichessApiError || e instanceof ChesscomApiError) {
			if (e.status === 429) {
				return json({ imported: 0, skipped: 0, total: 0, rateLimited: true }, { status: 429 });
			}
			// 504: the platform didn't answer in time; the message says so.
			if (e.status === 404 || e.status === 504) {
				throw error(e.status, e.message);
			}
		}
		throw error(
			502,
			`Failed to fetch games from ${source}: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	const { imported, skipped, total } = await saveImportedGames(
		userId,
		source,
		username,
		watermark ?? null,
		games
	);

	// Provide a reason when no games were imported so the UI can explain why.
	let reason: string | undefined;
	if (total === 0 && imported === 0) {
		reason = watermark ? 'no_new_games' : 'no_games';
	} else if (total > 0 && imported === 0) {
		reason = 'all_skipped';
	}

	const more = total >= IMPORT_MAX_GAMES;
	return json({ imported, skipped, total, more, ...(reason && { reason }) });
};
