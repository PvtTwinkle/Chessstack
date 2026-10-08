// ECO opening name lookup.
//
// ECO (Encyclopaedia of Chess Openings) codes classify openings with a
// short identifier like "B90" and a name like "Sicilian Defence, Najdorf
// Variation". This module provides a server-side function to look up the
// most specific recognised name for the current board position.
//
// Why "most specific"?
//   The current position may not have a name in the ECO table — it might be
//   a move or two past the last named position. In that case we walk backwards
//   through the move history and return the deepest position that IS named.
//   This means the display shows something like "B90 · Sicilian Defence,
//   Najdorf Variation" even after a few more moves have been played.

import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ecoOpening } from '$lib/db/schema';
import { fenKey } from '$lib/fen';
import type * as schema from '$lib/db/schema';

// Look up the most specific ECO name for a sequence of board positions.
//
// Parameters:
//   db   — the Drizzle database instance
//   fens — FEN strings ordered from most specific (current) to least specific
//           (oldest position in the game history). The first match wins, so
//           the current position is checked before fallbacks.
//
// Returns the ECO code and name for the first FEN that has a match, or null
// if none of the provided FENs are in the ECO table.
export async function lookupEco(
	db: PostgresJsDatabase<typeof schema>,
	fens: string[]
): Promise<{ code: string; name: string } | null> {
	if (fens.length === 0) return null;

	// eco_opening.fen holds 4-field keys (migration 0011), but callers such as
	// OpeningName.svelte send chess.js's 6-field FENs, which never matched.
	const keys = fens.map(fenKey);

	// Fetch all matching rows in a single query — no N+1 lookups.
	const matches = await db
		.select({
			code: ecoOpening.code,
			name: ecoOpening.name,
			fen: ecoOpening.fen
		})
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, keys));

	if (matches.length === 0) return null;

	// Build a map so we can check each FEN in O(1).
	const byFen = new Map(matches.map((m) => [m.fen, { code: m.code, name: m.name }]));

	// Return the first match walking from current → oldest.
	// This gives us the most specific recognised opening name.
	for (const key of keys) {
		const match = byFen.get(key);
		if (match) return match;
	}

	return null;
}
