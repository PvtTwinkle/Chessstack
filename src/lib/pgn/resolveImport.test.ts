import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { fenKey } from '$lib/fen';
import { parseVariationPgn } from './parseVariations';
import { detectConflicts } from './detectConflicts';
import { linesToPgn } from './linesToPgn';
import { abandonedPositions, buildImportRequest, openConflicts } from './resolveImport';

const NAJDORF = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5'];
const DRAGON = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7'];
const ALAPIN = ['e4', 'c5', 'c3', 'Nf6'];

/** fenKey of the position after playing `line` from the start. */
function after(line: string[]): string {
	const chess = new Chess();
	for (const san of line) chess.move(san);
	return fenKey(chess.fen());
}

function preview(
	lines: string[][],
	color: 'WHITE' | 'BLACK',
	existing: { fromFen: string; san: string }[] = []
) {
	const { edges, errors } = parseVariationPgn(linesToPgn(lines), color);
	return detectConflicts(edges, existing, errors);
}

/** The moves a saved line puts in the repertoire. */
function saved(line: string[]) {
	return line.map((san, i) => ({ fromFen: after(line.slice(0, i)), san }));
}

describe('linesToPgn', () => {
	it('writes shared moves once and branches into variations', () => {
		expect(linesToPgn([['e4', 'c5', 'Nf3'], ['e4', 'e5'], ['d4']])).toBe(
			'1. e4 (1. d4) 1... c5 (1... e5) 2. Nf3'
		);
	});

	it('round-trips through the PGN import parser', () => {
		const { edges, errors } = parseVariationPgn(linesToPgn([NAJDORF, DRAGON, ALAPIN]), 'BLACK');
		expect(errors).toEqual([]);
		const keys = new Set(edges.map((e) => `${e.fromFen} ${e.san}`));
		for (const line of [NAJDORF, DRAGON, ALAPIN]) {
			for (const move of saved(line)) expect(keys).toContain(`${move.fromFen} ${move.san}`);
		}
	});

	it('returns an empty string for no lines', () => {
		expect(linesToPgn([])).toBe('');
	});
});

describe('resolving an import', () => {
	it('saves everything when nothing clashes', () => {
		const p = preview([NAJDORF, ALAPIN], 'BLACK');
		expect(p.conflicts).toEqual([]);
		expect(openConflicts(p, new Map())).toEqual([]);
		const { moves, replacements } = buildImportRequest(p, new Map());
		expect(moves).toHaveLength(NAJDORF.length + 2);
		expect(replacements).toEqual([]);
	});

	it('asks which of two lines to keep, and drops the rest of the other one', () => {
		const p = preview([NAJDORF, DRAGON], 'BLACK');
		const [conflict] = openConflicts(p, new Map());
		expect(conflict).toMatchObject({ source: 'PGN_INTERNAL', existingMove: null });
		expect(conflict.alternatives.sort()).toEqual(['a6', 'g6']);

		const resolved = new Map([[conflict.fromFen, 'a6']]);
		expect(openConflicts(p, resolved)).toEqual([]);
		expect(abandonedPositions(p, resolved)).toContain(after(DRAGON.slice(0, 10)));
		const { moves } = buildImportRequest(p, resolved);
		const sans = moves.map((m) => m.san);
		expect(sans).toContain('a6');
		expect(sans).toContain('e5');
		// The Dragon's 6.Be3 Bg7 can't be reached once 5...a6 is the move.
		expect(sans).not.toContain('g6');
		expect(sans).not.toContain('Bg7');
		expect(moves).toHaveLength(NAJDORF.length);
	});

	it('keeps a saved move, or replaces it, as the user chooses', () => {
		const p = preview([NAJDORF], 'BLACK', saved(DRAGON));
		const [conflict] = openConflicts(p, new Map());
		expect(conflict).toMatchObject({ source: 'REPERTOIRE_VS_PGN', existingMove: 'g6' });

		const keep = buildImportRequest(p, new Map([[conflict.fromFen, 'g6']]));
		// Keeping 5...g6 abandons the Najdorf's 6.Be3 e5 as well.
		expect(keep.moves.map((m) => m.san)).toEqual(['g6']);
		expect(keep.replacements).toEqual([]);

		const replace = buildImportRequest(p, new Map([[conflict.fromFen, 'a6']]));
		expect(replace.moves.map((m) => m.san).sort()).toEqual(['Be3', 'a6', 'e5']);
		expect(replace.replacements).toEqual([{ fromFen: conflict.fromFen, san: 'a6' }]);
	});

	it('stops asking about conflicts inside an abandoned line', () => {
		// Two Dragon sub-lines clash on Black's 6th move, after a clash on the 5th.
		const dragonA = [...DRAGON.slice(0, 11), 'Bg7'];
		const dragonB = [...DRAGON.slice(0, 11), 'Nc6'];
		const p = preview([NAJDORF, dragonA, dragonB], 'BLACK');
		expect(openConflicts(p, new Map())).toHaveLength(2);
		const first = p.conflicts.find((c) => c.alternatives.includes('a6'))!;
		expect(openConflicts(p, new Map([[first.fromFen, 'a6']]))).toEqual([]);
	});

	it('keeps a position that a kept line transposes into', () => {
		// 1.d4 Nf6 2.c4 e6 and 1.c4 e6 2.d4 Nf6 reach the same position.
		const kept = ['d4', 'Nf6', 'c4', 'e6', 'Nc3'];
		const dropped = ['c4', 'e6', 'd4', 'Nf6', 'Nc3'];
		const p = preview([kept, dropped, ['e4']], 'WHITE');
		const conflict = openConflicts(p, new Map())[0];
		const resolved = new Map([[conflict.fromFen, 'd4']]);
		expect(conflict.alternatives.sort()).toEqual(['c4', 'd4', 'e4']);
		const { moves } = buildImportRequest(p, resolved);
		expect(moves.map((m) => m.san)).toContain('Nc3');
		expect(moves.map((m) => m.san)).not.toContain('e4');
	});
});
