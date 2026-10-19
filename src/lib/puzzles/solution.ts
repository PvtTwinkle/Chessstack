// Puzzle solutions: reading Lichess UCI moves and deciding whether the
// user's move counts as correct.

import { Chess, type Move } from 'chess.js';
import { fenKey } from '$lib/fen';

export interface UciMove {
	from: string;
	to: string;
	promotion?: string;
}

/** "e2e4" or "e7e8q" in the shape chess.js takes. */
export function parseUci(uci: string): UciMove {
	return {
		from: uci.slice(0, 2),
		to: uci.slice(2, 4),
		promotion: uci.length > 4 ? uci[4] : undefined
	};
}

/** Plays a UCI move on `chess`, or returns null when it isn't legal there. */
export function applyUci(chess: Chess, uci: string): Move | null {
	try {
		return chess.move(parseUci(uci));
	} catch {
		return null;
	}
}

/**
 * The side the user plays. A Lichess puzzle's FEN is the position before the
 * opponent's setup move, so the user is whoever is not to move in it.
 */
export function userSide(puzzleFen: string): 'white' | 'black' {
	return puzzleFen.split(' ')[1] === 'w' ? 'black' : 'white';
}

/**
 * How a move compares with the solution:
 * - 'continue': correct, and the solution goes on;
 * - 'mate': a checkmate, which solves the puzzle wherever it comes, as on
 *   Lichess (a puzzle can have more than one mate, and the user shouldn't be
 *   marked wrong for finding the other one);
 * - 'wrong': anything else.
 *
 * A move other than the listed one still counts when it reaches the same
 * position. A promotion has to be to the listed piece, since a different
 * piece gives a different position.
 */
export type MoveVerdict = 'continue' | 'mate' | 'wrong';

export function judgeMove(fenBefore: string, move: UciMove, expectedUci: string): MoveVerdict {
	const chess = new Chess(fenBefore);
	try {
		chess.move(move);
	} catch {
		return 'wrong';
	}
	if (chess.isCheckmate()) return 'mate';

	const expected = new Chess(fenBefore);
	if (!applyUci(expected, expectedUci)) return 'wrong';
	return fenKey(chess.fen()) === fenKey(expected.fen()) ? 'continue' : 'wrong';
}

// ── Display ─────────────────────────────────────────────────────────────────

/** "sicilian defense najdorf variation" → "Sicilian Defense Najdorf Variation". */
export function formatFamily(family: string): string {
	return family.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The space-separated theme column as a list. */
export function splitThemes(themes: string | null): string[] {
	if (!themes) return [];
	return themes.split(/\s+/).filter((t) => t.length > 0);
}

/** "mateIn2" → "Mate In 2", "hangingPiece" → "Hanging Piece". */
export function formatThemeLabel(tag: string): string {
	const spaced = tag.replace(/([A-Z])/g, ' $1').replace(/(\d+)/g, ' $1');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
