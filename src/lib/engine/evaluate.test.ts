import { describe, expect, it, vi } from 'vitest';
import type { AnalyseOptions, AnalyseResult } from './engine';
import { evaluateGame, evaluatePosition, GAME_EVAL_DEPTH } from './evaluate';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

// A fake engine: the best move and side-to-move score for each position.
function fakeEngine(answers: Record<string, { uci: string; cp: number }>, available = true) {
	const analyse = vi.fn(async (options: AnalyseOptions): Promise<AnalyseResult> => {
		const answer = answers[options.fen];
		return {
			available,
			done: true,
			depth: options.depth,
			moves: answer ? [{ uci: answer.uci, scoreCp: answer.cp, scoreMate: null }] : []
		};
	});
	return { analyse };
}

describe('evaluatePosition', () => {
	it("returns the best move's score from White's perspective", async () => {
		const engine = fakeEngine({ [AFTER_E4]: { uci: 'c7c5', cp: -30 } });
		expect(await evaluatePosition(engine, AFTER_E4, { depth: 20, timeoutMs: 1000 })).toEqual({
			evalCp: 30,
			evalMate: null
		});
		expect(engine.analyse).toHaveBeenCalledWith(
			expect.objectContaining({ fen: AFTER_E4, numMoves: 1, depth: 20, timeoutMs: 1000 })
		);
	});

	it('returns null when the engine has no answer', async () => {
		expect(await evaluatePosition(fakeEngine({}), START, { depth: 20, timeoutMs: 1000 })).toBe(
			null
		);
	});
});

describe('evaluateGame', () => {
	it('reports every position in order, with nulls where there is no score', async () => {
		const engine = fakeEngine({ [START]: { uci: 'e2e4', cp: 25 } });
		const scores: unknown[] = [];
		await evaluateGame(engine, [START, AFTER_E4], (i, s) => scores.push([i, s]));
		expect(scores).toEqual([
			[0, { evalCp: 25, evalMate: null }],
			[1, { evalCp: null, evalMate: null }]
		]);
		expect(engine.analyse.mock.calls[0][0].depth).toBe(GAME_EVAL_DEPTH);
	});

	it('reports nothing when the engine is unavailable', async () => {
		const engine = fakeEngine({ [START]: { uci: 'e2e4', cp: 25 } }, false);
		const onScore = vi.fn();
		await evaluateGame(engine, [START, AFTER_E4], onScore);
		expect(onScore).not.toHaveBeenCalled();
		expect(engine.analyse).toHaveBeenCalledTimes(1);
	});

	it('stops when cancelled', async () => {
		const controller = new AbortController();
		const engine = fakeEngine({ [START]: { uci: 'e2e4', cp: 25 } });
		const scores: number[] = [];
		await evaluateGame(
			engine,
			[START, START, START],
			(i) => {
				scores.push(i);
				controller.abort();
			},
			controller.signal
		);
		expect(scores).toEqual([0]);
	});
});
