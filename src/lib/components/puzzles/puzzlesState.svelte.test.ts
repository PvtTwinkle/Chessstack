import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import {
	createPuzzlesState,
	REPLY_DELAY_MS,
	SETUP_DELAY_MS,
	SOLUTION_DELAY_MS,
	type Puzzle
} from './puzzlesState.svelte';
import { applyUci } from '$lib/puzzles/solution';
import { STARTING_FEN } from '$lib/fen';

// Sounds need the Web Audio API, which Node doesn't have.
vi.mock('$lib/sounds', () => ({
	playMove: vi.fn(),
	playCapture: vi.fn(),
	playCorrect: vi.fn(),
	playIncorrect: vi.fn()
}));

function puzzle(fen: string, moves: string): Puzzle {
	return {
		puzzleId: 'p1',
		fen,
		moves,
		rating: 1500,
		ratingDeviation: 75,
		popularity: 90,
		nbPlays: 100,
		themes: 'opening',
		gameUrl: null,
		openingTags: 'Kings_Pawn_Game',
		openingFamily: 'kings pawn game'
	};
}

// Black answers 1.e4 with e5 and, after 2.Nf3, with Nc6.
const opening = puzzle(STARTING_FEN, 'e2e4 e7e5 g1f3 b8c6');
// Black's setup move Nc2 lets either rook mate on the back rank.
const backRank = puzzle('6k1/5ppp/8/8/1n6/8/5PPP/RR4K1 b - - 0 1', 'b4c2 a1a8');

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

const fetchMock = vi.fn();

function setup() {
	return createPuzzlesState({
		getBaseUrl: () => '',
		getFamilies: () => ['kings pawn game', 'ruy lopez'],
		getRepertoireColor: () => 'BLACK'
	});
}

/** Plays a UCI move on the board the way ChessBoard reports it. */
function play(s: ReturnType<typeof setup>, uci: string) {
	const chess = new Chess(s.currentFen);
	const move = applyUci(chess, uci);
	if (!move) throw new Error(`illegal ${uci}`);
	s.handleMove(move.from, move.to, move.san, chess.fen(), !!move.captured, move.promotion);
}

async function start(s: ReturnType<typeof setup>, p: Puzzle) {
	fetchMock.mockResolvedValueOnce(jsonResponse(p));
	await s.fetchNext();
	await vi.advanceTimersByTimeAsync(SETUP_DELAY_MS);
}

/** The attempts POSTed so far, as their bodies. */
function attempts() {
	return fetchMock.mock.calls
		.filter(([url]) => String(url).endsWith('/api/puzzles/attempt'))
		.map(([, init]) => JSON.parse(init.body));
}

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock.mockReset();
	fetchMock.mockResolvedValue(jsonResponse({ success: true }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('puzzlesState', () => {
	it('asks for a puzzle with the filters', async () => {
		const s = setup();
		s.minRating = '1200';
		s.toggleTheme('fork', true);
		s.myColorOnly = true;
		fetchMock.mockResolvedValueOnce(jsonResponse(null));
		await s.fetchNext();
		const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
		expect(url.pathname).toBe('/api/puzzles/next');
		expect(url.searchParams.get('families')).toBe('kings pawn game,ruy lopez');
		expect(url.searchParams.get('minRating')).toBe('1200');
		expect(url.searchParams.get('themes')).toBe('fork');
		expect(url.searchParams.get('color')).toBe('BLACK');
	});

	it('plays the setup move, then waits for the user', async () => {
		const s = setup();
		fetchMock.mockResolvedValueOnce(jsonResponse(opening));
		await s.fetchNext();
		expect(s.phase).toBe('setup');
		expect(s.orientation).toBe('black');
		await vi.advanceTimersByTimeAsync(SETUP_DELAY_MS);
		expect(s.phase).toBe('waiting');
		expect(s.lastMove).toEqual(['e2', 'e4']);
	});

	it("plays the opponent's reply after a correct move and records a solve", async () => {
		const s = setup();
		await start(s, opening);
		play(s, 'e7e5');
		expect(s.phase).toBe('correct');
		await vi.advanceTimersByTimeAsync(REPLY_DELAY_MS);
		expect(s.phase).toBe('waiting');
		expect(s.lastMove).toEqual(['g1', 'f3']);

		play(s, 'b8c6');
		expect(s.phase).toBe('solved');
		expect(s.solvedCount).toBe(1);
		expect(attempts()).toEqual([expect.objectContaining({ puzzleId: 'p1', solved: true })]);
	});

	it('shows the solution after a wrong move and records a failure', async () => {
		const s = setup();
		await start(s, opening);
		play(s, 'c7c5');
		expect(s.phase).toBe('incorrect');
		expect(s.canFetchNext).toBe(true);
		expect(attempts()).toEqual([expect.objectContaining({ solved: false })]);

		await vi.advanceTimersByTimeAsync(SOLUTION_DELAY_MS);
		expect(s.phase).toBe('idle');
		expect(s.lastMove).toEqual(['e7', 'e5']);
		expect(s.failedCount).toBe(1);
	});

	it('accepts a different checkmate', async () => {
		const s = setup();
		await start(s, backRank);
		play(s, 'b1b8');
		expect(s.phase).toBe('solved');
		expect(attempts()).toEqual([expect.objectContaining({ solved: true })]);
	});

	it('ignores moves while it is not the user’s turn', async () => {
		const s = setup();
		fetchMock.mockResolvedValueOnce(jsonResponse(opening));
		await s.fetchNext();
		s.handleMove('e7', 'e5', 'e5', STARTING_FEN, false);
		expect(s.phase).toBe('setup');
	});

	it('marks the hint square', async () => {
		const s = setup();
		await start(s, opening);
		s.showHint();
		expect(s.hintShapes).toEqual([{ orig: 'e7', brush: 'green' }]);
	});

	it('explains a rate limit, an empty result and a failed request', async () => {
		const s = setup();
		fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'slow down' }, 429));
		await s.fetchNext();
		expect(s.phase).toBe('idle');
		expect(s.message).toMatch(/Too many puzzles/);

		fetchMock.mockResolvedValueOnce(jsonResponse(null));
		await s.fetchNext();
		expect(s.message).toMatch(/No puzzle matches/);

		fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500));
		await s.fetchNext();
		expect(s.message).toMatch(/Couldn't load a puzzle/);
		expect(s.puzzle).toBeNull();
	});

	it('drops pending steps when the page goes', async () => {
		const s = setup();
		fetchMock.mockResolvedValueOnce(jsonResponse(opening));
		await s.fetchNext();
		s.destroy();
		await vi.advanceTimersByTimeAsync(SETUP_DELAY_MS);
		expect(s.phase).toBe('setup');
		expect(s.lastMove).toBeUndefined();
	});
});
