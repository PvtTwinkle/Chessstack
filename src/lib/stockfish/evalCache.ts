// Cache layer in front of getTopMoves(), keyed by (fen, depth).
//
// Used to color-code candidate moves by how good the resulting position is
// (currently the Players tab in CandidateMoves.svelte) without re-running
// Stockfish every time the same position is visited. See position_eval_cache
// in schema.ts for why this is shared across users rather than per-user.
//
// First visit to a position: computes live via getTopMoves() and stores the
// result. Every visit after that: a single indexed DB read, no engine call.

import { db } from '$lib/db';
import { positionEvalCache } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getTopMoves } from './index';

// Lower than the interactive Engine tab's depth (15–30, user-configurable).
// This runs in the background for up to a dozen candidate moves per
// position rather than for a single line the user is actively studying, so
// it trades precision for latency. Matches BATCH_DEPTH in
// /api/stockfish/batch, used for the same reason (classifying many
// positions, not producing a precise eval for one).
export const POSITION_EVAL_DEPTH = 14;

const EVAL_TIMEOUT_MS = 5_000;

export interface PositionEval {
	evalCp: number | null;
	evalMate: number | null;
}

// Returns the eval for `fen` at POSITION_EVAL_DEPTH from the cache,
// computing and storing it first on a cache miss.
//
// The returned eval is in Stockfish's raw convention — from the perspective
// of whoever is to move in `fen` — same as getTopMoves(). Callers apply
// their own white-perspective flip based on `fen`'s side to move, same
// pattern as /api/stockfish/stream and /api/stockfish/batch.
export async function getCachedEval(fen: string): Promise<PositionEval> {
	const [cached] = await db
		.select({ evalCp: positionEvalCache.evalCp, evalMate: positionEvalCache.evalMate })
		.from(positionEvalCache)
		.where(and(eq(positionEvalCache.fen, fen), eq(positionEvalCache.depth, POSITION_EVAL_DEPTH)));

	if (cached) return cached;

	const moves = await getTopMoves(fen, POSITION_EVAL_DEPTH, 1, EVAL_TIMEOUT_MS);
	const best = moves[0];
	const result: PositionEval = {
		evalCp: best?.scoreCp ?? null,
		evalMate: best?.scoreMate ?? null
	};

	// Best-effort write. A losing race on the same (fen, depth) from a
	// concurrent request is fine — the eval is objective, so the discarded
	// row would have held the same value anyway (or the position simply
	// gets recomputed once more on a future miss, no correctness impact).
	try {
		await db
			.insert(positionEvalCache)
			.values({
				fen,
				depth: POSITION_EVAL_DEPTH,
				evalCp: result.evalCp,
				evalMate: result.evalMate
			})
			.onConflictDoNothing();
	} catch (err) {
		console.error('[chessstack] Failed to persist position eval cache entry:', err);
	}

	return result;
}
