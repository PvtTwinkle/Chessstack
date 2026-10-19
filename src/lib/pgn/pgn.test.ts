import { describe, expect, it } from 'vitest';
import { countPgnGames, parseVariationPgn } from './parseVariations';
import { exportRepertoirePgn, type ExportMove } from './exportPgn';
import { computeMatchDepth, formatOpeningMoves, parsePgn } from './index';
import { fenKey, sanitizeFen, toFullFen, STARTING_FEN } from '$lib/fen';

const RUY_WITH_SIDELINES = `1. e4 e5 2. Nf3 Nc6 (2... d6 {Philidor} 3. d4) 3. Bb5 a6 (3... Nf6 4. O-O) 4. Ba4`;

function edgeSet(edges: { fromFen: string; san: string; toFen: string }[]) {
	return new Set(edges.map((e) => `${e.fromFen}|${e.san}|${e.toFen}`));
}

describe('parseVariationPgn', () => {
	it('extracts mainline and nested variations as FEN-keyed edges', () => {
		const { edges, errors } = parseVariationPgn(RUY_WITH_SIDELINES, 'WHITE');
		expect(errors).toEqual([]);
		// 7 mainline plies + 2 in the Philidor line + 2 in the Berlin line
		expect(edges).toHaveLength(11);
		expect(edges[0]).toMatchObject({ fromFen: STARTING_FEN, san: 'e4', isUserTurn: true });
		const philidor = edges.find((e) => e.san === 'd6');
		expect(philidor?.annotation).toBe('Philidor');
		expect(philidor?.isUserTurn).toBe(false);
	});

	it('rejects empty input and custom start positions', () => {
		expect(() => parseVariationPgn('   ', 'WHITE')).toThrow(/empty/);
		expect(() =>
			parseVariationPgn('[SetUp "1"]\n[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n1. Kb1', 'WHITE')
		).toThrow(/Custom starting positions/);
	});

	it('reports an illegal move in a variation without discarding the rest', () => {
		const { edges, errors } = parseVariationPgn('1. e4 e5 (1... Qxh7) 2. Nf3', 'WHITE');
		expect(errors.length).toBeGreaterThan(0);
		expect(edges.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3']);
	});

	it('replays every game of a multi-game file from the start', () => {
		const pgn = `[Event "Study: Chapter 1"]\n\n1. e4 e5 2. Nf3 *\n\n[Event "Study: Chapter 2"]\n\n1. d4 d5 *`;
		const { edges, errors } = parseVariationPgn(pgn, 'WHITE');
		expect(errors).toEqual([]);
		expect(edges.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3', 'd4', 'd5']);
		expect(edges.find((e) => e.san === 'd4')?.fromFen).toBe(STARTING_FEN);
	});

	it('splits games at a header block even without a result marker', () => {
		const pgn = `[Event "A"]\n1. e4 e5\n\n[Event "B"]\n1. c4 e5`;
		const { edges, errors } = parseVariationPgn(pgn, 'WHITE');
		expect(errors).toEqual([]);
		expect(edges.map((e) => e.san)).toEqual(['e4', 'e5', 'c4', 'e5']);
	});

	it('keeps a header whose value contains a closing bracket', () => {
		const pgn = `[Event "Club [A] champs"]\n[Site "?"]\n\n1. e4 e5 *`;
		const { edges, errors } = parseVariationPgn(pgn, 'WHITE');
		expect(errors).toEqual([]);
		expect(edges.map((e) => e.san)).toEqual(['e4', 'e5']);
	});

	it('keeps square brackets inside a comment', () => {
		const { edges } = parseVariationPgn('1. e4 {see [note]} e5', 'WHITE');
		expect(edges[0].annotation).toBe('see [note]');
	});

	it("reports a stray ')' and keeps the moves after it", () => {
		const { edges, errors } = parseVariationPgn('1. e4 e5 ) 2. Nf3 Nc6', 'WHITE');
		expect(edges.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
		expect(errors).toEqual(["Unmatched ')' ignored"]);
	});
});

describe('countPgnGames', () => {
	it('counts games with moves', () => {
		expect(countPgnGames('1. e4 e5 *')).toBe(1);
		expect(countPgnGames('[Event "x"]\n1. e4 *\n[Event "y"]\n1. d4 *')).toBe(2);
		expect(countPgnGames('[Event "x"]\n1. e4 e5 1-0')).toBe(1);
	});
});

describe('parsePgn', () => {
	it('asks for one game at a time when several are pasted', () => {
		expect(() => parsePgn('[Event "x"]\n1. e4 e5 *\n\n[Event "y"]\n1. d4 d5 *')).toThrow(
			/one game at a time/
		);
	});

	it('still parses a single game with clock comments', () => {
		const game = parsePgn('[Event "x"]\n\n1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 1-0');
		expect(game.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
	});
});

describe('formatOpeningMoves', () => {
	it('numbers the first plies', () => {
		const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'].map((san) => ({ san }));
		expect(formatOpeningMoves(moves)).toBe('1. e4 e5 2. Nf3 Nc6');
		expect(formatOpeningMoves([])).toBe('(empty game)');
	});
});

describe('exportRepertoirePgn', () => {
	it('round-trips through parseVariationPgn without losing moves or notes', () => {
		const { edges } = parseVariationPgn(RUY_WITH_SIDELINES, 'WHITE');
		const moves: ExportMove[] = edges.map((e, i) => ({
			fromFen: e.fromFen,
			toFen: e.toFen,
			san: e.san,
			notes: e.annotation,
			createdAt: i
		}));
		const pgn = exportRepertoirePgn({ repertoireName: 'Ruy', repertoireColor: 'WHITE', moves });
		expect(pgn).toContain('[White "Ruy"]');

		const reparsed = parseVariationPgn(pgn, 'WHITE');
		expect(reparsed.errors).toEqual([]);
		expect(edgeSet(reparsed.edges)).toEqual(edgeSet(edges));
		expect(reparsed.edges.find((e) => e.san === 'd6')?.annotation).toBe('Philidor');
	});
});

describe('parsePgn + computeMatchDepth', () => {
	const repertoire = parseVariationPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5', 'WHITE').edges;

	it('counts consecutive plies covered by the repertoire', () => {
		const game = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *');
		expect(computeMatchDepth(game.moves, repertoire, 'WHITE')).toBe(5);
	});

	it('stops at an opponent surprise', () => {
		const game = parsePgn('1. e4 c5 2. Nf3 *');
		expect(computeMatchDepth(game.moves, repertoire, 'WHITE')).toBe(1);
	});

	it('stops when the user deviates', () => {
		const game = parsePgn('1. e4 e5 2. Bc4 *');
		expect(computeMatchDepth(game.moves, repertoire, 'WHITE')).toBe(2);
	});

	it('returns 0 for a different first move', () => {
		const game = parsePgn('1. d4 d5 *');
		expect(computeMatchDepth(game.moves, repertoire, 'WHITE')).toBe(0);
	});
});

describe('fen helpers', () => {
	it('fenKey drops move counters so transpositions compare equal', () => {
		expect(fenKey(`${STARTING_FEN} 0 1`)).toBe(STARTING_FEN);
		expect(fenKey(STARTING_FEN)).toBe(STARTING_FEN);
	});

	it('toFullFen only appends counters to 4-field FENs', () => {
		expect(toFullFen(STARTING_FEN)).toBe(`${STARTING_FEN} 0 1`);
		expect(toFullFen(`${STARTING_FEN} 3 9`)).toBe(`${STARTING_FEN} 3 9`);
	});

	it('sanitizeFen rejects non-strings, empty and oversized input', () => {
		expect(sanitizeFen(`  ${STARTING_FEN}  `)).toBe(STARTING_FEN);
		expect(sanitizeFen(42)).toBeNull();
		expect(sanitizeFen('   ')).toBeNull();
		expect(sanitizeFen('x'.repeat(101))).toBeNull();
	});
});
