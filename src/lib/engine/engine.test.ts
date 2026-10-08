import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineWorker } from './engine';

// A fake Stockfish worker. `script` decides what the engine "prints" for each
// command; replies arrive asynchronously, like a real worker's messages.
class FakeWorker implements EngineWorker {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	received: string[] = [];
	terminated = false;

	constructor(
		public url: string,
		private script: (command: string, worker: FakeWorker) => string[]
	) {}

	postMessage(command: string) {
		this.received.push(command);
		for (const line of this.script(command, this)) this.emit(line);
	}

	emit(line: string) {
		queueMicrotask(() => this.onmessage?.({ data: line }));
	}

	terminate() {
		this.terminated = true;
	}
}

// Answers the handshake, and replies to "go" with two depths of two
// variations and a bestmove, unless `hold` is set (then only "stop" ends it).
function stockfishScript(opts: { hold?: boolean } = {}) {
	return (command: string): string[] => {
		if (command === 'uci') return ['id name Stockfish 19 Lite WASM', 'uciok'];
		if (command === 'isready') return ['readyok'];
		if (command.startsWith('go')) {
			const lines = [
				'info depth 1 multipv 1 score cp 30 nodes 20 pv e2e4',
				'info depth 1 multipv 2 score cp 20 nodes 20 pv d2d4',
				'info depth 2 multipv 1 score cp 35 nodes 90 pv d2d4 d7d5',
				'info depth 2 multipv 2 score cp 31 nodes 90 pv e2e4 e7e5'
			];
			return opts.hold ? lines : [...lines, 'bestmove d2d4 ponder d7d5'];
		}
		if (command === 'stop') return ['bestmove e2e4'];
		return [];
	};
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function setup(
	script: (command: string, worker: FakeWorker) => string[] = stockfishScript(),
	config: { multiThreaded?: boolean; threads?: number; onThreadedFailure?: () => void } = {}
) {
	const workers: FakeWorker[] = [];
	const engine = createEngine({
		createWorker: (url) => {
			const w = new FakeWorker(url, script);
			workers.push(w);
			return w;
		},
		multiThreaded: config.multiThreaded ?? false,
		threads: config.threads ?? 1,
		onThreadedFailure: config.onThreadedFailure
	});
	return { engine, workers };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('createEngine', () => {
	it('reports each completed depth and resolves with the final result', async () => {
		const { engine, workers } = setup();
		const updates: number[] = [];
		const result = await engine.analyse({
			fen: START,
			depth: 2,
			numMoves: 2,
			timeoutMs: 5000,
			onUpdate: (u) => updates.push(u.depth)
		});

		expect(updates).toEqual([1, 2]);
		expect(result).toEqual({
			available: true,
			depth: 2,
			done: true,
			moves: [
				{ uci: 'd2d4', scoreCp: 35, scoreMate: null },
				{ uci: 'e2e4', scoreCp: 31, scoreMate: null }
			]
		});
		expect(workers[0].received).toEqual([
			'uci',
			'isready',
			'setoption name MultiPV value 2',
			'isready',
			`position fen ${START}`,
			'go depth 2'
		]);
	});

	it('uses the single-threaded build unless the page is cross-origin isolated', async () => {
		const single = setup();
		await single.engine.analyse({ fen: START, depth: 1, numMoves: 1, timeoutMs: 5000 });
		expect(single.workers[0].url).toBe('/engine/stockfish-19-lite-single.js');
		expect(single.workers[0].received.some((c) => c.includes('Threads'))).toBe(false);

		const multi = setup(stockfishScript(), { multiThreaded: true, threads: 4 });
		await multi.engine.analyse({ fen: START, depth: 1, numMoves: 1, timeoutMs: 5000 });
		expect(multi.workers[0].url).toBe('/engine/stockfish-19-lite.js');
		expect(multi.workers[0].received).toContain('setoption name Threads value 4');
	});

	it('falls back to the single-threaded build when the threaded one fails to start', async () => {
		const script = stockfishScript();
		const onThreadedFailure = vi.fn();
		const { engine, workers } = setup(
			(command, worker) => {
				// The threaded build dies on startup, as it does in Firefox.
				if (worker.url.endsWith('stockfish-19-lite.js')) {
					queueMicrotask(() => worker.onerror?.(new Error('no shared memory')));
					return [];
				}
				return script(command);
			},
			{ multiThreaded: true, threads: 4, onThreadedFailure }
		);
		const result = await engine.analyse({ fen: START, depth: 2, numMoves: 2, timeoutMs: 5000 });
		expect(onThreadedFailure).toHaveBeenCalledOnce();

		expect(result).toMatchObject({ available: true, depth: 2 });
		expect(workers.map((w) => w.url)).toEqual([
			'/engine/stockfish-19-lite.js',
			'/engine/stockfish-19-lite-single.js'
		]);
		expect(workers[0].terminated).toBe(true);
		expect(workers[1].received.some((c) => c.includes('Threads'))).toBe(false);

		// A later reload (after a stuck worker, say) goes straight to the single build.
		engine.destroy();
		await engine.analyse({ fen: START, depth: 1, numMoves: 1, timeoutMs: 5000 });
		expect(workers.map((w) => w.url).slice(2)).toEqual(['/engine/stockfish-19-lite-single.js']);
	});

	it('waits for slow search threads to start instead of reporting no engine', async () => {
		vi.useFakeTimers();
		const script = stockfishScript();
		let threadsSet = false;
		const onThreadedFailure = vi.fn();
		const { engine, workers } = setup(
			(command, worker) => {
				if (command.startsWith('setoption name Threads')) threadsSet = true;
				// Starting the threads takes longer than an analysis waits for readyok.
				if (command === 'isready' && threadsSet) {
					threadsSet = false;
					setTimeout(() => worker.emit('readyok'), 8000);
					return [];
				}
				return script(command);
			},
			{ multiThreaded: true, threads: 4, onThreadedFailure }
		);
		const pending = engine.analyse({ fen: START, depth: 2, numMoves: 2, timeoutMs: 5000 });
		await vi.advanceTimersByTimeAsync(8000);

		expect(await pending).toMatchObject({ available: true, depth: 2 });
		expect(workers.map((w) => w.url)).toEqual(['/engine/stockfish-19-lite.js']);
		expect(onThreadedFailure).not.toHaveBeenCalled();
	});

	it('loads the worker once for many analyses', async () => {
		const { engine, workers } = setup();
		await engine.analyse({ fen: START, depth: 1, numMoves: 1, timeoutMs: 5000 });
		await engine.analyse({ fen: START, depth: 1, numMoves: 1, timeoutMs: 5000 });
		expect(workers).toHaveLength(1);
		expect(workers[0].received.filter((c) => c === 'uci')).toHaveLength(1);
	});

	it('stops a cancelled search and runs the next one after it', async () => {
		const { engine, workers } = setup(stockfishScript({ hold: true }));
		const controller = new AbortController();
		const first = engine.analyse({
			fen: START,
			depth: 30,
			numMoves: 2,
			timeoutMs: 60_000,
			signal: controller.signal
		});
		const second = engine.analyse({ fen: START, depth: 30, numMoves: 1, timeoutMs: 60_000 });

		await vi.waitFor(() => expect(workers[0].received).toContain('go depth 30'));
		controller.abort();
		await first;

		// The second search starts only after the first one's bestmove.
		const received = workers[0].received;
		await vi.waitFor(() => expect(received.filter((c) => c === 'go depth 30')).toHaveLength(2));
		expect(received.indexOf('stop')).toBeLessThan(received.lastIndexOf('go depth 30'));

		workers[0].postMessage('stop');
		await second;
	});

	it('skips a search that was cancelled before it started', async () => {
		const { engine, workers } = setup();
		const controller = new AbortController();
		controller.abort();
		const result = await engine.analyse({
			fen: START,
			depth: 5,
			numMoves: 1,
			timeoutMs: 5000,
			signal: controller.signal
		});
		expect(result.moves).toEqual([]);
		expect(workers).toHaveLength(0);
	});

	it('stops at the timeout and returns the deepest complete result', async () => {
		vi.useFakeTimers();
		const { engine, workers } = setup(stockfishScript({ hold: true }));
		const pending = engine.analyse({ fen: START, depth: 30, numMoves: 2, timeoutMs: 1000 });

		await vi.advanceTimersByTimeAsync(1000);
		const result = await pending;
		expect(workers[0].received).toContain('stop');
		expect(result.depth).toBe(2);
		expect(result.moves[0].uci).toBe('d2d4');
	});

	it('reports the engine as unavailable when it never loads', async () => {
		vi.useFakeTimers();
		const { engine, workers } = setup(() => []);
		const pending = engine.analyse({ fen: START, depth: 5, numMoves: 1, timeoutMs: 1000 });

		await vi.advanceTimersByTimeAsync(30_000);
		expect(await pending).toMatchObject({ available: false, moves: [] });
		expect(workers[0].terminated).toBe(true);
	});

	it('reports the engine as unavailable when the worker cannot be created', async () => {
		const engine = createEngine({
			createWorker: () => {
				throw new Error('Workers are not supported');
			},
			multiThreaded: false,
			threads: 1
		});
		expect(
			await engine.analyse({ fen: START, depth: 5, numMoves: 1, timeoutMs: 1000 })
		).toMatchObject({ available: false });
	});

	it('replaces a worker that ignores stop', async () => {
		vi.useFakeTimers();
		const script = stockfishScript({ hold: true });
		const { engine, workers } = setup((command) => (command === 'stop' ? [] : script(command)));
		const pending = engine.analyse({ fen: START, depth: 30, numMoves: 1, timeoutMs: 1000 });
		await vi.advanceTimersByTimeAsync(1000 + 3000);
		await pending;
		expect(workers[0].terminated).toBe(true);

		const next = engine.analyse({ fen: START, depth: 30, numMoves: 1, timeoutMs: 1000 });
		await vi.advanceTimersByTimeAsync(1000 + 3000);
		await next;
		expect(workers).toHaveLength(2);
	});
});
