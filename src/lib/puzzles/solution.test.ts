import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
	applyUci,
	formatFamily,
	formatThemeLabel,
	judgeMove,
	parseUci,
	splitThemes,
	userSide
} from './solution';

/** The position after playing `uci` moves from `fen`. */
function after(fen: string, ...ucis: string[]): string {
	const chess = new Chess(fen);
	for (const uci of ucis) applyUci(chess, uci);
	return chess.fen();
}

describe('parseUci and applyUci', () => {
	it('reads plain moves and promotions', () => {
		expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4', promotion: undefined });
		expect(parseUci('b7a8n')).toEqual({ from: 'b7', to: 'a8', promotion: 'n' });
	});

	it('returns null for a move that is not legal', () => {
		expect(applyUci(new Chess(), 'e2e5')).toBeNull();
	});
});

describe('userSide', () => {
	it('is the side not to move before the setup move', () => {
		expect(userSide('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe('black');
		expect(userSide('8/8/8/8/8/8/8/K6k b - - 0 1')).toBe('white');
	});
});

describe('judgeMove', () => {
	// Black's setup move Nc2 lets either rook mate on the back rank.
	const backRank = after('6k1/5ppp/8/8/1n6/8/5PPP/RR4K1 b - - 0 1', 'b4c2');

	it('accepts the listed move', () => {
		expect(judgeMove(backRank, parseUci('a1a8'), 'a1a8')).toBe('mate');
		expect(judgeMove(new Chess().fen(), parseUci('e2e4'), 'e2e4')).toBe('continue');
	});

	it('accepts another checkmate', () => {
		expect(judgeMove(backRank, parseUci('b1b8'), 'a1a8')).toBe('mate');
	});

	it('rejects a different move that does not mate', () => {
		expect(judgeMove(backRank, parseUci('a1a7'), 'a1a8')).toBe('wrong');
		expect(judgeMove(new Chess().fen(), parseUci('d2d4'), 'e2e4')).toBe('wrong');
	});

	it('rejects an illegal move', () => {
		expect(judgeMove(new Chess().fen(), parseUci('e2e5'), 'e2e4')).toBe('wrong');
	});

	it('needs the listed promotion piece', () => {
		const promo = after('r5k1/1P3ppp/8/8/8/8/5PPP/6K1 b - - 0 1', 'h7h6');
		expect(judgeMove(promo, { from: 'b7', to: 'a8', promotion: 'n' }, 'b7a8n')).toBe('continue');
		expect(judgeMove(promo, { from: 'b7', to: 'a8', promotion: 'q' }, 'b7a8n')).toBe('wrong');
	});
});

describe('display helpers', () => {
	it('formats families and themes', () => {
		expect(formatFamily('sicilian defense najdorf variation')).toBe(
			'Sicilian Defense Najdorf Variation'
		);
		expect(splitThemes(' fork  mateIn2 ')).toEqual(['fork', 'mateIn2']);
		expect(splitThemes(null)).toEqual([]);
		expect(formatThemeLabel('mateIn2')).toBe('Mate In 2');
		expect(formatThemeLabel('hangingPiece')).toBe('Hanging Piece');
	});
});
