import { describe, expect, it } from 'vitest';
import { gameAnalysis } from '$lib/test/review-game';
import {
	analysisCutoffPly,
	buildChainLeg,
	findUserMove,
	issuesByPly,
	moveColor,
	playedMoveIsBetter,
	reviewBoardShapes,
	type ChainLeg
} from './analysis';

// 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 — White is the reviewing player.
const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'];

describe('buildChainLeg', () => {
	const game = gameAnalysis(ITALIAN);
	const noRepertoire = () => undefined;

	it('pairs the opponent move at the ply with the user reply after it', () => {
		expect(buildChainLeg(game, 6, noRepertoire)).toEqual({
			opponentFen: game.fenHistory[5],
			opponentSan: 'Bc5',
			opponentAdded: false,
			userFen: game.fenHistory[6],
			userSan: 'c3',
			plyInGame: 6,
			transposition: null
		});
	});

	it('returns null past the end of the game', () => {
		expect(buildChainLeg(game, 8, noRepertoire)).toBeNull();
	});

	it('leaves the user reply empty when the game ends on the opponent move', () => {
		const leg = buildChainLeg(gameAnalysis(ITALIAN.slice(0, 6)), 6, noRepertoire);
		expect(leg?.userFen).toBe(game.fenHistory[6]);
		expect(leg?.userSan).toBeNull();
		expect(leg?.transposition).toBeNull();
	});

	it('flags a transposition when the reply position is already in the repertoire', () => {
		const book = (fen: string) => (fen === game.fenHistory[6] ? 'O-O' : undefined);
		expect(buildChainLeg(game, 6, book)?.transposition).toEqual({
			existingSan: 'O-O',
			userPlayedCorrect: false
		});
		const sameMove = (fen: string) => (fen === game.fenHistory[6] ? 'c3' : undefined);
		expect(buildChainLeg(game, 6, sameMove)?.transposition).toEqual({
			existingSan: 'c3',
			userPlayedCorrect: true
		});
	});
});

describe('findUserMove', () => {
	const game = gameAnalysis(ITALIAN);
	const moves = [
		{ repertoireId: 1, fromFen: game.fenHistory[0], san: 'e4' }, // White to move
		{ repertoireId: 1, fromFen: game.fenHistory[1], san: 'e5' }, // Black to move
		{ repertoireId: 2, fromFen: game.fenHistory[2], san: 'Nc3' } // other repertoire
	];

	it('finds the move for the player to move in that repertoire', () => {
		expect(findUserMove(moves, 1, 'WHITE', game.fenHistory[0])).toBe('e4');
		expect(findUserMove(moves, 1, 'BLACK', game.fenHistory[1])).toBe('e5');
	});

	it("ignores the opponent's moves and other repertoires", () => {
		expect(findUserMove(moves, 1, 'WHITE', game.fenHistory[1])).toBeUndefined();
		expect(findUserMove(moves, 1, 'WHITE', game.fenHistory[2])).toBeUndefined();
	});

	it('matches positions regardless of the move counters', () => {
		const withOtherCounters = game.fenHistory[0].replace(/ 0 1$/, ' 4 9');
		expect(findUserMove(moves, 1, 'WHITE', withOtherCounters)).toBe('e4');
	});
});

describe('analysisCutoffPly', () => {
	it('never cuts off a clean game', () => {
		expect(analysisCutoffPly(null)).toBe(Number.MAX_SAFE_INTEGER);
		expect(analysisCutoffPly(gameAnalysis(ITALIAN))).toBe(Number.MAX_SAFE_INTEGER);
	});

	it('stops at the last issue, including the reply to an opponent surprise', () => {
		expect(analysisCutoffPly(gameAnalysis(ITALIAN, [{ type: 'DEVIATION', ply: 3 }]))).toBe(3);
		expect(analysisCutoffPly(gameAnalysis(ITALIAN, [{ type: 'OPPONENT_SURPRISE', ply: 4 }]))).toBe(
			5
		);
	});
});

describe('moveColor', () => {
	const game = gameAnalysis(ITALIAN, [
		{ type: 'DEVIATION', ply: 3 },
		{ type: 'OPPONENT_SURPRISE', ply: 4 }
	]);
	const byPly = issuesByPly(game);
	const cutoff = analysisCutoffPly(game); // 5
	const noEvals = new Map();

	it('colours issue moves by type', () => {
		expect(moveColor(3, 'WHITE', noEvals, byPly, cutoff)).toBe('var(--color-accent-dim)');
		expect(moveColor(4, 'WHITE', noEvals, byPly, cutoff)).toBe('var(--color-danger)');
	});

	it('dims moves past the cutoff and colours book moves by side', () => {
		expect(moveColor(1, 'WHITE', noEvals, byPly, cutoff)).toBe('var(--color-success)');
		expect(moveColor(2, 'WHITE', noEvals, byPly, cutoff)).toBe('var(--color-text-secondary)');
		expect(moveColor(6, 'WHITE', noEvals, byPly, cutoff)).toBe('var(--color-text-muted)');
	});

	it("prefers the engine's classification for the user's moves", () => {
		const evals = new Map([
			[2, { evalCp: 30, evalMate: null }],
			[3, { evalCp: -300, evalMate: null }]
		]);
		expect(moveColor(3, 'WHITE', evals, byPly, cutoff)).toBe('var(--color-eval-blunder)');
		// The opponent's moves are never engine-coloured.
		expect(moveColor(4, 'BLACK', evals, byPly, cutoff)).toBe('var(--color-danger)');
	});
});

describe('reviewBoardShapes', () => {
	const base = {
		currentPlyIdx: 0,
		resolvedIssues: new Set<number>(),
		chainExtensions: new Map<number, ChainLeg>(),
		hoveredFen: null,
		hoveredSan: null
	};

	it('draws nothing without an analysis', () => {
		expect(reviewBoardShapes({ ...base, analysis: null })).toEqual([]);
	});

	it('shows the wrong move in red and the book move in green on a deviation', () => {
		// 2. Bc4 instead of the book 2. Nf3.
		const game = gameAnalysis(
			['e4', 'e5', 'Bc4'],
			[{ type: 'DEVIATION', ply: 3, repertoireSan: 'Nf3' }]
		);
		expect(reviewBoardShapes({ ...base, analysis: game, currentPlyIdx: 3 })).toEqual([
			{ orig: 'f1', dest: 'c4', brush: 'red' },
			{ orig: 'g1', dest: 'f3', brush: 'green' }
		]);
	});

	it("shows a pending chain leg's opponent move in red", () => {
		const game = gameAnalysis(ITALIAN, [{ type: 'BEYOND_REPERTOIRE', ply: 5 }]);
		const leg = buildChainLeg(game, 6, () => undefined)!;
		const shapes = reviewBoardShapes({
			...base,
			analysis: game,
			currentPlyIdx: 5,
			chainExtensions: new Map([[5, leg]])
		});
		expect(shapes).toEqual([{ orig: 'f8', dest: 'c5', brush: 'red' }]);
		// Not once the issue is resolved.
		expect(
			reviewBoardShapes({
				...base,
				analysis: game,
				currentPlyIdx: 5,
				chainExtensions: new Map([[5, leg]]),
				resolvedIssues: new Set([5])
			})
		).toEqual([]);
	});

	it('shows the hovered candidate in blue', () => {
		const game = gameAnalysis(ITALIAN);
		expect(
			reviewBoardShapes({
				...base,
				analysis: game,
				hoveredFen: game.fenHistory[0],
				hoveredSan: 'd4'
			})
		).toEqual([{ orig: 'd2', dest: 'd4', brush: 'blue' }]);
	});
});

describe('playedMoveIsBetter', () => {
	it('compares the evals from the player side', () => {
		expect(playedMoveIsBetter({ played: 50, correct: 20 }, 'WHITE')).toBe(true);
		expect(playedMoveIsBetter({ played: 50, correct: 20 }, 'BLACK')).toBe(false);
		expect(playedMoveIsBetter({ played: -50, correct: -20 }, 'BLACK')).toBe(true);
	});

	it('is false until both evals are in', () => {
		expect(playedMoveIsBetter(undefined, 'WHITE')).toBe(false);
		expect(playedMoveIsBetter({ played: 50, correct: null }, 'WHITE')).toBe(false);
	});
});
