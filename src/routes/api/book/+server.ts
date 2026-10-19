// POST /api/book
//
// Given a board position (FEN), returns every move the shared opening book
// knows from it, with the curator's annotation and the ECO name of the
// position the move leads to. Book moves carry no engine evaluation: the book
// is the authority on opening theory, and engine analysis runs in the browser
// ($lib/engine).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { bookMove, ecoOpening } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { Chess } from 'chess.js';
import { fenKey } from '$lib/fen';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth, rateLimitResponse } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { bookLookupSchema } from '$lib/server/schemas/engine';
import type { Candidate } from '$lib/api-types';

// Book moves carry no engine evaluation: evalCp and evalMate are always null,
// keeping the shape of the Engine tab's candidates.
type BookCandidate = Candidate & { evalCp: null; evalMate: null; isBook: true };

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireAuth(locals);

	const limited = await rateLimitResponse(user.id, RATE_LIMITS.book);
	if (limited) return limited;

	const { fen } = await parseBody(request, bookLookupSchema);

	// The book and ECO tables store 4-field FENs.
	const bookMoves = await db
		.select()
		.from(bookMove)
		.where(eq(bookMove.fromFen, fenKey(fen)));

	// Name the position each book move leads to, in one round-trip.
	const toFens = bookMoves.map((bm) => bm.toFen).filter(Boolean) as string[];
	const openingRows =
		toFens.length > 0
			? await db.select().from(ecoOpening).where(inArray(ecoOpening.fen, toFens))
			: [];
	const fenToOpeningName = new Map(openingRows.map((r) => [r.fen, r.name]));

	const candidates: BookCandidate[] = [];
	for (const bm of bookMoves) {
		// chess.js throws on an illegal move; skip one if the book ever has it.
		let result;
		try {
			result = new Chess(fen).move(bm.san);
		} catch {
			continue;
		}
		candidates.push({
			san: bm.san,
			uci: result.from + result.to + (result.promotion ?? ''),
			evalCp: null,
			evalMate: null,
			isBook: true,
			annotation: bm.annotation ?? null,
			openingName: bm.toFen ? (fenToOpeningName.get(bm.toFen) ?? null) : null
		});
	}

	// Book moves are returned in insertion order, which is the curated order.
	return json({ candidates });
};
