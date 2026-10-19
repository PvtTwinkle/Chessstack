// Prep detail page — loads a single opponent prep with all associated data.
//
// Loads: prep metadata, opponent moves, prep moves, and repertoire coverage
// for comparison against the user's existing repertoires.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves, prepMoves, userMove, repertoire } from '$lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(302, '/login');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) redirect(302, '/prep');

	// Verify ownership. A pending upload isn't a prep yet.
	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(
			and(
				eq(opponentPreps.id, prepId),
				eq(opponentPreps.userId, locals.user.id),
				isNull(opponentPreps.pendingSince)
			)
		);

	if (!prep) redirect(302, '/prep');

	const userId = locals.user.id;

	// Load opponent moves, prep moves, and repertoire coverage in parallel
	const [oppMoves, userPrepMoves, coverageData] = await Promise.all([
		db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId)),
		db.select().from(prepMoves).where(eq(prepMoves.prepId, prepId)),
		// Join userMove with repertoire to get coverage with repertoire names
		db
			.select({
				fromFen: userMove.fromFen,
				san: userMove.san,
				color: repertoire.color,
				repertoireName: repertoire.name
			})
			.from(userMove)
			.innerJoin(repertoire, eq(userMove.repertoireId, repertoire.id))
			.where(and(eq(userMove.userId, userId), eq(repertoire.userId, userId)))
	]);

	return {
		prep,
		opponentMoves: oppMoves,
		prepMoves: userPrepMoves,
		repertoireCoverage: coverageData
	};
};
