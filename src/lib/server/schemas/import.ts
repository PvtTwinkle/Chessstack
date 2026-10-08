// Request bodies for /api/import routes.

import { z } from 'zod';
import { fen, id } from './common';

/** PATCH /api/import/[id]: skip a game in the import queue, or un-skip it. */
export const updateImportedGameSchema = z.object({
	status: z.enum(['skipped', 'pending'])
});

/** POST /api/import/fetch */
export const fetchImportSchema = z.object({
	source: z.enum(['LICHESS', 'CHESSCOM'])
});

/** POST /api/import/parse. The route also caps the PGN size (413). */
export const parseImportSchema = z.object({
	repertoireId: id,
	pgn: z.string().min(1)
});

// The route skips illegal moves (the parse step already reported them) and
// truncates long PGN comments to the notes limit rather than rejecting them.
const importMove = z.object({
	fromFen: fen,
	san: z.string().min(1),
	annotation: z.string().nullish()
});

/**
 * POST /api/import/execute. replacements lists the PGN moves the user chose
 * over a different move already in the repertoire.
 */
export const executeImportSchema = z.object({
	repertoireId: id,
	moves: z.array(importMove).min(1),
	replacements: z.array(importMove).default([])
});
