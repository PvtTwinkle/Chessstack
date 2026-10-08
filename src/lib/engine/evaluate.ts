// Single-number evaluations on top of the engine: one position, or every
// position of a game (Review's accuracy chart and move colours).

import { toCandidates } from './candidates';
import type { Engine } from './engine';

export interface PositionScore {
	// Centipawns from White's perspective; null for a mate score.
	evalCp: number | null;
	// Moves to mate from White's perspective (negative = Black mates).
	evalMate: number | null;
}

type Analyser = Pick<Engine, 'analyse'>;

export interface EvaluateOptions {
	depth: number;
	timeoutMs: number;
	signal?: AbortSignal;
}

// The engine's score for `fen`, or null when there is none (no legal moves,
// engine unavailable, cancelled).
export async function evaluatePosition(
	engine: Analyser,
	fen: string,
	options: EvaluateOptions
): Promise<PositionScore | null> {
	const result = await engine.analyse({ fen, numMoves: 1, ...options });
	const [best] = toCandidates(fen, result.moves);
	return best ? { evalCp: best.evalCp, evalMate: best.evalMate } : null;
}

// Whole-game evaluation is only used to sort moves into a few accuracy
// buckets, so it searches shallower than the interactive analysis, and caps
// each position so one hard position can't stall the game.
export const GAME_EVAL_DEPTH = 14;
export const GAME_EVAL_TIMEOUT_MS = 5_000;

// Evaluates each position in order, reporting each score as it arrives.
// Positions without a score are reported as nulls so progress still advances.
// Stops early when `signal` is aborted or the engine can't run in this browser.
export async function evaluateGame(
	engine: Analyser,
	fens: readonly string[],
	onScore: (index: number, score: PositionScore) => void,
	signal?: AbortSignal
): Promise<void> {
	for (let i = 0; i < fens.length; i++) {
		if (signal?.aborted) return;
		const result = await engine.analyse({
			fen: fens[i],
			numMoves: 1,
			depth: GAME_EVAL_DEPTH,
			timeoutMs: GAME_EVAL_TIMEOUT_MS,
			signal
		});
		if (signal?.aborted || !result.available) return;
		const [best] = toCandidates(fens[i], result.moves);
		onScore(i, { evalCp: best?.evalCp ?? null, evalMate: best?.evalMate ?? null });
	}
}
