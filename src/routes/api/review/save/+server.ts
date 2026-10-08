// POST /api/review/save
//
// Save a reviewed game to the database.
// Called from the review page when the user clicks "Save Review".
// Returns the new reviewed_game.id.
//
// When importedGameId is provided, the save links back to the imported_game
// record by updating its status to 'reviewed' and copying source/playedAt metadata.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, reviewedGame, importedGame } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { saveReviewSchema } from '$lib/server/schemas/review';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const { repertoireId, pgn, deviationFen, notes, importedGameId } = await parseBody(
		request,
		saveReviewSchema
	);

	// Verify the repertoire belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));
	if (!rep) throw error(404, 'Repertoire not found');

	if (await isRepertoireLocked(user.id, repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// If this review is linked to an imported game, look it up for metadata.
	let importedGameRow = null;
	if (importedGameId != null) {
		const [ig] = await db
			.select()
			.from(importedGame)
			.where(and(eq(importedGame.id, importedGameId), eq(importedGame.userId, user.id)));
		if (ig) importedGameRow = ig;
	}

	// Determine source and metadata from the imported game (or fall back to MANUAL).
	const source = importedGameRow?.source ?? 'MANUAL';
	const lichessGameId =
		importedGameRow?.source === 'LICHESS' ? importedGameRow.externalGameId : null;
	const playedAt = importedGameRow?.playedAt ?? null;

	const [saved] = await db
		.insert(reviewedGame)
		.values({
			userId: user.id,
			repertoireId,
			pgn,
			source,
			lichessGameId,
			deviationFen: deviationFen ? fenKey(deviationFen) : null,
			playedAt,
			reviewedAt: new Date(),
			notes
		})
		.returning();

	// Link the imported game back to this review.
	if (importedGameRow) {
		await db
			.update(importedGame)
			.set({
				status: 'reviewed',
				reviewedGameId: saved.id
			})
			.where(eq(importedGame.id, importedGameRow.id));
	}

	return json({ id: saved.id });
};
