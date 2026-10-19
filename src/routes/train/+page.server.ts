// Opening trainer page server load.
//
// Loads the active repertoire, saved starting positions and the user's
// trainer rating for the train page. Finished games are written to
// trainer_session (POST /api/train/evaluate) but not read back anywhere yet.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { trainerSavedPosition, userSettings, userMove } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { activeRepertoireId, repertoires } = await parent();

	if (!activeRepertoireId) {
		redirect(302, '/');
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		redirect(302, '/');
	}

	const userId = locals.user!.id;

	// Run queries in parallel — all are independent reads
	const [savedPositions, settingsRow, repertoireMoves] = await Promise.all([
		db
			.select()
			.from(trainerSavedPosition)
			.where(eq(trainerSavedPosition.userId, userId))
			.orderBy(desc(trainerSavedPosition.createdAt)),
		db
			.select({ trainerRating: userSettings.trainerRating })
			.from(userSettings)
			.where(eq(userSettings.userId, userId)),
		// Load repertoire moves only when needed for path reconstruction
		// (repertoire has a custom startFen). Skipped for the common case.
		activeRep.startFen
			? db
					.select({ fromFen: userMove.fromFen, toFen: userMove.toFen, san: userMove.san })
					.from(userMove)
					.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)))
			: Promise.resolve([])
	]);

	return {
		repertoire: activeRep,
		savedPositions,
		trainerRating: settingsRow[0]?.trainerRating ?? null,
		repertoireMoves
	};
};
