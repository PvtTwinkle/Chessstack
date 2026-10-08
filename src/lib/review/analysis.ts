// Pure helpers for the Review page's analysis screen: chain-extension legs,
// repertoire lookups, move-list colours and board arrows. No Svelte state
// here — reviewState.svelte.ts wires these to the reactive page state.

import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { GameAnalysis, GameIssue } from '$lib/pgn';
import { getMoveSquares } from '$lib/chess/squares';
import { fenKey } from '$lib/fen';
import {
	computeCpl,
	getCplClass,
	isUserPly,
	type PlayerColor,
	type PositionEval
} from './evaluation';

// ── Chain extension ─────────────────────────────────────────────────────────
// After a user adds their game response (OPPONENT_SURPRISE phase 2) or their
// own move (BEYOND_REPERTOIRE phase 1), if there are more game moves we offer
// to keep building the repertoire. Each "leg" of the chain represents one
// pending opponent-move → user-response pair still waiting to be added.

export interface ChainLeg {
	opponentFen: string; // FEN where the opponent needs to move (user just added a move here)
	opponentSan: string; // what the opponent played in the actual game
	opponentAdded: boolean; // true once the opponent's move has been saved to the repertoire
	userFen: string | null; // FEN after the opponent's move (where user must respond), or null if game ended
	userSan: string | null; // user's actual in-game response, or null if game ended
	plyInGame: number; // 1-indexed ply of the opponent's move (used to advance the chain)
	// Non-null when the user-response position is already in the repertoire (transposition).
	transposition: {
		existingSan: string; // the move already in the repertoire at this FEN
		userPlayedCorrect: boolean; // did the user play the repertoire move in the game?
	} | null;
}

/**
 * Build a chain leg for a given opponent ply in the game.
 * Returns null if there are no more game moves at that ply (game ended).
 * `getUserMoveAt` returns the repertoire move at a user-turn FEN, if any.
 */
export function buildChainLeg(
	analysis: GameAnalysis,
	opponentPlyInGame: number,
	getUserMoveAt: (fen: string) => string | undefined
): ChainLeg | null {
	const sanIdx = opponentPlyInGame - 1; // convert 1-indexed ply to 0-indexed array position
	if (sanIdx >= analysis.sanHistory.length) return null; // no such ply in the game

	const opponentSan = analysis.sanHistory[sanIdx];
	const opponentFen = analysis.fenHistory[sanIdx]; // FEN before the opponent's move
	const userFen = analysis.fenHistory[opponentPlyInGame] ?? null; // FEN after opponent's move
	const userSan = analysis.sanHistory[opponentPlyInGame] ?? null; // user's game response (may not exist)

	// Check if the user-response position is already in the repertoire (transposition).
	let transposition: ChainLeg['transposition'] = null;
	if (userFen && userSan) {
		const existingSan = getUserMoveAt(userFen);
		if (existingSan) {
			transposition = {
				existingSan,
				userPlayedCorrect: userSan === existingSan
			};
		}
	}

	return {
		opponentFen,
		opponentSan,
		opponentAdded: false,
		userFen,
		userSan,
		plyInGame: opponentPlyInGame,
		transposition
	};
}

/** The minimum a repertoire move row needs for the user-move lookup. */
export interface RepertoireMoveRow {
	repertoireId: number;
	fromFen: string;
	san: string;
}

/** The repertoire's move at `fen` when it is the user's turn there, if any. */
export function findUserMove(
	moves: readonly RepertoireMoveRow[],
	repertoireId: number,
	color: PlayerColor,
	fen: string
): string | undefined {
	const key = fenKey(fen);
	for (const m of moves) {
		if (m.repertoireId !== repertoireId) continue;
		const turn = m.fromFen.split(' ')[1];
		const isUserTurn = (color === 'WHITE' && turn === 'w') || (color === 'BLACK' && turn === 'b');
		if (isUserTurn && fenKey(m.fromFen) === key) return m.san;
	}
	return undefined;
}

// ── Move list ───────────────────────────────────────────────────────────────

/** Lookup map: issue.ply → GameIssue. */
export function issuesByPly(analysis: GameAnalysis | null): ReadonlyMap<number, GameIssue> {
	return new Map(analysis ? analysis.issues.map((iss) => [iss.ply, iss]) : []);
}

/** The ply after which analysis stopped (off-book territory). */
export function analysisCutoffPly(analysis: GameAnalysis | null): number {
	if (!analysis || analysis.issues.length === 0) return Number.MAX_SAFE_INTEGER;
	const last = analysis.issues[analysis.issues.length - 1];
	return last.type === 'OPPONENT_SURPRISE' ? last.ply + 1 : last.ply;
}

const CPL_COLORS = {
	best: 'var(--color-eval-best)',
	good: 'var(--color-eval-good)',
	inaccuracy: 'var(--color-eval-inaccuracy)',
	mistake: 'var(--color-eval-mistake)',
	blunder: 'var(--color-eval-blunder)'
} as const;

/**
 * CSS colour for a move in the move list. CPL classification is used for
 * user moves once engine evals are available; until then, repertoire-based
 * colours (issue type, off-book, on-book).
 */
export function moveColor(
	ply: number,
	color: PlayerColor,
	evals: ReadonlyMap<number, PositionEval>,
	issueByPly: ReadonlyMap<number, GameIssue>,
	cutoffPly: number
): string {
	const isUserMove = isUserPly(ply, color);

	// Engine eval colors for user moves (when available).
	if (isUserMove) {
		const cpl = computeCpl(ply, evals);
		if (cpl !== null) return CPL_COLORS[getCplClass(cpl)];
	}

	// Fall back to repertoire-based colors while eval loads.
	const issue = issueByPly.get(ply);
	if (issue) {
		if (issue.type === 'DEVIATION') return 'var(--color-accent-dim)';
		if (issue.type === 'BEYOND_REPERTOIRE') return 'var(--color-accent)';
		if (issue.type === 'OPPONENT_SURPRISE') return 'var(--color-danger)';
	}
	if (ply > cutoffPly) return 'var(--color-text-muted)'; // dim — off-book

	return isUserMove ? 'var(--color-success)' : 'var(--color-text-secondary)';
}

// ── Board arrows ────────────────────────────────────────────────────────────

/**
 * Overlay arrows on the board:
 *
 * DEVIATION        — red = wrong move; green = correct repertoire move.
 * Chain phase A    — red = opponent's proposed move.
 * Hover            — blue arrow for the candidate move the user is hovering over
 *                    (from ReviewIssuePicker / CandidateMoves).
 */
export function reviewBoardShapes(args: {
	analysis: GameAnalysis | null;
	currentPlyIdx: number;
	resolvedIssues: ReadonlySet<number>;
	chainExtensions: ReadonlyMap<number, ChainLeg>;
	hoveredFen: string | null;
	hoveredSan: string | null;
}): DrawShape[] {
	const { analysis, currentPlyIdx, resolvedIssues, chainExtensions, hoveredFen, hoveredSan } = args;
	if (!analysis) return [];

	const shapes: DrawShape[] = [];

	// DEVIATION: red for the wrong move, green for the correct one.
	const dev = analysis.issues.find((iss) => iss.type === 'DEVIATION' && currentPlyIdx === iss.ply);
	if (dev && dev.repertoireSan) {
		const wFrom = analysis.fromSquares[dev.ply - 1];
		const wTo = analysis.toSquares[dev.ply - 1];
		if (wFrom && wTo) shapes.push({ orig: wFrom as Key, dest: wTo as Key, brush: 'red' });
		const correct = getMoveSquares(dev.fromFen, dev.repertoireSan);
		if (correct)
			shapes.push({ orig: correct.from as Key, dest: correct.to as Key, brush: 'green' });
		return shapes;
	}

	// Chain phase A: board is one ply before the chain opponent's move — show it as red.
	for (const issue of analysis.issues) {
		if (resolvedIssues.has(issue.ply)) continue;
		const chainLeg = chainExtensions.get(issue.ply) ?? null;
		if (chainLeg && !chainLeg.opponentAdded && currentPlyIdx === chainLeg.plyInGame - 1) {
			const sq = getMoveSquares(chainLeg.opponentFen, chainLeg.opponentSan);
			if (sq) shapes.push({ orig: sq.from as Key, dest: sq.to as Key, brush: 'red' });
			return shapes;
		}
	}

	// Hover arrow from ReviewIssuePicker — blue arrow for the hovered candidate.
	if (hoveredSan && hoveredFen) {
		const sq = getMoveSquares(hoveredFen, hoveredSan);
		if (sq) shapes.push({ orig: sq.from as Key, dest: sq.to as Key, brush: 'blue' });
	}

	return shapes;
}

// ── Deviation evals ─────────────────────────────────────────────────────────

/**
 * True when the engine rates the move the user played above the repertoire
 * move (both evals from White's perspective, compared from the player's).
 */
export function playedMoveIsBetter(
	ev: { played: number | null; correct: number | null } | undefined,
	color: PlayerColor
): boolean {
	return (
		ev?.played != null &&
		ev?.correct != null &&
		(color === 'BLACK' ? -ev.played : ev.played) > (color === 'BLACK' ? -ev.correct : ev.correct)
	);
}
