import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { createDrillState, type DrillState } from './drillState.svelte';
import { tutorialStep } from '$lib/stores/tutorial';
import { STARTING_FEN } from '$lib/fen';
import { parseVariationPgn } from '$lib/pgn/parseVariations';
import type { DueCard, RepertoireMove } from '$lib/drill/types';

vi.mock('$lib/sounds', () => ({
	playMove: vi.fn(),
	playCapture: vi.fn(),
	playCorrect: vi.fn(),
	playIncorrect: vi.fn()
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUY =
	'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O ' +
	'9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1 Bf8 14. Ng3 g6 15. a4 c5 ' +
	'16. d5 c4 17. Bg5 h6';

function movesFrom(pgn: string, color: 'WHITE' | 'BLACK' = 'WHITE'): RepertoireMove[] {
	return parseVariationPgn(pgn, color).edges.map((e, i) => ({
		id: i + 1,
		fromFen: e.fromFen,
		toFen: e.toFen,
		san: e.san,
		notes: null
	}));
}

let nextCardId = 100;
function cardFor(moves: RepertoireMove[], san: string): DueCard {
	const move = moves.find((m) => m.san === san)!;
	return {
		id: nextCardId++,
		fromFen: move.fromFen,
		san,
		state: 2,
		due: '2026-10-01T00:00:00.000Z',
		stability: 4.5,
		difficulty: 5,
		elapsedDays: 3,
		scheduledDays: 4,
		reps: 2,
		lapses: 0,
		lastReview: '2026-09-28T00:00:00.000Z',
		learningSteps: 0,
		intervalLabels: { forgot: '1m', unsure: '2d', easy: '9d' }
	};
}

// Answer every drill API call the way the server does.
function mockFetch() {
	return vi.fn(async (url: string, init?: RequestInit) => {
		const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
		if (url === '/api/drill/session' && init?.method === 'POST') return json({ sessionId: 7 });
		if (url === '/api/drill/session/7') return json({ nextDueAt: '2026-10-05T09:00:00.000Z' });
		return json({ success: true });
	});
}

function setup(opts: { moves?: RepertoireMove[]; cards?: DueCard[]; color?: string } = {}) {
	const moves = opts.moves ?? movesFrom(RUY);
	const cards = opts.cards ?? [cardFor(moves, 'e4'), cardFor(moves, 'Nf3')];
	const reload = vi.fn(async () => {});
	const s = createDrillState({
		getRepertoireId: () => 3,
		getRepertoireColor: () => opts.color ?? 'WHITE',
		reload
	});
	s.syncFromData({ moves, dueCards: cards, settings: { playbackSpeed: 100 } });
	s.restartFromData();
	return { s, moves, cards, reload };
}

// Play a move on the board the way ChessBoard reports it.
function play(s: DrillState, san: string) {
	const chess = new Chess(s.currentFen);
	const result = chess.move(san);
	s.handleMove(result.from, result.to, result.san, chess.fen(), !!result.captured);
}

// Let auto-play finish and hand the board to the user.
function finishAutoPlay() {
	vi.runAllTimers();
}

// A wrong move that is legal from any position the tests reach.
function playWrong(s: DrillState) {
	const chess = new Chess(s.currentFen);
	const target = s.currentCard?.san ?? s.currentLine[s.lineStepIdx].san;
	const other = chess.moves().find((m) => m !== target)!;
	play(s, other);
}

let fetchMock: ReturnType<typeof mockFetch>;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = mockFetch();
	vi.stubGlobal('fetch', fetchMock);
	tutorialStep.set(null);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loading and sections', () => {
	it('applies settings from the server data and waits on the start screen', () => {
		const { s } = setup();
		expect(s.started).toBe(false);
		expect(s.phase).toBe('idle');
		expect(s.playbackSpeed).toBe(100);
		expect(s.soundEnabled).toBe(true);
		expect(s.tempoEnabled).toBe(false);
		expect(s.filteredCards).toHaveLength(2);
	});

	it('counts and filters due cards by depth section', () => {
		const moves = movesFrom(RUY);
		const cards = ['e4', 'Bb5', 'Re1', 'a4', 'd5'].map((san) => cardFor(moves, san));
		const { s } = setup({ moves, cards });

		expect(s.sectionCounts).toEqual({ foundations: 2, mainlines: 2, deep: 1 });

		s.setSection('mainlines');
		expect(s.selectedSection).toBe('mainlines');
		expect(s.filteredCards.map((c) => c.san)).toEqual(['Re1', 'a4']);

		s.setSection('deep');
		expect(s.filteredCards.map((c) => c.san)).toEqual(['d5']);
	});

	it('restarts the drill on the new section once started', () => {
		const moves = movesFrom(RUY);
		const { s } = setup({ moves, cards: [cardFor(moves, 'e4'), cardFor(moves, 'Re1')] });
		s.startDrilling();
		expect(s.currentCard?.san).toBe('e4');

		s.setSection('mainlines');
		expect(s.currentCard?.san).toBe('Re1');
		expect(s.phase).toBe('playing');
	});
});

describe('card mode', () => {
	it('goes straight to the user when the card is the first move', () => {
		const { s } = setup();
		s.startDrilling();
		expect(s.currentCard?.san).toBe('e4');
		expect(s.phase).toBe('waiting');
		expect(s.currentFen).toBe(STARTING_FEN);
	});

	it('auto-plays the path to the due position at the playback speed', () => {
		const moves = movesFrom(RUY);
		const { s } = setup({ moves, cards: [cardFor(moves, 'Bb5')] });
		s.startDrilling();
		expect(s.phase).toBe('playing');

		vi.advanceTimersByTime(100);
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
		expect(s.lastMove).toEqual(['e2', 'e4']);

		vi.advanceTimersByTime(300);
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
		expect(s.phase).toBe('playing');

		vi.advanceTimersByTime(100);
		expect(s.phase).toBe('waiting');
		expect(s.fenHistory[0]).toBe(s.navHistory[3].fromFen);
	});

	it('grades a correct move, creates the session once and allows undo', async () => {
		const { s, cards } = setup();
		s.startDrilling();
		play(s, 'e4');

		expect(s.phase).toBe('correct');
		expect(s.flashColor).toBe('green');
		vi.advanceTimersByTime(600);
		expect(s.flashColor).toBeNull();

		await s.submitGrade(3);
		expect(s.sessionId).toBe(7);
		expect(bodyOf(callsTo('/api/drill/session')[0])).toEqual({ repertoireId: 3 });
		expect(bodyOf(callsTo('/api/drill/grade')[0])).toEqual({ cardId: cards[0].id, rating: 3 });
		expect(s.totalReviewed).toBe(1);
		expect(s.correctCount).toBe(1);
		expect(s.awaitingNext).toBe(true);
		expect(s.undoSnapshot?.cardId).toBe(cards[0].id);
		expect(s.undoSnapshot?.previousState.stability).toBe(4.5);

		await s.undoLastGrade();
		expect(bodyOf(callsTo('/api/drill/undo')[0]).cardId).toBe(cards[0].id);
		expect(s.totalReviewed).toBe(0);
		expect(s.correctCount).toBe(0);
		expect(s.awaitingNext).toBe(false);
		expect(s.undoSnapshot).toBeNull();

		// Grading again reuses the session.
		await s.submitGrade(4);
		expect(callsTo('/api/drill/session')).toHaveLength(1);
	});

	it('reveals the right move on a wrong one and grades it Again on Next', async () => {
		const { s, cards } = setup();
		s.startDrilling();
		const keyBefore = s.boardKey;
		playWrong(s);

		expect(s.phase).toBe('incorrect');
		expect(s.flashColor).toBe('red');
		expect(s.revealedSan).toBe('e4');
		expect(s.boardKey).toBe(keyBefore + 1);
		expect(s.boardShapes).toEqual([{ orig: 'e2', dest: 'e4', brush: 'green' }]);

		await s.handleNext();
		expect(bodyOf(callsTo('/api/drill/grade')[0])).toEqual({ cardId: cards[0].id, rating: 1 });
		expect(s.totalReviewed).toBe(1);
		expect(s.correctCount).toBe(0);
		expect(s.undoSnapshot).toBeNull();
		expect(s.currentCard?.san).toBe('Nf3');
		expect(s.phase).toBe('playing');
		expect(s.revealedSan).toBeNull();
	});

	it('finalizes the session after the last card and shows the next due date', async () => {
		const { s } = setup();
		s.startDrilling();
		play(s, 'e4');
		await s.submitGrade(3);
		await s.handleNext();

		finishAutoPlay();
		play(s, 'Nf3');
		await s.submitGrade(4);
		await s.handleNext();

		expect(s.phase).toBe('complete');
		expect(bodyOf(callsTo('/api/drill/session/7')[0])).toEqual({
			cardsReviewed: 2,
			cardsCorrect: 2
		});
		expect(s.nextDueAt).toBe('2026-10-05T09:00:00.000Z');
		expect(s.progress).toBe(1);
	});

	it('marks the hint square and skips the undo snapshot for a hinted card', async () => {
		const { s } = setup();
		s.startDrilling();
		s.showHint();
		expect(s.hintUsed).toBe(true);
		expect(s.hintSquare).toBe('e2');
		expect(s.boardShapes).toEqual([{ orig: 'e2', brush: 'yellow' }]);

		play(s, 'e4');
		expect(s.phase).toBe('correct');
		await s.handleNext();
		expect(bodyOf(callsTo('/api/drill/grade')[0]).rating).toBe(1);
		expect(s.correctCount).toBe(1);
		expect(s.undoSnapshot).toBeNull();
	});

	it('only gives a hint while waiting for the user', () => {
		const moves = movesFrom(RUY);
		const { s } = setup({ moves, cards: [cardFor(moves, 'Nf3')] });
		s.startDrilling();
		s.showHint();
		expect(s.hintUsed).toBe(false);
	});

	it('ignores board moves outside the waiting phase', () => {
		const moves = movesFrom(RUY);
		const { s } = setup({ moves, cards: [cardFor(moves, 'Nf3')] });
		s.startDrilling();
		s.handleMove('e2', 'e4', 'e4', STARTING_FEN, false);
		expect(s.phase).toBe('playing');
	});

	it('shows the notes on the previous move and on the card move', () => {
		const moves = movesFrom(RUY);
		moves.find((m) => m.san === 'e5')!.notes = 'Black mirrors.';
		moves.find((m) => m.san === 'Nf3')!.notes = 'Attack e5.';
		const { s } = setup({ moves, cards: [cardFor(moves, 'Nf3')] });
		s.startDrilling();
		expect(s.currentPositionNote).toBe('Black mirrors.');
		expect(s.currentMoveNote).toBe('Attack e5.');
	});
});

describe('tempo timer', () => {
	it('counts down and treats a timeout as a wrong move', () => {
		const moves = movesFrom(RUY);
		const { s } = setup({ moves, cards: [cardFor(moves, 'e4')] });
		s.syncFromData({
			moves,
			dueCards: s.allDueCards,
			settings: { tempoEnabled: true, tempoSeconds: 2 }
		});
		s.startDrilling();
		s.startTempoTimer();

		vi.advanceTimersByTime(1000);
		expect(s.tempoRemaining).toBe(1);
		expect(s.tempoFraction).toBeCloseTo(0.5);

		vi.advanceTimersByTime(1000);
		expect(s.phase).toBe('incorrect');
		expect(s.revealedSan).toBe('e4');
	});

	it('does nothing when tempo is off', () => {
		const { s } = setup();
		s.startDrilling();
		s.startTempoTimer();
		vi.advanceTimersByTime(20_000);
		expect(s.phase).toBe('waiting');
	});
});

describe('keyboard shortcuts', () => {
	const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
		key: k,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		preventDefault: vi.fn(),
		...mods
	});

	it('starts drilling with Space and grades with 1/2/3', async () => {
		const { s, cards } = setup();
		s.handleShortcut(key(' '));
		expect(s.started).toBe(true);

		play(s, 'e4');
		s.handleShortcut(key('2'));
		await vi.waitFor(() => expect(s.awaitingNext).toBe(true));
		expect(bodyOf(callsTo('/api/drill/grade')[0])).toEqual({ cardId: cards[0].id, rating: 3 });
	});

	it('undoes with z or Ctrl+Z and moves on with Enter', async () => {
		const { s } = setup();
		s.startDrilling();
		play(s, 'e4');
		await s.submitGrade(4);

		s.handleShortcut(key('z', { ctrlKey: true }));
		await vi.waitFor(() => expect(s.awaitingNext).toBe(false));

		await s.submitGrade(3);
		s.handleShortcut(key('z'));
		await vi.waitFor(() => expect(s.awaitingNext).toBe(false));

		await s.submitGrade(3);
		s.handleShortcut(key('Enter'));
		await vi.waitFor(() => expect(s.currentCard?.san).toBe('Nf3'));
	});

	it('ignores other keys with modifiers', () => {
		const { s } = setup();
		s.handleShortcut(key(' ', { altKey: true }));
		expect(s.started).toBe(false);
	});
});

describe('line mode', () => {
	function lineSetup() {
		const moves = movesFrom('1. e4 e5 2. Nf3 Nc6');
		return setup({ moves, cards: [cardFor(moves, 'e4'), cardFor(moves, 'Nf3')] });
	}

	it('plays a whole line, auto-grading each user move', async () => {
		const { s, cards } = lineSetup();
		s.switchDrillType('line');
		s.startDrilling();
		expect(s.allLines).toHaveLength(1);
		expect(s.lineTotal).toBe(2);

		finishAutoPlay();
		expect(s.phase).toBe('waiting');
		expect(s.lineStepIdx).toBe(0);

		play(s, 'e4');
		expect(s.lineCorrect).toBe(1);
		await vi.waitFor(() => expect(s.sessionId).toBe(7));
		expect(bodyOf(callsTo('/api/drill/grade')[0])).toEqual({ cardId: cards[0].id, rating: 3 });

		finishAutoPlay();
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4', 'e5']);
		expect(s.phase).toBe('waiting');

		play(s, 'Nf3');
		finishAutoPlay();
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
		expect(s.lineComplete).toBe(true);
		expect(s.totalReviewed).toBe(2);
		expect(s.correctCount).toBe(2);

		await s.advanceToNextLine();
		expect(s.phase).toBe('complete');
		expect(s.nextDueAt).toBe('2026-10-05T09:00:00.000Z');
	});

	it('shows and then plays the right move after a wrong one', () => {
		const { s } = lineSetup();
		s.switchDrillType('line');
		s.startDrilling();
		finishAutoPlay();

		playWrong(s);
		expect(s.revealedSan).toBe('e4');
		expect(s.flashColor).toBe('red');
		expect(s.correctCount).toBe(0);
		expect(s.totalReviewed).toBe(1);

		vi.advanceTimersByTime(1500);
		expect(s.revealedSan).toBeNull();
		expect(s.navHistory.map((e) => e.san)).toEqual(['e4']);
		expect(s.phase).toBe('playing');
	});

	it('switches back to card mode with a fresh session', () => {
		const { s } = lineSetup();
		s.startDrilling();
		s.switchDrillType('line');
		expect(s.drillType).toBe('line');
		s.switchDrillType('card');
		expect(s.currentCard?.san).toBe('e4');
		expect(s.totalReviewed).toBe(0);
	});

	it('completes at once when the repertoire has no lines', () => {
		const { s } = setup({ moves: [], cards: [] });
		s.switchDrillType('line');
		s.startDrilling();
		expect(s.phase).toBe('complete');
	});
});

describe('blindfold', () => {
	it('announces auto-played moves only while enabled', () => {
		const moves = movesFrom(RUY);
		const { s } = setup({ moves, cards: [cardFor(moves, 'Nf3')] });
		s.toggleBlindfold();
		s.startDrilling();
		vi.advanceTimersByTime(100);
		expect(s.blindfoldAnnouncement).toBe('e4');

		s.toggleBlindfold();
		expect(s.blindfoldEnabled).toBe(false);
		expect(s.blindfoldAnnouncement).toBeNull();
	});
});

describe('session and settings', () => {
	it('restarts by reloading the server data', () => {
		const { s, reload } = setup();
		s.restartSession();
		expect(s.phase).toBe('idle');
		expect(reload).toHaveBeenCalledOnce();
	});

	it('resumes the drill when fresh data arrives mid-session', () => {
		const { s, moves } = setup();
		s.startDrilling();
		s.syncFromData({ moves, dueCards: [cardFor(moves, 'Nf3')], settings: null });
		s.restartFromData();
		expect(s.currentCard?.san).toBe('Nf3');
		expect(s.phase).toBe('playing');
	});

	it('persists the sound toggle', async () => {
		const { s } = setup();
		await s.toggleSound();
		expect(s.soundEnabled).toBe(false);
		expect(bodyOf(callsTo('/api/settings')[0])).toEqual({ soundEnabled: false });
	});

	it('advances the tutorial after two graded cards', async () => {
		tutorialStep.set(4);
		const { s, reload } = setup();
		s.startDrilling();
		play(s, 'e4');
		await s.submitGrade(3);
		expect(callsTo('/api/settings')).toHaveLength(0);

		await s.handleNext();
		finishAutoPlay();
		play(s, 'Nf3');
		await s.submitGrade(3);
		expect(bodyOf(callsTo('/api/settings')[0])).toEqual({ tutorialStep: 5 });
		await vi.waitFor(() => expect(reload).toHaveBeenCalled());
	});
});
