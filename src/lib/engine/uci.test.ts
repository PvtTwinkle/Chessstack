import { describe, expect, it } from 'vitest';
import { createCollector, parseInfoLine } from './uci';

describe('parseInfoLine', () => {
	it('reads depth, multipv, the first pv move and a cp score', () => {
		expect(
			parseInfoLine(
				'info depth 15 seldepth 22 multipv 2 score cp -45 nodes 1234 nps 5 pv e7e5 g1f3 b8c6'
			)
		).toEqual({ depth: 15, multipv: 2, uci: 'e7e5', scoreCp: -45, scoreMate: null });
	});

	it('reads mate scores and promotions', () => {
		expect(parseInfoLine('info depth 9 multipv 1 score mate -3 nodes 10 pv a2a1q b1a1')).toEqual({
			depth: 9,
			multipv: 1,
			uci: 'a2a1q',
			scoreCp: null,
			scoreMate: -3
		});
	});

	it('treats a line without multipv as the first variation', () => {
		expect(parseInfoLine('info depth 3 score cp 10 pv d2d4')?.multipv).toBe(1);
	});

	it('ignores lines without a principal variation', () => {
		expect(parseInfoLine('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull();
		expect(parseInfoLine('info string NNUE evaluation using nn.bin')).toBeNull();
		expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
	});
});

describe('createCollector', () => {
	const line = (depth: number, multipv: number, uci: string, cp: number) =>
		`info depth ${depth} multipv ${multipv} score cp ${cp} nodes 1 pv ${uci}`;

	it('reports a snapshot once every variation at a new depth has arrived', () => {
		const c = createCollector(2);
		expect(c.push(line(1, 1, 'e2e4', 30))).toBeNull();
		expect(c.push(line(1, 2, 'd2d4', 20))).toEqual({
			depth: 1,
			done: false,
			moves: [
				{ uci: 'e2e4', scoreCp: 30, scoreMate: null },
				{ uci: 'd2d4', scoreCp: 20, scoreMate: null }
			]
		});
		expect(c.push(line(2, 1, 'd2d4', 35))).toBeNull();
		expect(c.push(line(2, 2, 'e2e4', 31))?.moves.map((m) => m.uci)).toEqual(['d2d4', 'e2e4']);
	});

	it('does not repeat a depth it already reported', () => {
		const c = createCollector(1);
		expect(c.push(line(5, 1, 'e2e4', 30))).not.toBeNull();
		expect(c.push(line(5, 1, 'e2e4', 32))).toBeNull();
	});

	it('ignores variations beyond the number asked for', () => {
		const c = createCollector(1);
		c.push(line(1, 1, 'e2e4', 30));
		expect(c.push(line(1, 2, 'd2d4', 20))).toBeNull();
		expect(c.finish().moves).toHaveLength(1);
	});

	it('finishes with whatever has arrived', () => {
		const c = createCollector(3);
		c.push(line(4, 1, 'e2e4', 30));
		c.push(line(4, 2, 'd2d4', 20));
		expect(c.finish()).toEqual({
			depth: 0,
			done: true,
			moves: [
				{ uci: 'e2e4', scoreCp: 30, scoreMate: null },
				{ uci: 'd2d4', scoreCp: 20, scoreMate: null }
			]
		});
	});
});
