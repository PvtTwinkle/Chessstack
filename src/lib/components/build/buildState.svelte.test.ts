import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { createBuildState, type RepertoireMove } from './buildState.svelte';
import { fenKey, STARTING_FEN } from '$lib/fen';

// Sounds need the Web Audio API, which Node doesn't have.
vi.mock('$lib/sounds', () => ({ playMove: vi.fn(), playCapture: vi.fn() }));

let nextId = 1;

// Saved moves for each line, sharing moves where lines overlap.
function movesFor(...lines: string[][]): RepertoireMove[] {
	const out: RepertoireMove[] = [];
	for (const line of lines) {
		const chess = new Chess();
		for (const san of line) {
			const fromFen = chess.fen();
			chess.move(san);
			if (out.some((m) => m.fromFen === fromFen && m.san === san)) continue;
			out.push(move(fromFen, chess.fen(), san));
		}
	}
	return out;
}

function move(fromFen: string, toFen: string, san: string): RepertoireMove {
	return {
		id: nextId++,
		userId: 1,
		repertoireId: 1,
		fromFen,
		toFen,
		san,
		source: 'manual',
		notes: null,
		createdAt: 0
	};
}

// The FEN after playing a line from the initial position.
function fenAfter(...sans: string[]): string {
	const chess = new Chess();
	for (const san of sans) chess.move(san);
	return chess.fen();
}

// Play a SAN move on the board the way ChessBoard reports it.
async function play(s: ReturnType<typeof setup>['s'], san: string) {
	const chess = new Chess(s.currentFen);
	const r = chess.move(san);
	await s.handleMove(r.from, r.to, r.san, chess.fen(), !!r.captured);
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function setup(opts: { color?: 'WHITE' | 'BLACK'; startFen?: string | null } = {}) {
	const page = { repertoireId: 1, color: opts.color ?? 'WHITE', startFen: opts.startFen ?? null };
	const s = createBuildState({
		getRepertoireId: () => page.repertoireId,
		getRepertoireColor: () => page.color,
		getStartFen: () => page.startFen
	});
	return { s, page };
}

// Answer POST /api/moves the way the server does: echo back a saved row.
function serverSavesMoves() {
	return vi.fn(async (_url: string, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		const chess = new Chess(body.fromFen);
		chess.move(body.san);
		return jsonResponse(move(body.fromFen, chess.fen(), body.san), 201);
	});
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async () => jsonResponse({}));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('syncFromData', () => {
	it('loads the moves and starts at the initial position', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5']));
		expect(s.moves).toHaveLength(2);
		expect(s.currentFen).toBe(STARTING_FEN);
		expect(s.navHistory).toEqual([]);
		expect(s.movesFromCurrentPosition.map((m) => m.san)).toEqual(['e4']);
	});

	it('replays a jump line from the URL', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5', 'Nf3']), 'e4,e5,Nf3');
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3']);
		expect(fenKey(s.currentFen)).toBe(fenKey(fenAfter('e4', 'e5', 'Nf3')));
		expect(s.lastMove).toEqual(['g1', 'f3']);
	});

	it('stops a jump line at the first illegal move', () => {
		const { s } = setup();
		s.syncFromData([], 'e4,Ke2,e5');
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
	});

	// Regression guard for the board reset fixed in PR #29: a data refresh of the
	// same repertoire right after a move must not throw the user back to the start.
	it('keeps the current line when the same repertoire is refreshed', async () => {
		const { s } = setup();
		const moves = movesFor(['e4', 'e5']);
		s.syncFromData(moves);
		await play(s, 'e4');
		await play(s, 'e5');

		s.syncFromData([...moves]);
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4', 'e5']);
		expect(fenKey(s.currentFen)).toBe(fenKey(fenAfter('e4', 'e5')));
	});

	it('resets the line when the repertoire changes', async () => {
		const { s, page } = setup();
		s.syncFromData(movesFor(['e4']));
		await play(s, 'e4');

		page.repertoireId = 2;
		s.syncFromData(movesFor(['d4']));
		expect(s.navHistory).toEqual([]);
		expect(s.currentFen).toBe(STARTING_FEN);
	});

	it('resets the line when a move in it was removed', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5']));
		await play(s, 'e4');
		await play(s, 'e5');

		s.syncFromData(movesFor(['e4']));
		expect(s.navHistory).toEqual([]);
	});

	it('leaves explore mode when the line is reset', () => {
		const { s, page } = setup();
		s.syncFromData([]);
		s.toggleExploreMode();
		page.repertoireId = 2;
		s.syncFromData([]);
		expect(s.exploreMode).toBe(false);
	});
});

describe('handleMove', () => {
	it('navigates through a saved move without saving it again', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		await play(s, 'e4');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
		expect(s.isUserTurn).toBe(false);
	});

	it('saves a new move and plays it', async () => {
		const { s } = setup();
		s.syncFromData([]);
		fetchMock.mockImplementation(serverSavesMoves());
		await play(s, 'd4');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/moves',
			expect.objectContaining({ method: 'POST' })
		);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			repertoireId: 1,
			fromFen: STARTING_FEN,
			san: 'd4'
		});
		expect(s.moves.map((m) => m.san)).toEqual(['d4']);
		expect(s.lastMove).toEqual(['d2', 'd4']);
		expect(s.saving).toBe(false);
	});

	it("refuses a second move on the user's turn and snaps the piece back", async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		const key = s.boardKey;
		await play(s, 'd4');

		expect(fetchMock).not.toHaveBeenCalled();
		expect(s.conflictSan).toBe('e4');
		expect(s.boardKey).toBe(key + 1);
		expect(s.currentFen).toBe(STARTING_FEN);
	});

	it('allows several opponent moves at the same position', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5']));
		await play(s, 'e4');
		fetchMock.mockImplementation(serverSavesMoves());
		await play(s, 'c5');

		expect(s.conflictSan).toBeNull();
		expect(s.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'c5']);
	});

	it('shows the existing move when the server reports a conflict', async () => {
		const { s } = setup();
		s.syncFromData([]);
		fetchMock.mockResolvedValue(jsonResponse({ existing: { san: 'c4' } }, 409));
		await play(s, 'd4');
		expect(s.conflictSan).toBe('c4');
		expect(s.navHistory).toEqual([]);
	});

	it('reports a failed save and keeps the position', async () => {
		const { s } = setup();
		s.syncFromData([]);
		fetchMock.mockResolvedValue(jsonResponse({}, 500));
		const key = s.boardKey;
		await play(s, 'd4');
		expect(s.errorMsg).toBe('Failed to save move. Please try again.');
		expect(s.boardKey).toBe(key + 1);
		expect(s.currentFen).toBe(STARTING_FEN);
	});

	it('reports a network error', async () => {
		const { s } = setup();
		s.syncFromData([]);
		fetchMock.mockRejectedValue(new TypeError('offline'));
		await play(s, 'd4');
		expect(s.errorMsg).toBe('Network error. Please try again.');
		expect(s.saving).toBe(false);
	});
});

describe('navigation', () => {
	it('undo steps back one move without deleting anything', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5']));
		await play(s, 'e4');
		await play(s, 'e5');

		s.handleUndo();
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
		expect(fenKey(s.currentFen)).toBe(fenKey(fenAfter('e4')));
		expect(s.lastMove).toEqual(['e2', 'e4']);
		expect(s.moves).toHaveLength(2);
	});

	it('undo at the start does nothing', () => {
		const { s } = setup();
		s.syncFromData([]);
		s.handleUndo();
		expect(s.currentFen).toBe(STARTING_FEN);
	});

	it('reset goes back to the initial position', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		await play(s, 'e4');
		s.handleReset();
		expect(s.navHistory).toEqual([]);
		expect(s.currentFen).toBe(STARTING_FEN);
		expect(s.lastMove).toBeUndefined();
	});

	it('navigateTo follows a saved move and resolves its squares', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['Nf3']));
		s.navigateTo(s.movesFromCurrentPosition[0]);
		expect(s.navHistory[0]).toMatchObject({ san: 'Nf3', from: 'g1', to: 'f3' });
		expect(s.lastMove).toEqual(['g1', 'f3']);
	});

	it('navigateToHistoryIdx jumps back to a move in the line', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5', 'Nf3']), 'e4,e5,Nf3');
		s.navigateToHistoryIdx(0);
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
		expect(fenKey(s.currentFen)).toBe(fenKey(fenAfter('e4')));
	});

	it('handleCandidateSelect plays a SAN move', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		await s.handleCandidateSelect('e4');
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
	});

	it('handleCandidateSelect reports an illegal move', async () => {
		const { s } = setup();
		s.syncFromData([]);
		await s.handleCandidateSelect('Ke2');
		expect(s.errorMsg).toBe('Could not play the selected move.');
	});

	it('groups the line into numbered pairs', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5', 'Nf3']), 'e4,e5,Nf3');
		expect(s.movePairs.map(([w, b]) => [w.san, b?.san ?? null])).toEqual([
			['e4', 'e5'],
			['Nf3', null]
		]);
	});
});

describe('derived state', () => {
	it('knows whose turn it is for a black repertoire', () => {
		const { s } = setup({ color: 'BLACK' });
		s.syncFromData(movesFor(['e4']));
		expect(s.isUserTurn).toBe(false);
		s.navigateTo(s.movesFromCurrentPosition[0]);
		expect(s.isUserTurn).toBe(true);
	});

	it('flags a transposition from a different move order', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5', 'Nf3', 'Nc6'], ['Nf3', 'Nc6', 'e4', 'e5']));
		s.navigateToLine(['e4', 'e5', 'Nf3', 'Nc6']);
		expect(s.transpositionExists).toBe(true);
	});

	it('does not flag a transposition on a single move order', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5']), 'e4,e5');
		expect(s.transpositionExists).toBe(false);
	});

	it('recognises the custom start position', () => {
		const start = fenAfter('e4', 'e5');
		const { s } = setup({ startFen: start });
		s.syncFromData(movesFor(['e4', 'e5']));
		expect(s.isStartPosition).toBe(false);
		s.navigateToLine(['e4', 'e5']);
		expect(s.isStartPosition).toBe(true);
	});
});

describe('deleting moves', () => {
	it('counts the follow-up moves of a pending delete', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5', 'Nf3'], ['e4', 'c5']));
		s.confirmDelete(s.moves[0]);
		expect(s.pendingDeleteSubtreeCount).toBe(3);
		s.cancelDelete();
		expect(s.pendingDelete).toBeNull();
	});

	it('removes the move and everything after it, then steps back', async () => {
		const { s } = setup();
		const moves = movesFor(['e4', 'e5', 'Nf3'], ['d4']);
		s.syncFromData(moves, 'e4,e5,Nf3');

		s.confirmDelete(moves[1]); // e5
		await s.executePendingDelete();

		expect(fetchMock).toHaveBeenCalledWith(`/api/moves/${moves[1].id}`, { method: 'DELETE' });
		expect(s.moves.map((m) => m.san)).toEqual(['e4', 'd4']);
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
		expect(fenKey(s.currentFen)).toBe(fenKey(fenAfter('e4')));
	});

	it('keeps everything when the delete fails', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		fetchMock.mockResolvedValue(jsonResponse({}, 500));
		s.confirmDelete(s.moves[0]);
		await s.executePendingDelete();
		expect(s.moves).toHaveLength(1);
		expect(s.errorMsg).toBe('Failed to delete move. Please try again.');
	});
});

describe('explore mode', () => {
	it('plays moves without saving them', async () => {
		const { s } = setup();
		s.syncFromData([]);
		s.toggleExploreMode();
		await play(s, 'e4');
		await play(s, 'e5');

		expect(fetchMock).not.toHaveBeenCalled();
		expect(s.navHistory).toHaveLength(2);
		expect(s.hasUnsavedExploreMoves).toBe(true);
		expect(s.isExploreNavEntry(0)).toBe(true);
	});

	it('trims unsaved moves when leaving', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		s.toggleExploreMode();
		await play(s, 'e4');
		await play(s, 'c5');
		s.toggleExploreMode();

		expect(s.exploreMode).toBe(false);
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
		expect(fenKey(s.currentFen)).toBe(fenKey(fenAfter('e4')));
	});

	it('saves only the unsaved moves of the line and keeps the position', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		s.toggleExploreMode();
		await play(s, 'e4');
		await play(s, 'c5');
		fetchMock.mockImplementation(serverSavesMoves());
		await s.saveExploreLine();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).san).toBe('c5');
		expect(s.exploreMode).toBe(false);
		expect(s.moves.map((m) => m.san)).toEqual(['e4', 'c5']);
		expect(fenKey(s.currentFen)).toBe(fenKey(fenAfter('e4', 'c5')));
	});

	it('stays in explore mode when the line conflicts', async () => {
		const { s } = setup();
		s.syncFromData([]);
		s.toggleExploreMode();
		await play(s, 'd4');
		fetchMock.mockResolvedValue(jsonResponse({ existing: { san: 'e4' } }, 409));
		await s.saveExploreLine();

		expect(s.exploreMode).toBe(true);
		expect(s.errorMsg).toBe('Could not save line: you already have e4 at one of the positions.');
	});
});

describe('jump line saving', () => {
	it('saves the jump line moves missing from the repertoire', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']), 'e4,c5,Nf3');
		fetchMock.mockImplementation(serverSavesMoves());
		await s.saveJumpLineMoves();

		const saved = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).san);
		expect(saved).toEqual(['c5', 'Nf3']);
		expect(s.moves.map((m) => m.san)).toEqual(['e4', 'c5', 'Nf3']);
	});
});

describe('annotations', () => {
	it('opens with the existing notes and saves trimmed text', async () => {
		const { s } = setup();
		const [e4] = movesFor(['e4']);
		e4.notes = 'King pawn';
		s.syncFromData([e4]);

		s.openAnnotation(s.moves[0]);
		expect(s.annotationDraft).toBe('King pawn');
		s.annotationDraft = '  Best by test  ';
		fetchMock.mockResolvedValue(jsonResponse({ ...e4, notes: 'Best by test' }));
		await s.saveAnnotation();

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ notes: 'Best by test' });
		expect(s.moves[0].notes).toBe('Best by test');
		expect(s.annotatingMove).toBeNull();
	});

	it('clears notes when the draft is blank', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		s.openAnnotation(s.moves[0]);
		s.annotationDraft = '   ';
		fetchMock.mockResolvedValue(jsonResponse({ ...s.moves[0], notes: null }));
		await s.saveAnnotation();
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ notes: null });
	});

	it("shows the server's error and stays open", async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']));
		s.openAnnotation(s.moves[0]);
		fetchMock.mockResolvedValue(jsonResponse({ message: 'Too long' }, 400));
		await s.saveAnnotation();
		expect(s.annotationError).toBe('Too long');
		expect(s.annotatingMove).not.toBeNull();
	});

	it('annotateLastMove opens the last move of the line', () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4', 'e5']), 'e4,e5');
		s.annotateLastMove();
		expect(s.annotatingMove?.san).toBe('e5');
	});
});

describe('start position', () => {
	it('sets the current position as the start', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']), 'e4');
		await s.setStartPosition();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/repertoires/1',
			expect.objectContaining({ method: 'PATCH' })
		);
		expect(s.startFen).toBe(s.currentFen);
		expect(s.isStartPosition).toBe(true);
	});

	it('clears the start', async () => {
		const { s } = setup({ startFen: fenAfter('e4') });
		s.syncFromData(movesFor(['e4']));
		await s.clearStartPosition();
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ startFen: null });
		expect(s.startFen).toBeNull();
	});

	it('keeps the start when the request fails', async () => {
		const { s } = setup();
		s.syncFromData(movesFor(['e4']), 'e4');
		fetchMock.mockResolvedValue(jsonResponse({}, 500));
		await s.setStartPosition();
		expect(s.startFen).toBeNull();
		expect(s.errorMsg).toBe('Failed to set start position.');
	});
});
