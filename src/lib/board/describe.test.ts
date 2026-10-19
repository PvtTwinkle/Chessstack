import { describe, expect, it } from 'vitest';
import { describeEval, describePositionChange, moveBetween, sanToSpeech } from './describe';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

describe('sanToSpeech', () => {
	it('spells out pieces, captures, checks and promotions', () => {
		expect(sanToSpeech('e4')).toBe('e4');
		expect(sanToSpeech('Nxf3+')).toBe('Knight takes f3, check');
		expect(sanToSpeech('exd5')).toBe('e takes d5');
		expect(sanToSpeech('Nbd2')).toBe('Knight bd2');
		expect(sanToSpeech('e8=N#')).toBe('e8, promotes to knight, checkmate');
		expect(sanToSpeech('O-O-O+')).toBe('Castles queenside, check');
		expect(sanToSpeech('O-O')).toBe('Castles kingside');
	});
});

describe('moveBetween', () => {
	it('finds the move between two positions, ignoring how en passant is written', () => {
		expect(moveBetween(START, AFTER_E4)).toBe('e4');
		expect(moveBetween(START, AFTER_E4.replace(' e3 ', ' - '))).toBe('e4');
	});

	it('returns null when no single move connects them', () => {
		expect(moveBetween(AFTER_E4, START)).toBeNull();
		expect(moveBetween('not a fen', START)).toBeNull();
	});
});

describe('describePositionChange', () => {
	it('says the move and whose turn it is', () => {
		expect(describePositionChange(START, AFTER_E4)).toBe('e4. Black to move.');
	});

	it('says only whose turn it is after a jump', () => {
		expect(describePositionChange(null, START)).toBe('White to move.');
		expect(describePositionChange(AFTER_E4, START)).toBe('White to move.');
	});

	it('says when the game is over', () => {
		const beforeMate = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
		const mate = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
		expect(describePositionChange(beforeMate, mate)).toBe('Queen h4, checkmate. Game over.');
	});
});

describe('describeEval', () => {
	it('names the side that is better', () => {
		expect(describeEval(34, null)).toBe('Evaluation: White is better by 0.3');
		expect(describeEval(-250, null)).toBe('Evaluation: Black is better by 2.5');
		expect(describeEval(3, null)).toBe('Evaluation: equal');
	});

	it('describes mates and a missing eval', () => {
		expect(describeEval(null, 1)).toBe('Evaluation: White mates in 1 move');
		expect(describeEval(null, -3)).toBe('Evaluation: Black mates in 3 moves');
		expect(describeEval(null, null)).toBe('Evaluation: none yet');
	});
});
