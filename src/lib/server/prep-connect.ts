// The moves the prep board lets the user walk through on the way to a prep
// move: the opponent's games and the user's own repertoires of that colour.
// Export and add-to-repertoire use them to connect prep moves that no saved
// move leads to (see $lib/prep/connect.ts).

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { opponentMoves, repertoire, userMove } from '$lib/db/schema';
import type { Edge } from '$lib/prep/connect';

type OpponentMoveRow = typeof opponentMoves.$inferSelect;

export async function walkableEdges(
	userId: number,
	color: 'WHITE' | 'BLACK',
	oppMoves: OpponentMoveRow[]
): Promise<Edge[]> {
	const coverage = await db
		.select({ fromFen: userMove.fromFen, toFen: userMove.toFen, san: userMove.san })
		.from(userMove)
		.innerJoin(repertoire, eq(userMove.repertoireId, repertoire.id))
		.where(and(eq(userMove.userId, userId), eq(repertoire.color, color)));
	return [
		...oppMoves.map((m) => ({ fromFen: m.positionFen, toFen: m.resultingFen, san: m.moveSan })),
		...coverage
	];
}
