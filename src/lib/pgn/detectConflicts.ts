// Conflict detection for PGN import — compares parsed edges against
// the user's existing repertoire to produce an import preview.
//
// Two conflict types:
//   PGN_INTERNAL       — the PGN itself has multiple user moves at the same position
//   REPERTOIRE_VS_PGN  — existing repertoire has a different move than the PGN
//
// Opponent-turn moves never conflict — all variations are welcome.

import type { PgnEdge } from './parseVariations';
import { fenKey } from '$lib/fen';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A position where the user must choose between competing moves. */
export interface ImportConflict {
	fromFen: string; // full FEN of the conflicting position
	existingMove: string | null; // SAN already in repertoire (null for PGN_INTERNAL)
	alternatives: string[]; // all competing SANs (includes existingMove if present)
	source: 'REPERTOIRE_VS_PGN' | 'PGN_INTERNAL';
}

/** Full result of comparing parsed edges against the existing repertoire. */
export interface ImportPreview {
	/** User-turn edges that are new and have no conflict. */
	newUserMoves: PgnEdge[];
	/** Opponent-turn edges that are new. */
	newOpponentMoves: PgnEdge[];
	/** Count of edges that already exist identically in the repertoire. */
	duplicates: number;
	/** User-turn positions where a choice must be made. */
	conflicts: ImportConflict[];
	/** Invalid moves encountered during parsing. */
	parseErrors: string[];
}

/** Subset of existing repertoire move data needed for comparison. */
export interface ExistingMoveRow {
	fromFen: string;
	san: string;
}

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Compare PGN edges against existing repertoire moves to produce an import preview.
 *
 * For user-turn positions:
 *   - If the PGN has exactly one move and it matches the repertoire → duplicate (skip)
 *   - If the PGN has exactly one move and no repertoire move → new (will be inserted)
 *   - If the PGN has exactly one move but repertoire has a DIFFERENT move → REPERTOIRE_VS_PGN conflict
 *   - If the PGN has multiple moves at the same position → PGN_INTERNAL conflict
 *
 * For opponent-turn positions:
 *   - If the exact same fromFen+san exists → duplicate (skip)
 *   - Otherwise → new (will be inserted)
 */
export function detectConflicts(
	edges: PgnEdge[],
	existingMoves: ExistingMoveRow[],
	parseErrors: string[]
): ImportPreview {
	// Build a map from fenKey → Set<san> for all existing moves so the
	// edge-walking logic can check for duplicates and conflicts.
	const existingByFen = new Map<string, Set<string>>();
	for (const m of existingMoves) {
		const key = fenKey(m.fromFen);
		if (!existingByFen.has(key)) existingByFen.set(key, new Set());
		existingByFen.get(key)!.add(m.san);
	}

	// Group PGN user-turn edges by fenKey to detect PGN-internal conflicts.
	const userEdgesByFen = new Map<string, Map<string, PgnEdge>>();
	for (const edge of edges) {
		if (!edge.isUserTurn) continue;
		const key = fenKey(edge.fromFen);
		if (!userEdgesByFen.has(key)) userEdgesByFen.set(key, new Map());
		userEdgesByFen.get(key)!.set(edge.san, edge);
	}

	const newUserMoves: PgnEdge[] = [];
	const newOpponentMoves: PgnEdge[] = [];
	let duplicates = 0;
	const conflicts: ImportConflict[] = [];
	const processedUserFens = new Set<string>(); // avoid creating duplicate conflicts

	// Process user-turn edges (grouped by position)
	for (const [fKey, sanMap] of userEdgesByFen) {
		if (processedUserFens.has(fKey)) continue;
		processedUserFens.add(fKey);

		const pgnSans = Array.from(sanMap.keys());
		const existingSans = existingByFen.get(fKey);
		const existingSan = existingSans?.size === 1 ? existingSans.values().next().value : null;

		if (pgnSans.length > 1) {
			// PGN has multiple user moves at this position → PGN_INTERNAL conflict
			// If repertoire also has a move here, include it in alternatives.
			const allAlternatives = new Set(pgnSans);
			if (existingSan && !allAlternatives.has(existingSan)) {
				allAlternatives.add(existingSan);
			}
			conflicts.push({
				fromFen: sanMap.values().next().value!.fromFen,
				existingMove: existingSan ?? null,
				alternatives: Array.from(allAlternatives),
				source: 'PGN_INTERNAL'
			});
		} else {
			// PGN has exactly one user move at this position
			const pgnSan = pgnSans[0];

			if (existingSans && existingSans.has(pgnSan)) {
				// Exact same move already exists → duplicate
				duplicates++;
			} else if (existingSan && existingSan !== pgnSan) {
				// Repertoire has a DIFFERENT move → REPERTOIRE_VS_PGN conflict
				conflicts.push({
					fromFen: sanMap.get(pgnSan)!.fromFen,
					existingMove: existingSan,
					alternatives: [existingSan, pgnSan],
					source: 'REPERTOIRE_VS_PGN'
				});
			} else {
				// No existing move at this position → new
				newUserMoves.push(sanMap.get(pgnSan)!);
			}
		}
	}

	// Process opponent-turn edges
	for (const edge of edges) {
		if (edge.isUserTurn) continue;
		const key = fenKey(edge.fromFen);
		const existingSans = existingByFen.get(key);

		if (existingSans && existingSans.has(edge.san)) {
			duplicates++;
		} else {
			newOpponentMoves.push(edge);
		}
	}

	return { newUserMoves, newOpponentMoves, duplicates, conflicts, parseErrors };
}
