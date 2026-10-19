// Text alternatives for what the board and eval bar show by picture alone,
// read out to screen readers.

import { Chess } from 'chess.js';

const PIECE_NAMES: Record<string, string> = {
	K: 'King',
	Q: 'Queen',
	R: 'Rook',
	B: 'Bishop',
	N: 'Knight'
};

/**
 * Spells a SAN move out the way a person would say it, so a screen reader
 * doesn't read "Nxf3+" letter by letter: "Knight takes f3, check".
 */
export function sanToSpeech(san: string): string {
	let rest = san.replace(/[!?]+$/, '');
	let suffix = '';
	if (rest.endsWith('#')) {
		suffix = ', checkmate';
		rest = rest.slice(0, -1);
	} else if (rest.endsWith('+')) {
		suffix = ', check';
		rest = rest.slice(0, -1);
	}

	if (rest === 'O-O') return `Castles kingside${suffix}`;
	if (rest === 'O-O-O') return `Castles queenside${suffix}`;

	let promotion = '';
	const promo = rest.match(/=([QRBN])$/);
	if (promo) {
		promotion = `, promotes to ${PIECE_NAMES[promo[1]].toLowerCase()}`;
		rest = rest.slice(0, -2);
	}

	const piece = PIECE_NAMES[rest[0]];
	if (piece) rest = rest.slice(1);
	const words = rest
		.replace('x', ' takes ')
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0);
	return [piece, ...words].filter(Boolean).join(' ') + promotion + suffix;
}

/** The side to move in a FEN, as a word. */
function sideToMove(fen: string): 'White' | 'Black' {
	return fen.split(' ')[1] === 'b' ? 'Black' : 'White';
}

// Placement, side to move and castling rights: enough to tell positions apart
// without tripping over move counters or how a FEN writes en passant.
function positionPart(fen: string): string {
	return fen.split(' ').slice(0, 3).join(' ');
}

/**
 * The SAN of the move that leads from `before` to `after`, or null when no
 * single legal move does (a jump to another position, a new puzzle).
 */
export function moveBetween(before: string, after: string): string | null {
	try {
		const chess = new Chess(before);
		const target = positionPart(after);
		for (const move of chess.moves({ verbose: true })) {
			if (positionPart(move.after) === target) return move.san;
		}
	} catch {
		// An invalid FEN has no moves to describe.
	}
	return null;
}

/**
 * What the board's live region says after the position changes: the move
 * that was played when there is one, then whose turn it is or how the game
 * ended.
 */
export function describePositionChange(before: string | null, after: string): string {
	const san = before ? moveBetween(before, after) : null;
	const parts: string[] = [];
	if (san) parts.push(`${sanToSpeech(san)}.`);

	let status = `${sideToMove(after)} to move.`;
	try {
		const chess = new Chess(after);
		if (chess.isCheckmate()) status = 'Game over.';
		else if (chess.isStalemate()) status = 'Stalemate.';
	} catch {
		// Keep the plain side-to-move status for a FEN chess.js rejects.
	}
	parts.push(status);
	return parts.join(' ');
}

/**
 * The eval bar as text. The bar shows the sign only by which colour is
 * bigger, so it is spelled out: "White is better by 0.3".
 */
export function describeEval(evalCp: number | null, evalMate: number | null): string {
	if (evalMate !== null) {
		const side = evalMate > 0 ? 'White' : 'Black';
		const moves = Math.abs(evalMate);
		return `Evaluation: ${side} mates in ${moves} ${moves === 1 ? 'move' : 'moves'}`;
	}
	if (evalCp === null) return 'Evaluation: none yet';
	const pawns = (Math.abs(evalCp) / 100).toFixed(1);
	if (pawns === '0.0') return 'Evaluation: equal';
	return `Evaluation: ${evalCp > 0 ? 'White' : 'Black'} is better by ${pawns}`;
}
