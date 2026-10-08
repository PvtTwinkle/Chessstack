// Test helper: build a GameAnalysis from a list of SAN moves, the same shape
// the analyzeGame action returns, with the issues spelled out by the test.

import { Chess } from 'chess.js';
import type { GameAnalysis, GameIssue, IssueType } from '$lib/pgn';

export function gameAnalysis(
	sans: string[],
	issues: { type: IssueType; ply: number; repertoireSan?: string }[] = []
): GameAnalysis {
	const chess = new Chess();
	const fenHistory = [chess.fen()];
	const fromSquares: string[] = [];
	const toSquares: string[] = [];
	for (const san of sans) {
		const move = chess.move(san);
		fenHistory.push(chess.fen());
		fromSquares.push(move.from);
		toSquares.push(move.to);
	}

	const fullIssues: GameIssue[] = issues.map(({ type, ply, repertoireSan }) => ({
		type,
		ply,
		fromFen: fenHistory[ply - 1],
		toFen: fenHistory[ply],
		playedSan: sans[ply - 1],
		repertoireSan: repertoireSan ?? null,
		userResponseSan: type === 'OPPONENT_SURPRISE' ? (sans[ply] ?? null) : null,
		userResponseToFen: type === 'OPPONENT_SURPRISE' ? (fenHistory[ply + 1] ?? null) : null
	}));

	return {
		issues: fullIssues,
		firstDeviationFen: fullIssues[0]?.fromFen ?? null,
		fenHistory,
		sanHistory: sans,
		fromSquares,
		toSquares
	};
}
