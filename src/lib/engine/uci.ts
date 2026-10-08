// Parsing Stockfish's UCI output into candidate-move snapshots.
//
// Shared by the in-browser engine (engine.ts). Pure functions, so they can be
// unit-tested without a worker.

export interface EngineMove {
	// The move in UCI notation, e.g. "e2e4" or "e7e8q".
	uci: string;
	// Centipawns from the side to move's perspective; null for a mate score.
	scoreCp: number | null;
	// Moves to mate from the side to move's perspective; null for a cp score.
	scoreMate: number | null;
}

// Engine analysis at one search depth.
export interface EngineUpdate {
	depth: number;
	// One entry per principal variation, best first.
	moves: EngineMove[];
	// true once the search has finished (bestmove, timeout or cancellation).
	done: boolean;
}

export interface InfoLine extends EngineMove {
	depth: number;
	multipv: number;
}

// Parses an "info" line that carries a principal variation, e.g.
//   info depth 15 seldepth 22 multipv 1 score cp 45 nodes 1234 pv e2e4 e7e5 ...
// Returns null for every other line (progress lines, "info string", etc.).
export function parseInfoLine(line: string): InfoLine | null {
	if (!line.startsWith('info') || !line.includes(' pv ')) return null;
	const depthMatch = line.match(/ depth (\d+)/);
	const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
	if (!depthMatch || !pvMatch) return null;

	const multipvMatch = line.match(/ multipv (\d+)/);
	const cpMatch = line.match(/ score cp (-?\d+)/);
	const mateMatch = line.match(/ score mate (-?\d+)/);
	return {
		depth: parseInt(depthMatch[1], 10),
		multipv: multipvMatch ? parseInt(multipvMatch[1], 10) : 1,
		uci: pvMatch[1],
		scoreCp: cpMatch ? parseInt(cpMatch[1], 10) : null,
		scoreMate: mateMatch ? parseInt(mateMatch[1], 10) : null
	};
}

// Collects info lines for one search and reports a snapshot each time a
// deeper depth is complete. Stockfish prints multipv 1..N in order at each
// depth, so a depth is complete when line N arrives.
export function createCollector(numMoves: number) {
	const latest = new Map<number, EngineMove>();
	let lastDepth = 0;

	const sorted = () => [...latest.entries()].sort(([a], [b]) => a - b).map(([, move]) => move);

	return {
		// Feeds one output line; returns a snapshot when a new depth completes.
		push(line: string): EngineUpdate | null {
			const info = parseInfoLine(line);
			if (!info || info.multipv > numMoves) return null;
			latest.set(info.multipv, {
				uci: info.uci,
				scoreCp: info.scoreCp,
				scoreMate: info.scoreMate
			});
			if (info.multipv === numMoves && info.depth > lastDepth) {
				lastDepth = info.depth;
				return { depth: lastDepth, moves: sorted(), done: false };
			}
			return null;
		},
		// The final result, with whatever has arrived so far.
		finish(): EngineUpdate {
			return { depth: lastDepth, moves: sorted(), done: true };
		}
	};
}
