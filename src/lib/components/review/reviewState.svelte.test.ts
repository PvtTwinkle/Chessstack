import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameAnalysis } from '$lib/test/review-game';
import type { GameAnalysis } from '$lib/pgn';
import { Chess } from 'chess.js';
import type { AnalyseOptions, AnalyseResult } from '$lib/engine/engine';
import { createReviewState, type ReviewState } from './reviewState.svelte';

vi.mock('$lib/sounds', () => ({ playMove: vi.fn(), playCapture: vi.fn() }));
const invalidateAll = vi.fn();
vi.mock('$app/navigation', () => ({ invalidateAll }));

// 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 — White is the reviewing player.
const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'];
const ACTIVE_REPERTOIRE = 7;

// ── fetch stub ──────────────────────────────────────────────────────────────
// Routes requests by path. Each test overrides the routes it cares about; the
// background engine calls get harmless defaults.

type Route = (body: Record<string, unknown>) => Response | Promise<Response>;
let routes: Record<string, Route>;
let calls: { path: string; body: Record<string, unknown> }[];

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status });
}

beforeEach(() => {
	calls = [];
	routes = {
		'/api/review/add-move': () => json({ ok: true }),
		'/api/review/fail-card': () => json({ ok: true })
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = url.split('?')[0];
			const body = init?.body ? JSON.parse(init.body as string) : {};
			calls.push({ path, body });
			const route = routes[path];
			if (!route) throw new Error(`Unexpected fetch: ${url}`);
			return route(body);
		})
	);
});

// ── engine stub ─────────────────────────────────────────────────────────────
// White-perspective centipawn scores by FEN. With no scores set the engine
// reports itself unavailable, so the background game evaluation stays idle.

let engineScores: Map<string, number>;
const engine = {
	analyse: vi.fn(async ({ fen }: AnalyseOptions): Promise<AnalyseResult> => {
		const cp = engineScores.get(fen);
		if (engineScores.size === 0) return { available: false, done: true, depth: 0, moves: [] };
		if (cp === undefined) return { available: true, done: true, depth: 0, moves: [] };
		const chess = new Chess(fen);
		const move = chess.moves({ verbose: true })[0];
		const sign = chess.turn() === 'w' ? 1 : -1;
		return {
			available: true,
			done: true,
			depth: 14,
			moves: [{ uci: move.from + move.to, scoreCp: cp * sign, scoreMate: null }]
		};
	})
};

beforeEach(() => {
	engineScores = new Map();
	engine.analyse.mockClear();
});

// ── state under test ────────────────────────────────────────────────────────

let cleanup: (() => void) | null = null;
let moves: { repertoireId: number; fromFen: string; san: string }[] = [];

function setup(): ReviewState {
	let s!: ReviewState;
	cleanup = $effect.root(() => {
		s = createReviewState({
			getRepertoireId: () => ACTIVE_REPERTOIRE,
			getMoves: () => moves,
			getPlaybackSpeed: () => 100,
			getEngineSettings: () => ({ depth: 20, timeoutMs: 10_000 }),
			engine
		});
	});
	return s;
}

// Load an analysis the way the analyzeGame form action returns it.
function load(s: ReviewState, analysis: GameAnalysis, extra: Record<string, unknown> = {}) {
	s.applyFormResult({
		analysis,
		parsedPgn: '1. e4 *',
		headers: { White: 'Me', Black: 'Them' },
		playerColor: 'WHITE',
		...extra
	});
	flushSync();
}

afterEach(() => {
	cleanup?.();
	cleanup = null;
	moves = [];
	vi.useRealTimers();
	vi.unstubAllGlobals();
	invalidateAll.mockClear();
});

describe('loading an analysis', () => {
	it('shows a form error on the input screen', () => {
		const s = setup();
		s.applyFormResult({ error: 'Invalid PGN' });
		expect(s.analysisError).toBe('Invalid PGN');
		expect(s.pageState).toBe('input');
	});

	it('switches to the analysis screen and keeps the server-picked repertoire', () => {
		const s = setup();
		load(s, gameAnalysis(ITALIAN), { repertoireId: 12, repertoireName: 'Italian' });
		expect(s.pageState).toBe('analysis');
		expect(s.overrideRepertoireId).toBe(12);
		expect(s.analysisRepName).toBe('Italian');
		expect(s.analysisHeaders).toEqual({ White: 'Me', Black: 'Them' });
		expect(s.orientation).toBe('white');
	});

	it('resets per-game state when a new analysis arrives', async () => {
		const s = setup();
		load(s, gameAnalysis(ITALIAN, [{ type: 'BEYOND_REPERTOIRE', ply: 5 }]));
		s.notes = 'old notes';
		s.resolveIssue(5);
		s.analysisError = 'stale';

		load(s, gameAnalysis(['d4'], [{ type: 'BEYOND_REPERTOIRE', ply: 1 }]));
		expect(s.notes).toBe('');
		expect(s.resolvedIssues.size).toBe(0);
		expect(s.analysisError).toBeNull();
		expect(s.currentPlyIdx).toBe(0);
	});

	it('auto-plays up to the first issue', () => {
		vi.useFakeTimers();
		const s = setup();
		load(s, gameAnalysis(ITALIAN, [{ type: 'BEYOND_REPERTOIRE', ply: 3 }]));
		expect(s.isAutoPlaying).toBe(true);

		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(100);
			flushSync();
		}
		expect(s.currentPlyIdx).toBe(3);
		expect(s.isAutoPlaying).toBe(false);
		expect(s.currentFen).toBe(gameAnalysis(ITALIAN).fenHistory[3]);
		expect(s.lastMove).toEqual(['g1', 'f3']);
	});

	it('auto-plays a clean game to the end', () => {
		vi.useFakeTimers();
		const s = setup();
		load(s, gameAnalysis(['e4', 'e5']));
		vi.advanceTimersByTime(100);
		flushSync();
		vi.advanceTimersByTime(100);
		flushSync();
		expect(s.currentPlyIdx).toBe(2);
		expect(s.isAutoPlaying).toBe(false);
	});

	it('fills positionEvals with an engine eval for every position', async () => {
		const game = gameAnalysis(['e4']);
		engineScores.set(game.fenHistory[0], 20);
		engineScores.set(game.fenHistory[1], 30);
		const s = setup();
		load(s, game);
		await vi.waitFor(() => expect(s.positionEvals.size).toBe(2));
		await vi.waitFor(() => expect(s.evalProgress).toBeNull());
		expect(s.positionEvals.get(1)).toEqual({ evalCp: 30, evalMate: null });
		expect(s.formatPositionEval(s.positionEvals.get(1)!)).toBe('(+0.3)');
	});

	it('evaluates both moves of a deviation', async () => {
		const game = gameAnalysis(
			['e4', 'e5', 'Bc4'],
			[{ type: 'DEVIATION', ply: 3, repertoireSan: 'Nf3' }]
		);
		const correct = new Chess(game.fenHistory[2]);
		correct.move('Nf3');
		engineScores.set(game.fenHistory[3], -40);
		engineScores.set(correct.fen(), 35);
		const s = setup();
		load(s, game);
		await vi.waitFor(() => expect(s.deviationEvals.get(3)).toEqual({ played: -40, correct: 35 }));
		expect(s.boardShapes).toEqual([]); // board is still at the start
		s.currentPlyIdx = 3;
		expect(s.boardShapes.map((shape) => shape.brush)).toEqual(['red', 'green']);
	});
});

describe('navigation', () => {
	it('steps forward and back within the game and stops auto-play', () => {
		vi.useFakeTimers();
		const s = setup();
		load(s, gameAnalysis(['e4', 'e5'], [{ type: 'BEYOND_REPERTOIRE', ply: 1 }]));
		s.goBack();
		flushSync(); // in the app, effects flush before the next timer fires
		expect(s.currentPlyIdx).toBe(0);
		expect(s.isAutoPlaying).toBe(false);
		vi.advanceTimersByTime(500);
		flushSync();
		expect(s.currentPlyIdx).toBe(0); // auto-play was cancelled

		s.goForward();
		s.goForward();
		s.goForward();
		expect(s.currentPlyIdx).toBe(2);
		expect(s.openingFenHistory).toHaveLength(2);
	});
});

describe('deviation actions', () => {
	const game = () =>
		gameAnalysis(['e4', 'e5', 'Bc4'], [{ type: 'DEVIATION', ply: 3, repertoireSan: 'Nf3' }]);

	it('fails the card against the active repertoire and resolves the issue', async () => {
		const s = setup();
		load(s, game());
		await s.handleFailCard(s.analysis!.issues[0]);
		expect(calls.find((c) => c.path === '/api/review/fail-card')?.body).toEqual({
			repertoireId: ACTIVE_REPERTOIRE,
			fromFen: game().fenHistory[2]
		});
		expect(s.resolvedIssues.has(3)).toBe(true);
		expect(s.actionLoading.get(3)).toBe(false);
	});

	it('shows the server error and leaves the issue open when an action fails', async () => {
		routes['/api/review/fail-card'] = () => new Response('Card not found', { status: 404 });
		const s = setup();
		load(s, game());
		await s.handleFailCard(s.analysis!.issues[0]);
		expect(s.actionError.get(3)).toBe('Card not found');
		expect(s.resolvedIssues.has(3)).toBe(false);
	});

	it('replaces the book move with the played move', async () => {
		const s = setup();
		load(s, game(), { repertoireId: 12 });
		await s.handleUpdateRepertoire(s.analysis!.issues[0]);
		const addMove = calls.find((c) => c.path === '/api/review/add-move');
		expect(addMove?.body).toEqual({
			repertoireId: 12,
			fromFen: game().fenHistory[2],
			san: 'Bc4',
			forceReplace: true
		});
		expect(s.resolvedIssues.has(3)).toBe(true);
	});

	it('loads the masters moves once, on first expand', async () => {
		let masterCalls = 0;
		routes['/api/masters'] = () => {
			masterCalls++;
			const moves = Array.from({ length: 7 }, (_, i) => ({
				san: `m${i}`,
				white: 1,
				draws: 1,
				black: 1,
				totalGames: 3
			}));
			return json({ moves });
		};
		const s = setup();
		load(s, game());
		const issue = s.analysis!.issues[0];
		s.toggleMasters(issue);
		await vi.waitFor(() => expect(s.deviationMasters.get(3)).toHaveLength(5));
		s.toggleMasters(issue);
		expect(s.deviationMastersExpanded.has(3)).toBe(false);
		s.toggleMasters(issue);
		expect(masterCalls).toBe(1);
	});
});

describe('building the repertoire along the game', () => {
	const game = () => gameAnalysis(ITALIAN, [{ type: 'BEYOND_REPERTOIRE', ply: 5 }]);

	it('offers the next opponent move after picking the move played in the game', async () => {
		const s = setup();
		load(s, game());
		await s.handlePickResponseMove(s.analysis!.issues[0], 'Bc4');

		expect(s.resolvedIssues.has(5)).toBe(false);
		expect(s.currentPlyIdx).toBe(5);
		const leg = s.chainExtensions.get(5);
		expect(leg).toMatchObject({ opponentSan: 'Bc5', userSan: 'c3', opponentAdded: false });

		// Phase A: add the opponent's move; the board moves past it.
		await s.handleChainAddOpponent(5);
		expect(s.chainExtensions.get(5)?.opponentAdded).toBe(true);
		expect(s.currentPlyIdx).toBe(6);

		// Phase B: pick the game reply. The game ends there, so the issue resolves.
		await s.handlePickChainResponse(5, 'c3');
		expect(s.chainExtensions.has(5)).toBe(false);
		expect(s.resolvedIssues.has(5)).toBe(true);
		expect(calls.filter((c) => c.path === '/api/review/add-move').map((c) => c.body.san)).toEqual([
			'Bc4',
			'Bc5',
			'c3'
		]);
	});

	it('resolves straight away when the picked move differs from the game', async () => {
		const s = setup();
		load(s, game());
		await s.handlePickResponseMove(s.analysis!.issues[0], 'd4');
		expect(s.chainExtensions.size).toBe(0);
		expect(s.resolvedIssues.has(5)).toBe(true);
	});

	it('detects a transposition into a position already in the repertoire', async () => {
		moves = [{ repertoireId: ACTIVE_REPERTOIRE, fromFen: game().fenHistory[6], san: 'O-O' }];
		const s = setup();
		load(s, game());
		await s.handlePickResponseMove(s.analysis!.issues[0], 'Bc4');
		expect(s.chainExtensions.get(5)?.transposition).toEqual({
			existingSan: 'O-O',
			userPlayedCorrect: false
		});

		await s.handleChainAddOpponent(5);
		await s.handleTranspositionReplace(5);
		expect(calls.at(-1)).toEqual({
			path: '/api/review/add-move',
			body: {
				repertoireId: ACTIVE_REPERTOIRE,
				fromFen: game().fenHistory[6],
				san: 'c3',
				forceReplace: true
			}
		});
		expect(s.resolvedIssues.has(5)).toBe(true);
	});

	it('counts moves added this session when looking for transpositions', async () => {
		// Opponent surprise at ply 2 (1…e5); the user then adds 2. Nf3 and the chain
		// reaches 3. Bc4, which an earlier pick already put in the repertoire.
		const s = setup();
		load(
			s,
			gameAnalysis(ITALIAN, [
				{ type: 'OPPONENT_SURPRISE', ply: 2 },
				{ type: 'BEYOND_REPERTOIRE', ply: 5 }
			])
		);
		const [surprise, beyond] = s.analysis!.issues;
		await s.handlePickResponseMove(beyond, 'Bc4');
		s.skipChain(5);

		await s.handleAddOpponentMove(surprise);
		expect(s.opponentMoveAdded.has(2)).toBe(true);
		await s.handlePickResponseMove(surprise, 'Nf3');
		await s.handleChainAddOpponent(2);
		expect(s.chainExtensions.get(2)).toMatchObject({
			opponentSan: 'Nc6',
			transposition: { existingSan: 'Bc4', userPlayedCorrect: true }
		});
	});

	it('ends the chain when the user clicks Done', async () => {
		const s = setup();
		load(s, game());
		await s.handlePickResponseMove(s.analysis!.issues[0], 'Bc4');
		s.skipChain(5);
		expect(s.chainExtensions.size).toBe(0);
		expect(s.resolvedIssues.has(5)).toBe(true);
		expect(s.resolvedCount).toBe(1);
	});
});

describe('opponent surprises', () => {
	const game = () => gameAnalysis(['e4', 'c5', 'Nf3'], [{ type: 'OPPONENT_SURPRISE', ply: 2 }]);

	it('adds the opponent move to a new repertoire and switches to it', async () => {
		routes['/api/repertoires'] = () => json({ id: 99 });
		const s = setup();
		load(s, game());
		s.openNewRepForm(2);
		expect(s.newRepIssuePly).toBe(2);
		s.newRepName = '  Sicilian  ';
		await s.handleAddOpponentMoveNewRep(s.analysis!.issues[0]);

		expect(calls.find((c) => c.path === '/api/repertoires')?.body).toEqual({
			name: 'Sicilian',
			color: 'WHITE'
		});
		expect(calls.find((c) => c.path === '/api/review/add-move')?.body.repertoireId).toBe(99);
		expect(s.overrideRepertoireId).toBe(99);
		expect(s.opponentMoveAdded.has(2)).toBe(true);
		expect(s.newRepIssuePly).toBeNull();
		expect(s.newRepName).toBe('');
	});

	it('does nothing without a repertoire name', async () => {
		const s = setup();
		load(s, game());
		s.openNewRepForm(2);
		await s.handleAddOpponentMoveNewRep(s.analysis!.issues[0]);
		expect(calls.some((c) => c.path === '/api/repertoires')).toBe(false);
	});
});

describe('saving', () => {
	it('saves the review, then shows the saved screen', async () => {
		routes['/api/review/save'] = () => json({ id: 41 });
		const s = setup();
		load(s, gameAnalysis(['e4', 'e5', 'Bc4'], [{ type: 'DEVIATION', ply: 3 }]));
		s.importedGameId = 5;
		s.notes = 'Forgot my prep';
		await s.saveReview();

		expect(calls.find((c) => c.path === '/api/review/save')?.body).toEqual({
			repertoireId: ACTIVE_REPERTOIRE,
			pgn: '1. e4 *',
			deviationFen: gameAnalysis(['e4', 'e5', 'Bc4']).fenHistory[2],
			notes: 'Forgot my prep',
			importedGameId: 5
		});
		expect(s.pageState).toBe('saved');
		expect(s.saving).toBe(false);
		expect(invalidateAll).toHaveBeenCalledOnce();
	});

	it('stays on the analysis screen when saving fails', async () => {
		routes['/api/review/save'] = () => new Response('nope', { status: 500 });
		const s = setup();
		load(s, gameAnalysis(['e4']));
		await s.saveReview();
		expect(s.pageState).toBe('analysis');
		expect(invalidateAll).not.toHaveBeenCalled();
	});

	it('goes back to the input screen to review another game', async () => {
		routes['/api/review/save'] = () => json({ id: 41 });
		const s = setup();
		load(s, gameAnalysis(['e4']), { repertoireId: 12 });
		s.importedGameId = 5;
		await s.saveReview();
		s.reviewAnother();
		expect(s.pageState).toBe('input');
		expect(s.analysis).toBeNull();
		expect(s.importedGameId).toBeNull();
		expect(s.overrideRepertoireId).toBeNull();
	});
});
