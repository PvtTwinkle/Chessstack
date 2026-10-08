// Turns raw engine moves into what the UI shows: SAN, scored from White's side.

import { Chess } from 'chess.js';
import type { EngineMove } from './uci';

export interface EngineCandidate {
	san: string;
	uci: string;
	// Centipawns from White's perspective; null for a mate score.
	evalCp: number | null;
	// Moves to mate from White's perspective (negative = Black mates).
	evalMate: number | null;
}

// Stockfish scores from the side to move; flip them for Black to move.
// Moves that aren't legal in `fen` (a stale result) are dropped.
export function toCandidates(fen: string, moves: EngineMove[]): EngineCandidate[] {
	let chess: Chess;
	try {
		chess = new Chess(fen);
	} catch {
		return [];
	}
	const sign = chess.turn() === 'w' ? 1 : -1;
	const candidates: EngineCandidate[] = [];
	for (const move of moves) {
		try {
			const result = new Chess(fen).move({
				from: move.uci.slice(0, 2),
				to: move.uci.slice(2, 4),
				promotion: move.uci[4] as 'q' | 'r' | 'b' | 'n' | undefined
			});
			candidates.push({
				san: result.san,
				uci: move.uci,
				evalCp: move.scoreCp != null ? move.scoreCp * sign : null,
				evalMate: move.scoreMate != null ? move.scoreMate * sign : null
			});
		} catch {
			// Not legal here; skip it.
		}
	}
	return candidates;
}

// How many candidates to ask for: never more than the legal moves, or the
// engine never completes a depth with every variation filled.
export function candidateCount(fen: string, wanted: number): number {
	try {
		return Math.max(1, Math.min(wanted, new Chess(fen).moves().length));
	} catch {
		return wanted;
	}
}
