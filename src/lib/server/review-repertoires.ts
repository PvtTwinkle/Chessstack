// Loads the repertoires a game can be reviewed against, shared by the Review
// page's analyzeGame action and POST /api/import/[id]/analyze.

import { db } from '$lib/db';
import { repertoire, userMove } from '$lib/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getLockedRepertoireIds } from '$lib/stripe/tiers';

export type RepertoireRow = typeof repertoire.$inferSelect;
export type MoveRow = typeof userMove.$inferSelect;

/**
 * The user's repertoires of one colour that their plan lets them use, each
 * with its moves. Locked repertoires are left out so they're never offered:
 * analysing against one is refused anyway. Two queries, however many
 * repertoires there are.
 */
export async function loadReviewRepertoires(
	userId: number,
	tier: string,
	color: 'WHITE' | 'BLACK'
): Promise<{ rep: RepertoireRow; moves: MoveRow[] }[]> {
	// Locking is decided over all of the user's repertoires in creation order,
	// as in the layout, not just those of this colour.
	const all = await db
		.select()
		.from(repertoire)
		.where(eq(repertoire.userId, userId))
		.orderBy(asc(repertoire.createdAt), asc(repertoire.id));
	const locked = getLockedRepertoireIds(all, tier);
	const reps = all.filter((r) => r.color === color && !locked.has(r.id));
	if (reps.length === 0) return [];

	const moves = await db
		.select()
		.from(userMove)
		.where(
			and(
				eq(userMove.userId, userId),
				inArray(
					userMove.repertoireId,
					reps.map((r) => r.id)
				)
			)
		);
	const byRep = new Map<number, MoveRow[]>(reps.map((r) => [r.id, []]));
	for (const m of moves) byRep.get(m.repertoireId)?.push(m);
	return reps.map((rep) => ({ rep, moves: byRep.get(rep.id) ?? [] }));
}
