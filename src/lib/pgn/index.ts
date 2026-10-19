// PGN parser and game analysis helpers — used by the game review feature.
//
// Two core exports:
//   parsePgn(rawPgn)  — pure: parses a PGN string into a structured game object.
//   analyzeGame(...)  — pure: walks the game against the user's repertoire and
//                       classifies each deviation.
//
// Both are pure (no database access) so the caller is responsible for loading
// the repertoire rows from the DB before calling analyzeGame.

import { Chess } from 'chess.js';
import { fenKey, STARTING_FEN } from '$lib/fen';
import { countPgnGames } from './parseVariations';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IssueType = 'DEVIATION' | 'BEYOND_REPERTOIRE' | 'OPPONENT_SURPRISE';

/**
 * A single problem found during game analysis:
 *   DEVIATION         — user's turn; played a different move than their repertoire says.
 *   BEYOND_REPERTOIRE — user's turn; no repertoire move exists for this position at all.
 *   OPPONENT_SURPRISE — opponent's turn; opponent played a move the user hasn't prepared for.
 */
export interface GameIssue {
	type: IssueType;
	ply: number; // 1-indexed ply where the issue occurs
	fromFen: string; // FEN before the issue move
	toFen: string; // FEN after the issue move
	playedSan: string; // what was actually played (opponent's move for OPPONENT_SURPRISE)
	repertoireSan: string | null; // what the repertoire expected (null for BEYOND_REPERTOIRE / OPPONENT_SURPRISE)
	// OPPONENT_SURPRISE only — what the user played in response to the surprise:
	userResponseSan: string | null;
	userResponseToFen: string | null;
}

/** Full result of analyzing a game against the user's repertoire. */
export interface GameAnalysis {
	issues: GameIssue[];
	firstDeviationFen: string | null; // stored in reviewed_game.deviation_fen
	// Full game navigation data (includes all plies, not just analyzed ones).
	// fenHistory[0] = starting position. fenHistory[i] = position after ply i.
	fenHistory: string[];
	sanHistory: string[]; // SAN of each move; sanHistory[0] = ply 1
	fromSquares: string[]; // source square of each move, e.g. "e2"
	toSquares: string[]; // target square of each move, e.g. "e4"
}

/** A parsed PGN ready for analysis. */
export interface ParsedGame {
	pgn: string;
	moves: {
		san: string;
		before: string; // FEN before the move
		after: string; // FEN after the move
		from: string; // source square
		to: string; // target square
	}[];
	headers: Record<string, string>; // PGN header tags: White, Black, Date, Result, etc.
}

/** Subset of user_move fields needed by analyzeGame. */
export interface RepertoireMoveRow {
	fromFen: string;
	toFen: string;
	san: string;
}

// ─── formatOpeningMoves ──────────────────────────────────────────────────────

/** Format the first N half-moves as readable notation, e.g. "1. e4 e5 2. Nf3 Nc6". */
export function formatOpeningMoves(moves: { san: string }[], plies = 4): string {
	const slice = moves.slice(0, plies);
	let result = '';
	for (let i = 0; i < slice.length; i++) {
		if (i % 2 === 0) result += `${Math.floor(i / 2) + 1}. `;
		result += slice[i].san;
		if (i < slice.length - 1) result += ' ';
	}
	return result || '(empty game)';
}

// ─── computeMatchDepth ───────────────────────────────────────────────────────

/**
 * Count how many consecutive plies from the start of a game fall within a
 * repertoire's move tree. Used to determine which repertoire best matches
 * a game — higher depth = more opening overlap.
 *
 * Returns 0 if the repertoire doesn't cover the game's first move at all
 * (e.g. a 1.e4 repertoire vs a 1.d4 game).
 */
export function computeMatchDepth(
	gameMoves: ParsedGame['moves'],
	repertoireMoves: RepertoireMoveRow[],
	playerColor: 'WHITE' | 'BLACK'
): number {
	// Build lookup maps (same structure as analyzeGame).
	const userMoveByFen = new Map<string, string>();
	const opponentMovesByFen = new Map<string, Set<string>>();

	for (const rm of repertoireMoves) {
		const key = fenKey(rm.fromFen);
		const fenTurn = rm.fromFen.split(' ')[1]; // 'w' or 'b'
		const isUserTurn =
			(playerColor === 'WHITE' && fenTurn === 'w') || (playerColor === 'BLACK' && fenTurn === 'b');

		if (isUserTurn) {
			userMoveByFen.set(key, rm.san);
		} else {
			if (!opponentMovesByFen.has(key)) opponentMovesByFen.set(key, new Set());
			opponentMovesByFen.get(key)!.add(rm.san);
		}
	}

	// Walk the game and count consecutive plies covered by the repertoire.
	let depth = 0;

	for (const move of gameMoves) {
		const key = fenKey(move.before);
		const fenTurn = move.before.split(' ')[1];
		const isUserTurn =
			(playerColor === 'WHITE' && fenTurn === 'w') || (playerColor === 'BLACK' && fenTurn === 'b');

		if (isUserTurn) {
			const expected = userMoveByFen.get(key);
			if (!expected) break; // position not in repertoire — stop
			if (expected !== move.san) break; // user deviated — stop
			depth++;
		} else {
			const prepared = opponentMovesByFen.get(key);
			if (!prepared) break; // position not in repertoire — stop
			if (!prepared.has(move.san)) break; // opponent surprise — stop
			depth++;
		}
	}

	return depth;
}

// ─── parsePgn ─────────────────────────────────────────────────────────────────

/**
 * Parse a raw PGN string into a structured game object.
 * Throws a descriptive Error if the PGN is malformed or unsupported.
 */
export function parsePgn(rawPgn: string): ParsedGame {
	const pgn = rawPgn.trim();
	if (!pgn) throw new Error('PGN is empty');

	// Reject custom starting positions. The FEN-based repertoire lookup assumes
	// games start from the standard initial position — non-standard starts would
	// make every ply appear "beyond the repertoire".
	if (/\[\s*SetUp\s+"1"\s*\]/i.test(pgn)) {
		throw new Error(
			'Custom starting positions are not supported — only standard games can be reviewed'
		);
	}

	// chess.js reads only one game, so a pasted file of several would fail
	// with a generic parse error; say what's actually wrong instead.
	if (countPgnGames(pgn) > 1) {
		throw new Error('This PGN holds several games — paste one game at a time');
	}

	const chess = new Chess();
	try {
		chess.loadPgn(pgn);
	} catch {
		throw new Error('Invalid PGN — could not parse game');
	}

	const verboseMoves = chess.history({ verbose: true });
	if (verboseMoves.length === 0) {
		throw new Error('PGN contains no moves');
	}

	return {
		pgn,
		moves: verboseMoves.map((m) => ({
			san: m.san,
			before: m.before,
			after: m.after,
			from: m.from,
			to: m.to
		})),
		headers: chess.header() as Record<string, string>
	};
}

// ─── analyzeGame ──────────────────────────────────────────────────────────────

/**
 * Walk a parsed game against the user's repertoire and classify each ply.
 *
 * Stop conditions:
 *   - After DEVIATION or BEYOND_REPERTOIRE: stop immediately (everything after
 *     is off-book noise).
 *   - After OPPONENT_SURPRISE: check the user's next move, then stop. The next
 *     user move may itself be a DEVIATION or BEYOND_REPERTOIRE.
 *
 * Navigation data (fenHistory, sanHistory, etc.) is built from ALL game moves
 * so the review board can navigate the full game regardless of analysis cutoff.
 */
export function analyzeGame(
	parsed: ParsedGame,
	repertoireMoves: RepertoireMoveRow[],
	repertoireColor: 'WHITE' | 'BLACK'
): GameAnalysis {
	// Build lookup maps for O(1) repertoire checks.
	//   userMoveByFen: positions where it's the user's turn (one move per position).
	//   opponentMovesByFen: positions where it's the opponent's turn (multiple allowed).
	const userMoveByFen = new Map<string, { san: string; toFen: string }>();
	const opponentMovesByFen = new Map<string, Set<string>>();

	for (const rm of repertoireMoves) {
		const key = fenKey(rm.fromFen);
		// Determine whose turn it is from the FEN's active color field (cheaper than
		// constructing a full Chess instance for each row).
		const fenTurn = rm.fromFen.split(' ')[1]; // 'w' or 'b'
		const isUserTurn =
			(repertoireColor === 'WHITE' && fenTurn === 'w') ||
			(repertoireColor === 'BLACK' && fenTurn === 'b');

		if (isUserTurn) {
			userMoveByFen.set(key, { san: rm.san, toFen: rm.toFen });
		} else {
			if (!opponentMovesByFen.has(key)) opponentMovesByFen.set(key, new Set());
			opponentMovesByFen.get(key)!.add(rm.san);
		}
	}

	// Build full navigation data from ALL game moves (before the analysis loop)
	// so users can navigate the complete game even if analysis stops early.
	const fenHistory: string[] = [STARTING_FEN];
	const sanHistory: string[] = [];
	const fromSquares: string[] = [];
	const toSquares: string[] = [];

	for (const m of parsed.moves) {
		fenHistory.push(m.after);
		sanHistory.push(m.san);
		fromSquares.push(m.from);
		toSquares.push(m.to);
	}

	// Walk the game and classify each ply.
	const issues: GameIssue[] = [];
	let firstDeviationFen: string | null = null;
	// After OPPONENT_SURPRISE: allow one more user-turn ply to be checked before stopping.
	let stopAfterNextUserMove = false;

	for (let i = 0; i < parsed.moves.length; i++) {
		const move = parsed.moves[i];
		const fromFen = fenKey(move.before);
		const toFen = fenKey(move.after);
		const san = move.san;
		const ply = i + 1;

		// Determine whose turn it is from the FEN active color field.
		const fenTurn = fromFen.split(' ')[1]; // 'w' or 'b'
		const isUserTurn =
			(repertoireColor === 'WHITE' && fenTurn === 'w') ||
			(repertoireColor === 'BLACK' && fenTurn === 'b');

		const fromKey = fenKey(fromFen);

		if (isUserTurn) {
			const expected = userMoveByFen.get(fromKey);

			if (!expected) {
				// After an OPPONENT_SURPRISE the user's response position is never in
				// the repertoire (by definition — we hadn't prepared for that line).
				// Skip the BEYOND_REPERTOIRE issue here: the OPPONENT_SURPRISE card
				// already captured userResponseSan and handles adding the response in
				// phase 2. Creating a second card for the same move is redundant and
				// confusing.
				if (stopAfterNextUserMove) break;

				// Case 2: user played from a position not in their repertoire at all.
				issues.push({
					type: 'BEYOND_REPERTOIRE',
					ply,
					fromFen,
					toFen,
					playedSan: san,
					repertoireSan: null,
					userResponseSan: null,
					userResponseToFen: null
				});
				if (!firstDeviationFen) firstDeviationFen = fromFen;
				break; // off-book from here — stop
			}

			if (expected.san !== san) {
				// Case 1: user played a different move than their repertoire.
				issues.push({
					type: 'DEVIATION',
					ply,
					fromFen,
					toFen,
					playedSan: san,
					repertoireSan: expected.san,
					userResponseSan: null,
					userResponseToFen: null
				});
				if (!firstDeviationFen) firstDeviationFen = fromFen;
				break; // deviated — stop
			}

			// User played their repertoire move exactly — no issue.
			// If this is the user move after an opponent surprise, stop now.
			if (stopAfterNextUserMove) break;
		} else {
			// Opponent's move.
			const preparedMoves = opponentMovesByFen.get(fromKey);

			if (!preparedMoves || !preparedMoves.has(san)) {
				// Case 3: opponent played a move the user hasn't prepared for.
				// Peek ahead to capture what the user played in response.
				const nextMove = parsed.moves[i + 1];
				const userResponseSan = nextMove ? nextMove.san : null;
				const userResponseToFen = nextMove ? fenKey(nextMove.after) : null;

				issues.push({
					type: 'OPPONENT_SURPRISE',
					ply,
					fromFen,
					toFen,
					playedSan: san,
					repertoireSan: null,
					userResponseSan,
					userResponseToFen
				});
				if (!firstDeviationFen) firstDeviationFen = fromFen;

				// Continue to check the user's next move (it may be a DEVIATION or
				// BEYOND_REPERTOIRE). The flag ensures we stop after that one check.
				stopAfterNextUserMove = true;
			}
			// Opponent played a prepared move — no issue, continue.
		}
	}

	return { issues, firstDeviationFen, fenHistory, sanHistory, fromSquares, toSquares };
}
