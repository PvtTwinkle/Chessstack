import { describe, expect, it } from 'vitest';
import { parseVariationPgn } from './parseVariations';
import { exportRepertoirePgn, type ExportMove } from './exportPgn';
import { computeMatchDepth, parsePgn } from './index';
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
