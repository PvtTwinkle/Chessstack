// Drill mode page server load function.
//
// Loads the active repertoire's full move tree (for path reconstruction) and
// SR cards for drilling. By default only due cards (due <= now) are loaded.
//
// URL params alter behaviour:
//   ?mode=all          — load ALL cards regardless of due date (cards that
//                        aren't due are practice: shown but not graded)
//   ?fromFen=<fen>     — scope cards to the subtree rooted at that position
//
// Cards for "lead-in" moves (before the repertoire's start position) are
// filtered out so the user only drills positions within scope.
//
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { fenKey } from '$lib/gaps';
import { sanitizeFen } from '$lib/fen';
import { getEffectiveStartFens, buildInScopeFens } from '$lib/repertoire';
import { intervalLabels } from '$lib/fsrs';
import { loadFsrsConfig } from '$lib/server/fsrs-config';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const { activeRepertoireId, repertoires } = await parent();

	if (!activeRepertoireId) {
		redirect(302, '/');
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		redirect(302, '/');
	}

	const userId = locals.user!.id;
	const now = new Date();
	const drillMode = url.searchParams.get('mode') === 'all' ? 'all' : 'due';
	const rawFromFen = url.searchParams.get('fromFen');
	const fromFen = rawFromFen ? sanitizeFen(rawFromFen) : null;

	// All moves in the repertoire — used by the client to reconstruct the path
	// from move 1 to each due card's position.
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)));

	// Load SR cards — either all cards or only those currently due.
	let dueCards =
		drillMode === 'all'
			? await db
					.select()
					.from(userRepertoireMove)
					.where(
						and(
							eq(userRepertoireMove.userId, userId),
							eq(userRepertoireMove.repertoireId, activeRepertoireId)
						)
					)
			: await db
					.select()
					.from(userRepertoireMove)
					.where(
						and(
							eq(userRepertoireMove.userId, userId),
							eq(userRepertoireMove.repertoireId, activeRepertoireId),
							lte(userRepertoireMove.due, now)
						)
					);

	// Scope cards to a subtree if fromFen is provided, otherwise use the
	// default lead-in filter (positions reachable from the repertoire start).
	if (fromFen) {
		const subtree = buildInScopeFens([fromFen], moves);
		dueCards = dueCards.filter((c) => subtree.has(fenKey(c.fromFen)));
	} else {
		const startFens = getEffectiveStartFens(
			activeRep.startFen ?? null,
			moves,
			activeRep.color as 'WHITE' | 'BLACK'
		);
		const inScope = buildInScopeFens(startFens, moves);
		dueCards = dueCards.filter((c) => inScope.has(fenKey(c.fromFen)));
	}

	const fsrsConfig = await loadFsrsConfig(userId);

	// Pre-compute interval labels for each card so the drill buttons
	// can show "Forgot · 10 min", "Unsure · 2 days", etc.
	// isDue marks the cards that are really due: in "Drill all" the others are
	// practice and the client doesn't grade them.
	const cardsWithLabels = dueCards.map((card) => ({
		...card,
		isDue: card.due !== null && card.due <= now,
		intervalLabels: intervalLabels(card, now, fsrsConfig)
	}));

	return {
		repertoire: activeRep,
		moves,
		dueCards: cardsWithLabels,
		drillMode,
		fromFen
	};
};
