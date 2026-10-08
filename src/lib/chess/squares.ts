// Square lookups for SAN moves, used to draw arrows and hint highlights.

import { Chess } from 'chess.js';

/** From/to squares of a SAN move in a position, or null if it is not legal there. */
export function getMoveSquares(fen: string, san: string): { from: string; to: string } | null {
	try {
		const chess = new Chess(fen);
		const result = chess.move(san);
		if (!result) return null;
		return { from: result.from, to: result.to };
	} catch {
		return null;
	}
}

/** The square the piece moves from for a SAN move (for hints), or null if not legal. */
export function getHintSquare(fen: string, san: string): string | null {
	return getMoveSquares(fen, san)?.from ?? null;
}
