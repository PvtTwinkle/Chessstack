// POST /api/import/parse
//
// Parse a PGN with variations and compare against the user's existing
// repertoire to produce an import preview with conflict detection.
//
// Input:  { repertoireId: number, pgn: string }
// Output: ImportPreview (new moves, duplicates, conflicts, parse errors)
//
// This endpoint is stateless — no server-side storage between parse and
// execute. The client holds the preview and sends resolved moves back.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseVariationPgn } from '$lib/pgn/parseVariations';
import { detectConflicts } from '$lib/pgn/detectConflicts';
import { rateLimitResponse, requireAuth } from '$lib/server/api-helpers';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { PGN_MAX_BYTES } from '$lib/validation-limits';
import { parseBody } from '$lib/server/validation';
import { parseImportSchema } from '$lib/server/schemas/import';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const limited = await rateLimitResponse(user.id, RATE_LIMITS.importParse);
	if (limited) return limited;

	const { repertoireId, pgn } = await parseBody(request, parseImportSchema);

	// The schema caps characters; this caps bytes, since parsing cost follows
	// the byte size and non-ASCII comments take several bytes per character.
	if (new TextEncoder().encode(pgn).byteLength > PGN_MAX_BYTES) {
		throw error(413, 'PGN is too large — maximum size is 1 MB');
	}

	// Verify repertoire ownership
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));
	if (!rep) throw error(404, 'Repertoire not found');

	// Parse the PGN into edges
	let parsed;
	try {
		parsed = parseVariationPgn(pgn, rep.color as 'WHITE' | 'BLACK');
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to parse PGN');
	}

	if (parsed.edges.length === 0) {
		throw error(400, 'PGN produced no valid moves');
	}

	// Load existing repertoire moves for conflict comparison
	const existingMoves = await db
		.select({ fromFen: userMove.fromFen, san: userMove.san })
		.from(userMove)
		.where(and(eq(userMove.userId, user.id), eq(userMove.repertoireId, repertoireId)));

	// Detect conflicts
	const preview = detectConflicts(parsed.edges, existingMoves, parsed.errors);

	return json(preview);
};
