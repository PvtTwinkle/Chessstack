// Turns an opponent's PGNs into per-position move statistics for a prep.
// Pure, so it runs in the prep worker (src/lib/workers/prepParser.worker.ts)
// and in unit tests alike.

import { Chess } from 'chess.js';
import { fenKey } from '$lib/fen';
import type { AggregatedMove } from './types';

/** Maximum half-moves (plies) to process per game. Move 30 = ply 60. */
export const MAX_PLY = 60;

/** Minimum games a move must appear in to be included in results. */
export const MIN_GAMES = 2;

export interface AggregateResult {
	moves: AggregatedMove[];
	gamesAsWhite: number;
	gamesAsBlack: number;
}

/** Extract a PGN header value by name, e.g. getHeader(pgn, 'Result') → '1-0'. */
function getHeader(
	pgn: string,
	name: 'Result' | 'White' | 'Black' | 'Variant' | 'SetUp' | 'FEN'
): string | null {
	const patterns: Record<typeof name, RegExp> = {
		Result: /\[Result\s+"([^"]*)"\]/,
		White: /\[White\s+"([^"]*)"\]/,
		Black: /\[Black\s+"([^"]*)"\]/,
		Variant: /\[Variant\s+"([^"]*)"\]/,
		SetUp: /\[SetUp\s+"([^"]*)"\]/,
		FEN: /\[FEN\s+"([^"]*)"\]/
	};
	const match = pgn.match(patterns[name]);
	return match ? match[1] : null;
}

/**
 * Whether the game is standard chess from the usual start. Variants (Chess960,
 * King of the Hill, Atomic...) and games from a set-up position would put
 * moves into the tree that can't be played from the normal start.
 */
export function isStandardGame(pgn: string): boolean {
	const variant = getHeader(pgn, 'Variant');
	if (variant !== null && variant.toLowerCase() !== 'standard') return false;
	if (getHeader(pgn, 'SetUp') === '1') return false;
	if (getHeader(pgn, 'FEN') !== null) return false;
	return true;
}

/** Determine the game result as { whiteWin, blackWin, draw } counts (0 or 1). */
function parseResult(pgn: string): { whiteWin: number; blackWin: number; draw: number } {
	const result = getHeader(pgn, 'Result');
	if (result === '1-0') return { whiteWin: 1, blackWin: 0, draw: 0 };
	if (result === '0-1') return { whiteWin: 0, blackWin: 1, draw: 0 };
	if (result === '1/2-1/2') return { whiteWin: 0, blackWin: 0, draw: 1 };
	return { whiteWin: 0, blackWin: 0, draw: 0 }; // unknown result
}

/**
 * Aggregates the opponent's games. A game counts only when the opponent
 * played in it, it is standard chess and its whole PGN parses: a game that
 * fails partway adds nothing, rather than its first few moves.
 */
export function aggregateGames(
	pgns: string[],
	opponentUsername: string,
	onProgress?: (completed: number, total: number) => void
): AggregateResult {
	const usernameLower = opponentUsername.toLowerCase();

	// Aggregation map: "fen|san|oppColor" → stats
	const moveMap = new Map<string, AggregatedMove>();
	let gamesAsWhite = 0;
	let gamesAsBlack = 0;

	for (let i = 0; i < pgns.length; i++) {
		onProgress?.(i, pgns.length);
		const pgn = pgns[i];
		if (!isStandardGame(pgn)) continue;

		// Determine which color the opponent was playing
		const whitePlayer = getHeader(pgn, 'White') ?? '';
		const blackPlayer = getHeader(pgn, 'Black') ?? '';
		let opponentColor: 'w' | 'b';
		if (whitePlayer.toLowerCase() === usernameLower) opponentColor = 'w';
		else if (blackPlayer.toLowerCase() === usernameLower) opponentColor = 'b';
		else continue; // Username doesn't match either player

		let history;
		try {
			const chess = new Chess();
			chess.loadPgn(pgn);
			history = chess.history({ verbose: true });
		} catch {
			// Skip unparseable games — bad PGN data is expected occasionally
			continue;
		}

		if (opponentColor === 'w') gamesAsWhite++;
		else gamesAsBlack++;

		const result = parseResult(pgn);
		// Each move carries the positions before and after it, so nothing has
		// to be replayed from a fresh board.
		for (const move of history.slice(0, MAX_PLY)) {
			const beforeFen = fenKey(move.before);
			const key = `${beforeFen}|${move.san}|${opponentColor}`;
			const existing = moveMap.get(key);
			if (existing) {
				existing.gamesPlayed++;
				existing.whiteWins += result.whiteWin;
				existing.blackWins += result.blackWin;
				existing.draws += result.draw;
			} else {
				moveMap.set(key, {
					positionFen: beforeFen,
					moveSan: move.san,
					opponentColor,
					resultingFen: fenKey(move.after),
					gamesPlayed: 1,
					whiteWins: result.whiteWin,
					blackWins: result.blackWin,
					draws: result.draw
				});
			}
		}
	}

	// Two-pass filter: keep moves played >= MIN_GAMES ("core" tree), plus any
	// single-game continuations at positions reachable through the core tree.
	// This preserves leaf moves so users can see the end of established lines.
	const allMoves = Array.from(moveMap.values());
	const corePositions = new Set<string>();
	for (const m of allMoves) {
		if (m.gamesPlayed < MIN_GAMES) continue;
		corePositions.add(m.positionFen);
		corePositions.add(m.resultingFen);
	}
	const moves = allMoves.filter(
		(m) => m.gamesPlayed >= MIN_GAMES || corePositions.has(m.positionFen)
	);

	return { moves, gamesAsWhite, gamesAsBlack };
}
