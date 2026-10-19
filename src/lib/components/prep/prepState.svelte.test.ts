import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import {
	createPrepState,
	FILTER_SAVE_DELAY_MS,
	type CoverageEntry,
	type OpponentMoveRow,
	type PrepMoveRow
} from './prepState.svelte';
import { fenKey } from '$lib/fen';

// Sounds need the Web Audio API, which Node doesn't have.
vi.mock('$lib/sounds', () => ({ playMove: vi.fn(), playCapture: vi.fn() }));

type Step = { fromFen: string; toFen: string; san: string; from: string; to: string };

function line(...sans: string[]): Step[] {
	const chess = new Chess();
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		const r = chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san, from: r.from, to: r.to };
	});
}

/** An opponent move; `opponentColor` is the side the opponent played. */
function opp(step: Step, opponentColor: 'w' | 'b', games = 5): OpponentMoveRow {
	return {
		prepId: 1,
		positionFen: step.fromFen,
		moveSan: step.san,
		opponentColor,
		resultingFen: step.toFen,
		gamesPlayed: games,
		whiteWins: games,
		blackWins: 0,
		draws: 0
	};
}

let nextId = 1;
function prep(step: Step, color: 'white' | 'black' = 'white'): PrepMoveRow {
	return {
		id: nextId++,
		prepId: 1,
		userId: 1,
		fromFen: step.fromFen,
		toFen: step.toFen,
		san: step.san,
		color,
		createdAt: 0
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function setup() {
	return createPrepState({ getPrepId: () => 1, getBaseUrl: () => '' });
}

async function play(s: ReturnType<typeof setup>, san: string) {
	const chess = new Chess(s.currentFen);
	const r = chess.move(san);
	await s.handlePlayMove(r.from, r.to, r.san, chess.fen(), !!r.captured);
}

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

// The opponent (Black) answers 1.e4 with e5 or c5; after 1.e4 e5 the user
// has 2.Nf3 saved, and 1.e4 itself comes from the user's repertoire.
const [e4, e5, nf3, nc6] = line('e4', 'e5', 'Nf3', 'Nc6');
const c5 = line('e4', 'c5')[1];
const coverage: CoverageEntry[] = [{ fromFen: e4.fromFen, san: 'e4', color: 'WHITE' }];

describe('prepState', () => {
	it("shows the opponent's moves on their turn and suggestions on the user's", () => {
		const s = setup();
		// d4 here is a context move: what the opponent's opponents played.
		const d4 = line('d4')[0];
		s.syncFromData([opp(e5, 'b'), opp(c5, 'b'), opp(d4, 'b')], [], coverage);

		expect(s.isUserTurn).toBe(true);
		expect(s.suggestionsAtPosition.map((m) => m.moveSan)).toEqual(['d4']);
		s.clickOpponentMove('e4', e4.toFen);
		expect(s.isUserTurn).toBe(false);
		expect(s.opponentMovesAtPosition.map((m) => m.moveSan).sort()).toEqual(['c5', 'e5']);
	});

	it('marks gaps green, yellow and red', () => {
		const s = setup();
		s.syncFromData(
			[opp(e5, 'b'), opp(c5, 'b')],
			[prep(nf3)],
			[...coverage, { fromFen: c5.toFen, san: 'Nf3', color: 'WHITE' }]
		);
		expect(s.getGapStatus(e5.toFen)).toBe('green');
		expect(s.getGapStatus(c5.toFen)).toBe('yellow');
		expect(s.getGapStatus(nc6.toFen)).toBe('red');
	});

	it('walks the tree through repertoire moves and counts covered positions', () => {
		const s = setup();
		s.syncFromData([opp(e5, 'b'), opp(c5, 'b', 9), opp(nc6, 'b')], [prep(nf3)], coverage);
		// e5 (prep answer) and c5 and Nc6 are the opponent's positions reached.
		expect(s.totalOpponentPositions).toBe(3);
		expect(s.coveredPositions).toEqual({ green: 1, yellow: 0 });
		// The most played red gap comes first.
		expect(s.allGaps[0]).toMatchObject({ moveSan: 'c5', status: 'red' });
	});

	it('handles a large tree quickly', () => {
		// A binary tree of user and opponent moves 12 plies deep (fewer
		// positions than 2^12, since some lines transpose).
		const moves: OpponentMoveRow[] = [];
		const prepRows: PrepMoveRow[] = [];
		const frontier = [new Chess()];
		for (let ply = 0; ply < 12; ply++) {
			const next: Chess[] = [];
			for (const chess of frontier) {
				for (const m of chess.moves({ verbose: true }).slice(0, 2)) {
					const child = new Chess(m.after);
					next.push(child);
					const step = {
						fromFen: fenKey(m.before),
						toFen: fenKey(m.after),
						san: m.san,
						from: m.from,
						to: m.to
					};
					if (ply % 2 === 0) prepRows.push(prep(step));
					else moves.push(opp(step, 'b'));
				}
			}
			frontier.splice(0, frontier.length, ...next.slice(0, 2000));
		}
		const s = setup();
		const started = performance.now();
		s.syncFromData(moves, prepRows, coverage);
		expect(s.totalOpponentPositions).toBeGreaterThan(500);
		// About a second normally and four under CI's coverage instrumentation; a
		// quadratic walk over this many positions would take far longer.
		expect(performance.now() - started).toBeLessThan(10_000);
		// Building the fixture with chess.js is the slow part, not the code under
		// test: close to 20 seconds under coverage, so the timeout leaves room.
	}, 60_000);

	it('finds the path to a gap through repertoire and opponent moves', () => {
		vi.useFakeTimers();
		const s = setup();
		s.syncFromData([opp(e5, 'b'), opp(nc6, 'b', 9)], [prep(nf3)], coverage);
		s.navigateToGap();
		vi.runAllTimers();
		expect(s.navHistory.map((h) => h.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
	});

	it('refuses a second prep move at a position and keeps the board there', async () => {
		const s = setup();
		s.syncFromData([opp(e5, 'b')], [prep(nf3)], coverage);
		s.navigateToLine(['e4', 'e5']);
		await play(s, 'Bc4');
		expect(s.conflictSan).toBe('Nf3');
		expect(s.currentFen).toBe(e5.toFen);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('saves a new prep move, and reports a server conflict', async () => {
		const s = setup();
		s.syncFromData([opp(e5, 'b')], [], coverage);
		s.navigateToLine(['e4', 'e5']);
		fetchMock.mockResolvedValueOnce(jsonResponse({ existing: { san: 'Nc3' } }, 409));
		await play(s, 'Nf3');
		expect(s.conflictSan).toBe('Nc3');
		expect(s.currentFen).toBe(e5.toFen);

		fetchMock.mockResolvedValueOnce(jsonResponse(prep(nf3), 201));
		await play(s, 'Nf3');
		expect(fenKey(s.currentFen)).toBe(nf3.toFen);
		expect(s.prepMovesAtPosition).toEqual([]);
	});

	it('keeps the board where it is when the data reloads', () => {
		const s = setup();
		const data = [opp(e5, 'b')];
		s.syncFromData(data, [prep(nf3)], coverage);
		s.navigateToLine(['e4', 'e5', 'Nf3']);
		s.syncFromData(data, [prep(nf3)], coverage);
		expect(s.navHistory).toHaveLength(3);
		// Once a step on the way is gone, it goes back to the start.
		s.syncFromData(data, [], coverage);
		expect(s.navHistory).toEqual([]);
	});

	it('deletes a prep move with the moves only it leads to', async () => {
		const s = setup();
		const [, , , , bb5] = line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5');
		const first = prep(nf3);
		const second = prep(bb5);
		s.syncFromData([opp(e5, 'b'), opp(nc6, 'b')], [first, second], coverage);
		expect(s.followingMoveCount(first.id)).toBe(1);

		fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true, ids: [first.id, second.id] }));
		await s.deletePrepMove(first.id);
		s.navigateToLine(['e4', 'e5']);
		expect(s.prepMovesAtPosition).toEqual([]);
		expect(s.followingMoveCount(second.id)).toBe(0);
	});

	describe('filter saving', () => {
		it('saves a burst of changes once, with the latest state', async () => {
			vi.useFakeTimers();
			fetchMock.mockResolvedValue(jsonResponse({}));
			const s = setup();
			s.syncFromData([opp(e5, 'b')], [], coverage);
			s.setMinGames(3);
			s.setMinGames(4);
			s.excludeMove(e5.fromFen, 'e5');
			expect(fetchMock).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(FILTER_SAVE_DELAY_MS);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
				minGames: 4,
				excludedMoves: [`${e5.fromFen}|e5`]
			});
		});

		it('sends a change made during a save after it, never before', async () => {
			vi.useFakeTimers();
			let release!: () => void;
			fetchMock.mockImplementationOnce(
				() => new Promise((resolve) => (release = () => resolve(jsonResponse({}))))
			);
			fetchMock.mockResolvedValue(jsonResponse({}));
			const s = setup();
			s.syncFromData([], [], []);
			s.setMinGames(3);
			await vi.advanceTimersByTimeAsync(FILTER_SAVE_DELAY_MS);
			s.setMinGames(7);
			await vi.advanceTimersByTimeAsync(FILTER_SAVE_DELAY_MS);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			release();
			await vi.advanceTimersByTimeAsync(0);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(JSON.parse(fetchMock.mock.calls[1][1].body).minGames).toBe(7);
		});

		it('says so when a save fails', async () => {
			vi.useFakeTimers();
			fetchMock.mockResolvedValue(jsonResponse({}, 500));
			const s = setup();
			s.syncFromData([], [], []);
			s.setMinGames(5);
			await vi.advanceTimersByTimeAsync(FILTER_SAVE_DELAY_MS);
			expect(s.errorMsg).toMatch(/Couldn't save the filter change/);
		});
	});
});
