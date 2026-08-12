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
import type * as schema from '$lib/db/schema';
import { fenKey } from '$lib/fen';

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

	// Fetch all matching rows in a single query — no N+1 lookups.
	const matches = await db
		.select({
			code: ecoOpening.code,
			name: ecoOpening.name,
			fen: ecoOpening.fen
		})
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, fens));

	if (matches.length === 0) return null;

	// Build a map so we can check each FEN in O(1).
	const byFen = new Map(matches.map((m) => [m.fen, { code: m.code, name: m.name }]));

	// Return the first match walking from current → oldest.
	// This gives us the most specific recognised opening name.
	for (const fen of fens) {
		const match = byFen.get(fen);
		if (match) return match;
	}

	return null;
}

/**
 * Classify many positions against eco_opening in a single round trip.
 *
 * For each requested position, walks backward through the repertoire's
 * move graph (toFen → fromFen) to reconstruct its ancestor chain back to
 * the repertoire start, exactly like fenHistoryForLine does client-side by
 * replaying SAN — except here the chain is read directly from already-known
 * userMove rows, so no chess.js replay is needed. Every FEN across every
 * chain is then looked up in one query, and each position resolves to the
 * most specific (deepest) named ancestor, same fallback rule as lookupEco.
 *
 * eco_opening.fen is stored 4-field normalized (see
 * 0011_normalize_fen_4field.sql) — every FEN is run through fenKey() before
 * comparison, same fix as api/eco/+server.ts applies for the single-lookup
 * case.
 *
 * @param db     Drizzle instance
 * @param moves  All userMove rows for the repertoire (only fromFen/toFen read)
 * @param fens   The positions to classify — does not need to be pre-normalized
 * @returns      Map from the exact input fen string → match, or null if none
 *               of its ancestors have a recognised name
 */
export async function lookupEcoBatch(
	db: PostgresJsDatabase<typeof schema>,
	moves: { fromFen: string; toFen: string }[],
	fens: string[]
): Promise<Map<string, { code: string; name: string } | null>> {
	// Reverse adjacency: toFen key → fromFen key, to walk backward from any
	// position toward the repertoire start.
	const parentOf = new Map<string, string>();
	for (const m of moves) {
		parentOf.set(fenKey(m.toFen), fenKey(m.fromFen));
	}

	// Build each position's ancestor chain: [current, parent, grandparent, ...].
	const chains = new Map<string, string[]>();
	const allChainFens = new Set<string>();
	for (const fen of fens) {
		const key = fenKey(fen);
		const chain: string[] = [key];
		const seen = new Set([key]); // guards against a malformed cyclic graph
		let cursor = key;
		while (true) {
			const parent = parentOf.get(cursor);
			if (!parent || seen.has(parent)) break;
			chain.push(parent);
			seen.add(parent);
			cursor = parent;
		}
		chains.set(fen, chain);
		for (const f of chain) allChainFens.add(f);
	}

	if (allChainFens.size === 0) return new Map(fens.map((f) => [f, null]));

	// One query covering every FEN across every chain, regardless of how
	// many positions were requested.
	const matches = await db
		.select({ code: ecoOpening.code, name: ecoOpening.name, fen: ecoOpening.fen })
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, Array.from(allChainFens)));
	const byFen = new Map(matches.map((m) => [m.fen, { code: m.code, name: m.name }]));

	// Walk each chain from current → oldest; first match wins (most specific).
	const result = new Map<string, { code: string; name: string } | null>();
	for (const fen of fens) {
		const chain = chains.get(fen) ?? [fenKey(fen)];
		let found: { code: string; name: string } | null = null;
		for (const f of chain) {
			const m = byFen.get(f);
			if (m) {
				found = m;
				break;
			}
		}
		result.set(fen, found);
	}
	return result;
}
