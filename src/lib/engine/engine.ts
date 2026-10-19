// In-browser Stockfish.
//
// One Web Worker runs the WebAssembly engine for the whole tab; analysis
// requests queue up and run one at a time, because a UCI engine can only
// search one position at once. Cancelling a request (its AbortSignal) stops
// the search early, so moving through a line never waits for stale analysis.
//
// The multi-threaded build needs SharedArrayBuffer, which browsers only allow
// on cross-origin isolated pages (see the COOP/COEP headers in
// hooks.server.ts). Anywhere else the single-threaded build is used.

import { createCollector, type EngineUpdate } from './uci';

export type { EngineMove, EngineUpdate } from './uci';

const MULTI_THREADED_URL = '/engine/stockfish-19-lite.js';
const SINGLE_THREADED_URL = '/engine/stockfish-19-lite-single.js';

// Loading includes downloading and compiling ~1.7 MB of WebAssembly on the
// first visit, so allow for a slow connection.
const LOAD_TIMEOUT_MS = 30_000;
// After "stop", Stockfish answers with bestmove almost at once. If it doesn't,
// the worker is stuck and gets replaced.
const STOP_GRACE_MS = 3_000;
// What the worker's onerror feeds the line listener, so a crash ends whatever
// is waiting on output.
const ERROR_LINE = '__error__';

export interface AnalyseOptions {
	fen: string;
	depth: number;
	// Number of candidate moves (MultiPV).
	numMoves: number;
	// Returns the best result so far once this much time has passed.
	timeoutMs: number;
	signal?: AbortSignal;
	// Called each time a deeper depth completes.
	onUpdate?: (update: EngineUpdate) => void;
}

export interface AnalyseResult extends EngineUpdate {
	// false when the engine could not be loaded in this browser.
	available: boolean;
}

// The parts of a Worker the engine uses; tests pass a fake.
export interface EngineWorker {
	postMessage(message: string): void;
	terminate(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export interface EngineConfig {
	createWorker: (url: string) => EngineWorker;
	// Whether the page is cross-origin isolated (multi-threaded build allowed).
	multiThreaded: boolean;
	// Search threads for the multi-threaded build.
	threads: number;
	// Called when the multi-threaded build failed and the engine fell back.
	onThreadedFailure?: () => void;
}

export function createEngine(config: EngineConfig) {
	let worker: EngineWorker | null = null;
	let ready: Promise<boolean> | null = null;
	// Receives every output line of the current worker.
	let listener: ((line: string) => void) | null = null;
	// Requests run strictly one after another on this chain.
	let queue: Promise<unknown> = Promise.resolve();
	let multiThreaded = config.multiThreaded;

	function send(command: string) {
		worker?.postMessage(command);
	}

	// Resolves with the first output line that satisfies `test`, or null after
	// `timeoutMs`.
	function waitFor(test: (line: string) => boolean, timeoutMs: number): Promise<string | null> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				listener = null;
				resolve(null);
			}, timeoutMs);
			listener = (line) => {
				if (!test(line)) return;
				clearTimeout(timer);
				listener = null;
				resolve(line);
			};
		});
	}

	// Stops the current worker without forgetting how the engine was loaded.
	function discard() {
		worker?.terminate();
		worker = null;
		listener = null;
	}

	function reset() {
		discard();
		ready = null;
	}

	// Starts a worker on `url` and completes the UCI handshake. Resolves false
	// when it can't run (blocked download, load error, load timeout).
	async function start(url: string, threads: number | null): Promise<boolean> {
		try {
			worker = config.createWorker(url);
		} catch {
			return false;
		}
		worker.onmessage = (event) => {
			// The worker posts one line per message, but be safe.
			for (const line of String(event.data).split('\n')) listener?.(line);
		};
		let failed = false;
		worker.onerror = () => {
			failed = true;
			listener?.(ERROR_LINE);
		};

		const uciok = waitFor((l) => l === 'uciok' || l === ERROR_LINE, LOAD_TIMEOUT_MS);
		send('uci');
		if ((await uciok) !== 'uciok' || failed) {
			discard();
			return false;
		}
		// Setting Threads starts the search threads, each its own worker. In
		// Firefox that can take several seconds, longer than an analysis waits
		// for readyok, so wait for them here with the load timeout instead.
		if (threads !== null) send(`setoption name Threads value ${threads}`);
		const readyok = waitFor((l) => l === 'readyok' || l === ERROR_LINE, LOAD_TIMEOUT_MS);
		send('isready');
		if ((await readyok) !== 'readyok' || failed) {
			discard();
			return false;
		}
		return true;
	}

	// Loads the engine once. A browser can report cross-origin isolation and
	// still fail to start the threaded build (Firefox does), so a failed
	// multi-threaded start falls back to the single-threaded build for good.
	function load(): Promise<boolean> {
		if (ready) return ready;
		ready = (async () => {
			if (multiThreaded) {
				if (await start(MULTI_THREADED_URL, config.threads)) return true;
				multiThreaded = false;
				config.onThreadedFailure?.();
			}
			if (await start(SINGLE_THREADED_URL, null)) return true;
			// Try again from scratch on the next analysis.
			ready = null;
			return false;
		})();
		return ready;
	}

	async function run(options: AnalyseOptions): Promise<AnalyseResult> {
		const { fen, depth, numMoves, timeoutMs, signal, onUpdate } = options;
		const empty: AnalyseResult = { depth: 0, moves: [], done: true, available: true };
		if (signal?.aborted) return empty;

		if (!(await load())) return { ...empty, available: false };
		if (signal?.aborted) return empty;

		// isready makes sure the option is applied (and any earlier search has
		// fully ended) before the new search starts.
		send(`setoption name MultiPV value ${numMoves}`);
		const readyok = waitFor((l) => l === 'readyok' || l === ERROR_LINE, STOP_GRACE_MS);
		send('isready');
		if ((await readyok) !== 'readyok') {
			reset();
			return { ...empty, available: false };
		}

		const collector = createCollector(numMoves);
		let stopped = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			send('stop');
		};

		// 'done' when bestmove arrived, 'stuck' when the stop went unanswered,
		// 'crashed' when the worker died mid-search.
		const finished = new Promise<'done' | 'stuck' | 'crashed'>((resolve) => {
			let stopTimer: ReturnType<typeof setTimeout> | undefined;
			// Every way out goes through here, so no timer or abort listener
			// outlives the search and fires against a worker that was replaced.
			const settle = (outcome: 'done' | 'stuck' | 'crashed') => {
				clearTimeout(timer);
				clearTimeout(stopTimer);
				signal?.removeEventListener('abort', graceThenGiveUp);
				listener = null;
				resolve(outcome);
			};
			const graceThenGiveUp = () => {
				stop();
				// Give the engine a moment to answer the stop.
				stopTimer ??= setTimeout(() => settle('stuck'), STOP_GRACE_MS);
			};
			const timer = setTimeout(graceThenGiveUp, timeoutMs);
			signal?.addEventListener('abort', graceThenGiveUp, { once: true });

			listener = (line) => {
				if (line === ERROR_LINE) return settle('crashed');
				if (line.startsWith('bestmove')) return settle('done');
				const update = collector.push(line);
				if (update && !signal?.aborted) onUpdate?.(update);
			};
		});

		send(`position fen ${fen}`);
		send(`go depth ${depth}`);

		const outcome = await finished;
		if (outcome !== 'done') {
			// The worker is stuck or dead. Start fresh next time.
			reset();
		}
		// A crashed worker can't be trusted for what it printed before dying, and
		// "no suggestions" would be the wrong message for a dead engine.
		if (outcome === 'crashed') return { ...empty, available: false };
		return { ...collector.finish(), available: true };
	}

	return {
		// Queues an analysis and resolves with its final result.
		analyse(options: AnalyseOptions): Promise<AnalyseResult> {
			const result = queue.then(() => run(options));
			queue = result.catch(() => undefined);
			return result;
		},
		// Starts loading the engine ahead of the first analysis.
		preload(): void {
			void load();
		},
		destroy(): void {
			reset();
		}
	};
}

export type Engine = ReturnType<typeof createEngine>;

let shared: Engine | null = null;

// Remembers in this browser that the threaded build failed, so later visits
// start the single-threaded build straight away instead of waiting for the
// threaded one to fail again (which can take the whole load timeout). The
// stored value is the build's file name, so a new engine version gets
// another try.
const THREADS_FAILED_KEY = 'engine-threads-failed';

function threadsFailedBefore(): boolean {
	try {
		return localStorage.getItem(THREADS_FAILED_KEY) === MULTI_THREADED_URL;
	} catch {
		return false;
	}
}

/**
 * Which build to start. The threaded build is only worth its extra download
 * and worker start-up when it gets more than one search thread.
 */
export function chooseBuild(opts: {
	crossOriginIsolated: boolean;
	cores: number;
	threadsFailedBefore: boolean;
}): { multiThreaded: boolean; threads: number } {
	// Half the cores, at most 4, so phones don't heat up.
	const threads = Math.min(4, Math.max(1, Math.floor(opts.cores / 2)));
	return {
		multiThreaded: opts.crossOriginIsolated && threads > 1 && !opts.threadsFailedBefore,
		threads
	};
}

// The tab's engine, created on first use.
export function getEngine(): Engine {
	if (!shared) {
		const build = chooseBuild({
			crossOriginIsolated: globalThis.crossOriginIsolated === true,
			cores: navigator.hardwareConcurrency || 2,
			threadsFailedBefore: threadsFailedBefore()
		});
		shared = createEngine({
			createWorker: (url) => {
				const worker = new Worker(url);
				const adapter: EngineWorker = {
					postMessage: (message) => worker.postMessage(message),
					terminate: () => worker.terminate(),
					onmessage: null,
					onerror: null
				};
				worker.onmessage = (event) => adapter.onmessage?.(event);
				worker.onerror = (event) => adapter.onerror?.(event);
				return adapter;
			},
			...build,
			onThreadedFailure: () => {
				try {
					localStorage.setItem(THREADS_FAILED_KEY, MULTI_THREADED_URL);
				} catch {
					// Private browsing can block storage; the fallback still works.
				}
			}
		});
	}
	return shared;
}
