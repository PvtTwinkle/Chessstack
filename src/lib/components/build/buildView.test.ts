import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { drillHereUrl, lichessAnalysisUrl, notePreview, startPositionChip } from './buildView';
import { STARTING_FEN } from '$lib/fen';

const afterE4 = (() => {
	const chess = new Chess();
	chess.move('e4');
	return chess.fen();
})();

describe('startPositionChip', () => {
	it('shows the active chip at the custom start', () => {
		expect(
			startPositionChip({
				currentFen: afterE4,
				startFen: afterE4,
				isStartPosition: true,
				lineLength: 1
			})
		).toBe('active');
	});

	it('offers "Set Start" away from the initial position', () => {
		expect(
			startPositionChip({
				currentFen: afterE4,
				startFen: null,
				isStartPosition: false,
				lineLength: 1
			})
		).toBe('set');
	});

	it('offers "Clear Start" at the initial position when a start is set', () => {
		expect(
			startPositionChip({
				currentFen: STARTING_FEN,
				startFen: afterE4,
				isStartPosition: false,
				lineLength: 0
			})
		).toBe('clear');
	});

	it('shows nothing at the initial position without a custom start', () => {
		expect(
			startPositionChip({
				currentFen: STARTING_FEN,
				startFen: null,
				isStartPosition: false,
				lineLength: 0
			})
		).toBeNull();
	});
});

describe('links', () => {
	it('drill link encodes the FEN', () => {
		expect(drillHereUrl(afterE4)).toBe(`/drill?mode=all&fromFen=${encodeURIComponent(afterE4)}`);
	});

	it('Lichess link uses underscores and the board orientation', () => {
		expect(lichessAnalysisUrl(STARTING_FEN, 'black')).toBe(
			'https://lichess.org/analysis/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_KQkq_-_0_1?color=black'
		);
	});
});

describe('notePreview', () => {
	it('keeps short notes and cuts long ones at 80 characters', () => {
		expect(notePreview('Main line')).toBe('Main line');
		const long = 'x'.repeat(100);
		expect(notePreview(long)).toBe('x'.repeat(80) + '…');
	});
});
