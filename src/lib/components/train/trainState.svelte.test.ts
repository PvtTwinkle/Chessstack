import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Chess } from 'chess.js';
import { fenKey, STARTING_FEN } from '$lib/fen';
import {
	createTrainState,
	formatEval,
	groupMovePairs,
	pgnDate,
	lichessAnalysisUrl,
	type TrainPageData,
	type SavedPosition
} from './trainState.svelte';

vi.mock('$lib/sounds', () => ({
	setSoundEnabled: vi.fn(),
	playMove: vi.fn(),
	playCapture: vi.fn()
}));

import { setSoundEnabled, playMove, playCapture } from '$lib/sounds';

// The in-browser engine, faked: it scores the first legal move +0.20 for the
// side to move, and finds nothing in a position without legal moves.
const analyse = vi.hoisted(() =>
	vi.fn(async ({ fen }: { fen: string }) => {
		const { Chess } = await import('chess.js');
		const [move] = new Chess(fen).moves({ verbose: true });
		return {
			depth: 20,
			done: true,
			available: true,
			moves: move ? [{ uci: move.lan, scoreCp: 20, scoreMate: null }] : []
		};
	})
);
vi.mock('$lib/engine/engine', () => ({ getEngine: () => ({ analyse }) }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function fenAfter(...sans: string[]): string {
	const chess = new Chess();
	for (const san of sans) chess.move(san);
	return chess.fen();
}

function makeData(overrides: Partial<TrainPageData> = {}): TrainPageData {
	return {
		repertoire: { id: 7, name: 'My e4', color: 'WHITE', startFen: null },
		repertoireMoves: [],
		user: { username: 'kevin' },
		// No artificial delay before the computer's move.
		settings: { playbackSpeed: 0 },
		...overrides
	};
}

type Handler = (body: unknown, url: string) => unknown;

// A fetch stub that routes by "METHOD path" and records every call.
function stubFetch(routes: Record<string, Handler>) {
	const calls: { method: string; url: string; body: unknown }[] = [];
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const body = init?.body ? JSON.parse(init.body as string) : undefined;
		calls.push({ method, url, body });
		const path = url.split('?')[0];
		const handler = routes[`${method} ${path}`];
		if (!handler) return { ok: true, json: async () => ({}) };
		const result = handler(body, url);
		if (result instanceof Error) throw result;
		return { ok: true, json: async () => result };
	});
	vi.stubGlobal('fetch', fetchMock);
	return calls;
}

// Computer replies: a queue of SAN moves, then "no moves".
function computerReplies(...sans: string[]): Handler {
	const queue = [...sans];
	return () => (queue.length > 0 ? { san: queue.shift() } : { noMoves: true });
}

function userMove(s: ReturnType<typeof createTrainState>, san: string) {
	const chess = new Chess(s.currentFen);
	const move = chess.move(san);
	s.handleMove(move.from, move.to, move.san, chess.fen(), !!move.captured);
}

const EVAL = { evalCp: 35, score: 0.55, ratingBefore: 1200, ratingAfter: 1208, ratingChange: 8 };

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('formatEval', () => {
	it('returns null when there is no eval', () => {
		expect(formatEval(null)).toBeNull();
		expect(formatEval(undefined)).toBeNull();
	});

	it('formats centipawns as signed pawns', () => {
		expect(formatEval(0)).toBe('+0.00');
		expect(formatEval(35)).toBe('+0.35');
		expect(formatEval(-120)).toBe('-1.20');
	});

	it('shows mate scores in words', () => {
		expect(formatEval(99999)).toBe('Mate (winning)');
		expect(formatEval(-99999)).toBe('Mate (losing)');
	});
});

describe('groupMovePairs', () => {
	it('pairs moves from the start of the game', () => {
		expect(groupMovePairs(['e4', 'e5', 'Nf3'], 0)).toEqual([
			{ num: 1, white: 'e4', black: 'e5' },
			{ num: 2, white: 'Nf3' }
		]);
	});

	it('numbers moves after a lead-in, starting with a black move', () => {
		// After 1. e4 (one half-move of lead-in), black's reply is 1... e5.
		expect(groupMovePairs(['e5', 'Nf3', 'Nc6'], 1)).toEqual([
			{ num: 1, black: 'e5' },
			{ num: 2, white: 'Nf3', black: 'Nc6' }
		]);
	});

	it('returns nothing for no moves', () => {
		expect(groupMovePairs([], 4)).toEqual([]);
	});
});

describe('pgnDate', () => {
	it('formats a local date as YYYY.MM.DD', () => {
		expect(pgnDate(new Date(2026, 0, 5))).toBe('2026.01.05');
	});
});

describe('lichessAnalysisUrl', () => {
	it('builds an analysis URL from the position and side', () => {
		expect(lichessAnalysisUrl(fenAfter('e4'), 'black')).toBe(
			'https://lichess.org/analysis/rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR_b_KQkq_-_0_1?color=black'
		);
	});
});

// ── State ────────────────────────────────────────────────────────────────────

describe('createTrainState', () => {
	describe('rating setup', () => {
		it('asks for a starting rating when the user has none', () => {
			const s = createTrainState(() => makeData());
			s.syncRating(null);
			expect(s.showRatingSetup).toBe(true);
			expect(s.trainerRating).toBeNull();

			s.syncRating(1500);
			expect(s.showRatingSetup).toBe(false);
			expect(s.trainerRating).toBe(1500);
		});

		it('clamps and saves the initial rating', async () => {
			const calls = stubFetch({});
			const s = createTrainState(() => makeData());
			s.syncRating(null);
			s.initialRating = 3456.7;
			await s.saveInitialRating();

			expect(calls).toEqual([
				{ method: 'PATCH', url: '/api/settings', body: { trainerRating: 3000 } }
			]);
			expect(s.trainerRating).toBe(3000);
			expect(s.showRatingSetup).toBe(false);
		});

		it('keeps the prompt open when saving fails', async () => {
			stubFetch({ 'PATCH /api/settings': () => new Error('offline') });
			const s = createTrainState(() => makeData());
			s.syncRating(null);
			await s.saveInitialRating();
			expect(s.showRatingSetup).toBe(true);
			expect(s.trainerRating).toBeNull();
		});
	});

	describe('sound', () => {
		it('toggles sound and saves the preference', () => {
			const calls = stubFetch({});
			const s = createTrainState(() => makeData());
			s.syncSound(true);
			s.toggleSound();

			expect(s.soundEnabled).toBe(false);
			expect(setSoundEnabled).toHaveBeenCalledWith(false);
			expect(calls[0]).toEqual({
				method: 'PATCH',
				url: '/api/settings',
				body: { soundEnabled: false }
			});
		});
	});

	describe('starting position', () => {
		it("uses the repertoire's start position by default", () => {
			const start = fenAfter('e4', 'e5');
			const s = createTrainState(() =>
				makeData({ repertoire: { id: 7, name: 'r', color: 'WHITE', startFen: start } })
			);
			expect(s.setupMode).toBe('repertoire');
			expect(s.startFen).toBe(start);
		});

		it('records moves made in custom mode and can reset them', () => {
			const s = createTrainState(() => makeData());
			s.switchSetupMode('custom');
			const fen = fenAfter('d4');
			s.handleSetupMove('d2', 'd4', 'd4', fen, false);

			expect(s.customSetupMoves).toEqual(['d4']);
			expect(s.currentFen).toBe(fen);
			expect(s.lastMove).toEqual(['d2', 'd4']);
			expect(s.startFen).toBe(fenKey(fen));
			expect(s.getLeadInMoves()).toEqual(['d4']);
			expect(playMove).toHaveBeenCalledTimes(1);

			const key = s.boardKey;
			s.resetCustomPosition();
			expect(s.customSetupMoves).toEqual([]);
			expect(s.currentFen).toBe(STARTING_FEN);
			expect(s.lastMove).toBeUndefined();
			expect(s.boardKey).toBe(key + 1);
		});

		it('plays no sound when sound is off', () => {
			const s = createTrainState(() => makeData());
			s.syncSound(false);
			s.switchSetupMode('custom');
			s.handleSetupMove('d2', 'd4', 'd4', fenAfter('d4'), false);
			expect(playMove).not.toHaveBeenCalled();
			expect(playCapture).not.toHaveBeenCalled();
		});

		it("rebuilds the lead-in to a repertoire's custom start from its moves", () => {
			const start = fenAfter('e4', 'e5');
			const s = createTrainState(() =>
				makeData({
					repertoire: { id: 7, name: 'r', color: 'WHITE', startFen: start },
					repertoireMoves: [
						{ fromFen: fenAfter(), toFen: fenAfter('e4'), san: 'e4' },
						{ fromFen: fenAfter('e4'), toFen: start, san: 'e5' }
					]
				})
			);
			expect(s.getLeadInMoves()).toEqual(['e4', 'e5']);
		});
	});

	describe('saved positions', () => {
		const sicilian: SavedPosition = {
			id: 1,
			fen: fenKey(fenAfter('e4', 'c5')),
			name: 'Sicilian',
			leadInMoves: JSON.stringify(['e4', 'c5']),
			createdAt: new Date()
		};
		const broken: SavedPosition = {
			id: 2,
			fen: fenKey(fenAfter('d4')),
			name: 'Broken lead-in',
			leadInMoves: 'not json',
			createdAt: new Date()
		};

		it('selects a saved position and uses its lead-in moves', () => {
			const s = createTrainState(() => makeData());
			s.syncSavedPositions([sicilian, broken]);
			s.switchSetupMode('saved');
			// Nothing selected yet: no lead-in, and the start falls back to the custom position.
			expect(s.getLeadInMoves()).toEqual([]);

			s.selectSavedPosition(1);
			expect(s.selectedSavedId).toBe(1);
			expect(s.startFen).toBe(sicilian.fen);
			expect(fenKey(s.currentFen)).toBe(sicilian.fen);
			expect(s.getLeadInMoves()).toEqual(['e4', 'c5']);

			s.selectSavedPosition(2);
			expect(s.getLeadInMoves()).toEqual([]);
		});

		it('saves the custom position with its lead-in and lists it first', async () => {
			const fen = fenAfter('d4');
			const calls = stubFetch({
				'POST /api/train/saved-positions': (body) => ({
					position: { id: 9, ...(body as object), leadInMoves: '["d4"]', createdAt: new Date() }
				})
			});
			const s = createTrainState(() => makeData());
			s.syncSavedPositions([sicilian]);
			s.switchSetupMode('custom');
			s.handleSetupMove('d2', 'd4', 'd4', fen, false);

			s.savePositionName = '   ';
			await s.saveCurrentPosition();
			expect(calls).toHaveLength(0);

			s.savePositionName = '  Queen pawn  ';
			await s.saveCurrentPosition();
			expect(calls[0].body).toEqual({ fen, name: 'Queen pawn', leadInMoves: ['d4'] });
			expect(s.savedPositions.map((p) => p.id)).toEqual([9, 1]);
			expect(s.savePositionName).toBe('');
			expect(s.savingPosition).toBe(false);
		});

		it('deletes a saved position and clears the selection', async () => {
			const calls = stubFetch({});
			const s = createTrainState(() => makeData());
			s.syncSavedPositions([sicilian, broken]);
			s.selectSavedPosition(1);
			await s.deleteSavedPosition(1);

			expect(calls[0]).toEqual({
				method: 'DELETE',
				url: '/api/train/saved-positions',
				body: { id: 1 }
			});
			expect(s.savedPositions.map((p) => p.id)).toEqual([2]);
			expect(s.selectedSavedId).toBeNull();
		});
	});

	describe('a training game', () => {
		it('starts as white, waits for the user, and writes PGN headers', () => {
			const calls = stubFetch({});
			const s = createTrainState(() => makeData());
			s.syncRating(1200);
			s.syncBracket(3);
			s.startTraining();

			expect(s.phase).toBe('playing');
			expect(s.isUserTurn).toBe(true);
			expect(calls).toHaveLength(0);

			const pgn = s.reviewHandoff().pgn;
			expect(pgn).toContain('[White "kevin"]');
			expect(pgn).toContain('[Black "Chessstack Trainer (1401–1600)"]');
			expect(pgn).toContain('[WhiteElo "1200"]');
			expect(pgn).toContain('[Event "Opening Trainer"]');
		});

		it('plays the computer reply, then ends and evaluates when the database runs out', async () => {
			const calls = stubFetch({
				'GET /api/train/computer-move': computerReplies('e5'),
				'POST /api/train/evaluate': () => EVAL
			});
			const s = createTrainState(() => makeData());
			s.syncRating(1200);
			s.syncBracket(3);
			s.startTraining();

			userMove(s, 'e4');
			expect(s.waitingForComputer).toBe(true);
			await vi.waitFor(() => expect(s.waitingForComputer).toBe(false));

			expect(calls[0].url).toBe(
				`/api/train/computer-move?fen=${encodeURIComponent(fenAfter('e4')).replace(/%20/g, '+')}&source=players&rating=3`
			);
			expect(s.gameMoves.map((m) => m.san)).toEqual(['e4', 'e5']);
			expect(s.lastMove).toEqual(['e7', 'e5']);
			expect(s.moveListDisplay).toEqual([{ num: 1, white: 'e4', black: 'e5' }]);
			expect(s.isUserTurn).toBe(true);

			userMove(s, 'Nf3');
			await vi.waitFor(() => expect(s.evalResult).not.toBeNull());
			expect(s.phase).toBe('ended');
			expect(s.evaluating).toBe(false);
			expect(s.endReason).toBe('The database has no more moves for this position.');

			const evaluate = calls.find((c) => c.url === '/api/train/evaluate');
			expect(evaluate?.body).toMatchObject({
				// Black is to move, so the engine's +0.20 is -20 from White's side.
				evalCp: -20,
				evalMate: null,
				fen: fenAfter('e4', 'e5', 'Nf3'),
				rated: true,
				repertoireId: 7,
				movesPlayed: 2,
				startFen: STARTING_FEN,
				moveSource: 'PLAYERS',
				playerColor: 'WHITE',
				ratingBracket: 3
			});
			expect((evaluate?.body as { pgn: string }).pgn).toContain('[Result "*"]');
			expect(s.evalResult).toEqual(EVAL);
			expect(s.evalDisplay).toBe('+0.35');
			expect(s.trainerRating).toBe(1208);
			expect(s.fullMovesPlayed).toBe(1);
		});

		it('lets the computer move first when the user plays black', async () => {
			stubFetch({ 'GET /api/train/computer-move': computerReplies('d4') });
			const s = createTrainState(() =>
				makeData({ repertoire: { id: 7, name: 'r', color: 'BLACK', startFen: null } })
			);
			s.syncRating(1200);
			s.moveSource = 'MASTERS';
			s.startTraining();

			expect(s.isUserTurn).toBe(false);
			await vi.waitFor(() => expect(s.gameMoves).toHaveLength(1));
			expect(s.isUserTurn).toBe(true);
			expect(s.orientation).toBe('black');

			const pgn = s.reviewHandoff().pgn;
			expect(pgn).toContain('[White "Chessstack Trainer (Masters)"]');
			expect(pgn).toContain('[BlackElo "1200"]');
		});

		it('replays the lead-in so the PGN starts from move 1', async () => {
			stubFetch({ 'GET /api/train/computer-move': computerReplies('Nc6') });
			const s = createTrainState(() => makeData());
			s.switchSetupMode('custom');
			for (const san of ['e4', 'e5']) {
				const chess = new Chess(s.currentFen);
				const m = chess.move(san);
				s.handleSetupMove(m.from, m.to, m.san, chess.fen(), false);
			}
			s.startTraining();
			expect(s.leadInLength).toBe(2);

			userMove(s, 'Nf3');
			await vi.waitFor(() => expect(s.gameMoves).toHaveLength(2));
			expect(s.moveListDisplay).toEqual([{ num: 2, white: 'Nf3', black: 'Nc6' }]);
			expect(s.reviewHandoff().pgn).toContain('1. e4 e5 2. Nf3 Nc6');
		});

		it('ignores board moves while it is the computer’s turn', () => {
			stubFetch({ 'GET /api/train/computer-move': () => new Promise(() => {}) });
			const s = createTrainState(() => makeData());
			s.startTraining();
			userMove(s, 'e4');
			expect(s.isUserTurn).toBe(false);

			const chess = new Chess(s.currentFen);
			const m = chess.move('e5');
			s.handleMove(m.from, m.to, m.san, chess.fen(), false);
			expect(s.gameMoves).toHaveLength(1);
		});

		it('ends at the depth limit after a full move pair', async () => {
			const calls = stubFetch({
				'GET /api/train/computer-move': computerReplies('e5', 'Nc6'),
				'POST /api/train/evaluate': () => EVAL
			});
			const s = createTrainState(() => makeData());
			s.depthLimit = 1;
			s.startTraining();
			userMove(s, 'e4');

			await vi.waitFor(() => expect(s.phase).toBe('ended'));
			expect(s.endReason).toBe('Reached the depth limit of 1 move.');
			// Only one computer move was requested.
			expect(calls.filter((c) => c.url.startsWith('/api/train/computer-move'))).toHaveLength(1);
		});

		it('records checkmate and the result', async () => {
			const calls = stubFetch({
				'GET /api/train/computer-move': computerReplies('e5', 'Qh4#'),
				'POST /api/train/evaluate': () => EVAL
			});
			const s = createTrainState(() => makeData());
			s.startTraining();
			userMove(s, 'f3');
			await vi.waitFor(() => expect(s.gameMoves).toHaveLength(2));
			userMove(s, 'g4');
			await vi.waitFor(() => expect(s.phase).toBe('ended'));
			expect(s.endReason).toBe('Checkmate!');
			expect(s.reviewHandoff().pgn).toContain('[Result "0-1"]');
			// A mated position has no engine score to send.
			await vi.waitFor(() => expect(s.evaluating).toBe(false));
			expect(calls.find((c) => c.url === '/api/train/evaluate')?.body).toMatchObject({
				evalCp: null,
				evalMate: null
			});
		});

		it('stops manually and sends an unrated session as unrated', async () => {
			const calls = stubFetch({ 'POST /api/train/evaluate': () => EVAL });
			const s = createTrainState(() => makeData());
			s.syncRating(1200);
			s.rated = false;
			s.startTraining();
			s.stopTraining();

			await vi.waitFor(() => expect(s.evaluating).toBe(false));
			expect(s.endReason).toBe('Training stopped manually.');
			expect(calls[0].body).toMatchObject({ rated: false, movesPlayed: 0 });
		});

		it('still saves the session when the engine cannot run', async () => {
			analyse.mockResolvedValueOnce({ depth: 0, done: true, available: false, moves: [] });
			const calls = stubFetch({ 'POST /api/train/evaluate': () => EVAL });
			const s = createTrainState(() => makeData());
			s.startTraining();
			s.stopTraining();

			await vi.waitFor(() => expect(s.evaluating).toBe(false));
			expect(calls[0].body).toMatchObject({ evalCp: null, evalMate: null });
			expect(s.evalResult).toEqual(EVAL);
		});

		it('never sends a rated session before the user has a rating', async () => {
			const calls = stubFetch({ 'POST /api/train/evaluate': () => EVAL });
			const s = createTrainState(() => makeData());
			s.syncRating(null);
			s.startTraining();
			s.stopTraining();
			await vi.waitFor(() => expect(s.evaluating).toBe(false));
			expect(calls[0].body).toMatchObject({ rated: false });
		});

		it('ends the session when the computer move request fails', async () => {
			stubFetch({
				'GET /api/train/computer-move': () => new Error('offline'),
				'POST /api/train/evaluate': () => new Error('offline')
			});
			const s = createTrainState(() => makeData());
			s.startTraining();
			userMove(s, 'e4');

			await vi.waitFor(() => expect(s.phase).toBe('ended'));
			await vi.waitFor(() => expect(s.evaluating).toBe(false));
			expect(s.endReason).toBe('Failed to fetch computer move.');
			expect(s.evalResult).toBeNull();
			expect(s.waitingForComputer).toBe(false);
		});

		it('ends the session when the computer returns an illegal move', async () => {
			stubFetch({ 'GET /api/train/computer-move': computerReplies('Ke2') });
			const s = createTrainState(() => makeData());
			s.startTraining();
			userMove(s, 'e4');
			await vi.waitFor(() => expect(s.phase).toBe('ended'));
			// chess.js throws on an illegal SAN, which lands in the request's catch.
			expect(s.endReason).toBe('Failed to fetch computer move.');
		});

		it('hands the game to Review and resets on play again', async () => {
			stubFetch({ 'POST /api/train/evaluate': () => EVAL });
			const s = createTrainState(() => makeData());
			s.startTraining();
			userMove(s, 'e4');
			s.stopTraining();
			await vi.waitFor(() => expect(s.evaluating).toBe(false));

			expect(s.reviewHandoff()).toEqual({
				pgn: expect.stringContaining('1. e4'),
				playerColor: 'WHITE',
				repertoireId: 7
			});

			s.playAgain();
			expect(s.phase).toBe('setup');
			expect(s.currentFen).toBe(STARTING_FEN);
			expect(s.gameMoves).toEqual([]);
			expect(s.moveCount).toBe(0);
			expect(s.leadInLength).toBe(0);
			expect(s.endReason).toBe('');
			expect(s.evalResult).toBeNull();
		});
	});
});
