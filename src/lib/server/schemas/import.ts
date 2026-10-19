// Request bodies for /api/import routes.

import { z } from 'zod';
import { IMPORT_MAX_MOVES, NOTES_MAX_LENGTH, PGN_MAX_BYTES } from '$lib/validation-limits';
import { fen, id, san } from './common';

/** PATCH /api/import/[id]: skip a game in the import queue, or un-skip it. */
export const updateImportedGameSchema = z.object({
	status: z.enum(['skipped', 'pending'])
});

/** POST /api/import/fetch */
export const fetchImportSchema = z.object({
	source: z.enum(['LICHESS', 'CHESSCOM'])
});

/** POST /api/import/parse. */
export const parseImportSchema = z.object({
	repertoireId: id,
	pgn: z.string().min(1).max(PGN_MAX_BYTES, { error: 'PGN is too large (max 1 MB)' })
});

// The route skips illegal moves (the parse step already reported them) and
// truncates long PGN comments to the notes limit rather than rejecting them.
const importMove = z.object({
	fromFen: fen,
	san,
	// Truncated to the notes limit by the route; the cap here only stops abuse.
	annotation: z
		.string()
		.max(NOTES_MAX_LENGTH * 10)
		.nullish()
});

/**
 * POST /api/import/execute. replacements lists the PGN moves the user chose
 * over a different move already in the repertoire.
 */
export const executeImportSchema = z.object({
	repertoireId: id,
	moves: z.array(importMove).min(1).max(IMPORT_MAX_MOVES),
	replacements: z.array(importMove).max(IMPORT_MAX_MOVES).default([])
});
