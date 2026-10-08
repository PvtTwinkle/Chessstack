import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import {
	createBuildKeyboard,
	cycleTab,
	getMoveSquares,
	stepDown,
	stepUp,
	type BuildKeyEvent
} from './buildKeyboard.svelte';
import type { RepertoireMove } from './buildState.svelte';

const START = new Chess().fen();

function saved(...sans: string[]): RepertoireMove[] {
	return sans.map((san, i) => {
		const chess = new Chess();
		chess.move(san);
		return {
			id: i + 1,
			userId: 1,
			repertoireId: 1,
			fromFen: START,
			toFen: chess.fen(),
			san,
			source: 'manual',
			notes: null,
			createdAt: 0
		};
	});
}

function setup(opts: { moves?: RepertoireMove[]; saving?: boolean; modal?: boolean } = {}) {
	const state = {
		currentFen: START,
		movesFromCurrentPosition: opts.moves ?? [],
		saving: opts.saving ?? false,
		handleUndo: vi.fn(),
		handleReset: vi.fn(),
		navigateTo: vi.fn(),
		handleCandidateSelect: vi.fn()
	};
	const keys = createBuildKeyboard({ state, isModalOpen: () => opts.modal ?? false });
	return { state, keys };
}

function press(
	keys: ReturnType<typeof setup>['keys'],
	key: string,
	extra: Partial<BuildKeyEvent> = {}
) {
	const e = { key, shiftKey: false, target: null, preventDefault: vi.fn(), ...extra };
	keys.handleKeydown(e);
	return e;
}

describe('helpers', () => {
	it('stepDown starts at the top and stops at the bottom', () => {
		expect(stepDown(null, 3)).toBe(0);
		expect(stepDown(0, 3)).toBe(1);
		expect(stepDown(2, 3)).toBe(2);
	});

	it('stepUp starts at the bottom and stops at the top', () => {
		expect(stepUp(null, 3)).toBe(2);
		expect(stepUp(2, 3)).toBe(1);
		expect(stepUp(0, 3)).toBe(0);
	});

	it('cycleTab wraps in both directions', () => {
		expect(cycleTab('book', false)).toBe('masters');
		expect(cycleTab('engine', false)).toBe('book');
		expect(cycleTab('book', true)).toBe('engine');
	});

	it('getMoveSquares resolves a SAN move, or null when illegal', () => {
		expect(getMoveSquares(START, 'Nf3')).toEqual({ from: 'g1', to: 'f3' });
		expect(getMoveSquares(START, 'Ke2')).toBeNull();
	});
});

describe('handleKeydown', () => {
	it('arrow left undoes and Home resets', () => {
		const { state, keys } = setup();
		expect(press(keys, 'ArrowLeft').preventDefault).toHaveBeenCalled();
		expect(state.handleUndo).toHaveBeenCalled();
		press(keys, 'Home');
		expect(state.handleReset).toHaveBeenCalled();
	});

	it('arrow right plays the first saved move', () => {
		const moves = saved('e4', 'd4');
		const { state, keys } = setup({ moves });
		press(keys, 'ArrowRight');
		expect(state.navigateTo).toHaveBeenCalledWith(moves[0]);
	});

	it('arrow down cycles saved moves, shows their arrow, and arrow right plays it', () => {
		const moves = saved('e4', 'd4');
		const { state, keys } = setup({ moves });
		press(keys, 'ArrowDown');
		press(keys, 'ArrowDown');
		expect(keys.highlightedContinuationIdx).toBe(1);
		expect(keys.hoveredSan).toBe('d4');
		expect(keys.boardShapes).toEqual([{ orig: 'd2', dest: 'd4', brush: 'blue' }]);

		press(keys, 'ArrowRight');
		expect(state.navigateTo).toHaveBeenCalledWith(moves[1]);
	});

	it('arrow keys cycle candidates when there is at most one saved move', () => {
		const { keys } = setup({ moves: saved('e4') });
		keys.setCandidates(['e4', 'd4', 'c4']);
		press(keys, 'ArrowUp');
		expect(keys.highlightedCandidateIdx).toBe(2);
		press(keys, 'ArrowUp');
		expect(keys.highlightedCandidateIdx).toBe(1);
		expect(keys.highlightedContinuationIdx).toBeNull();
	});

	it('Enter plays the highlighted candidate', () => {
		const { state, keys } = setup();
		keys.setCandidates(['e4', 'd4']);
		press(keys, 'ArrowDown');
		press(keys, 'Enter');
		expect(state.handleCandidateSelect).toHaveBeenCalledWith('e4');
		expect(keys.highlightedCandidateIdx).toBeNull();
	});

	it('number keys play that candidate, but not while saving', () => {
		const { state, keys } = setup();
		keys.setCandidates(['e4', 'd4']);
		press(keys, '2');
		expect(state.handleCandidateSelect).toHaveBeenCalledWith('d4');
		press(keys, '5');
		expect(state.handleCandidateSelect).toHaveBeenCalledTimes(1);

		const busy = setup({ saving: true });
		busy.keys.setCandidates(['e4']);
		press(busy.keys, '1');
		expect(busy.state.handleCandidateSelect).not.toHaveBeenCalled();
	});

	it('Tab asks for the next candidate tab, Shift+Tab the previous one', () => {
		const { keys } = setup();
		press(keys, 'Tab');
		expect(keys.requestedTab).toBe('masters');
		keys.tabChanged('masters');
		expect(keys.requestedTab).toBeNull();
		press(keys, 'Tab', { shiftKey: true });
		expect(keys.requestedTab).toBe('book');
	});

	it('Escape clears the highlight', () => {
		const { keys } = setup({ moves: saved('e4', 'd4') });
		press(keys, 'ArrowDown');
		const e = press(keys, 'Escape');
		expect(e.preventDefault).toHaveBeenCalled();
		expect(keys.highlightedContinuationIdx).toBeNull();
		expect(keys.hoveredSan).toBeNull();
		expect(keys.boardShapes).toEqual([]);
	});

	it('Escape with nothing highlighted is left alone', () => {
		const { keys } = setup();
		expect(press(keys, 'Escape').preventDefault).not.toHaveBeenCalled();
	});

	it('ignores keys while a modal is open', () => {
		const { state, keys } = setup({ modal: true });
		const e = press(keys, 'ArrowLeft');
		expect(state.handleUndo).not.toHaveBeenCalled();
		expect(e.preventDefault).not.toHaveBeenCalled();
	});

	it('ignores keys typed into a text field', () => {
		const { state, keys } = setup();
		press(keys, 'ArrowLeft', { target: { tagName: 'TEXTAREA' } as unknown as EventTarget });
		press(keys, 'Home', { target: { isContentEditable: true } as unknown as EventTarget });
		expect(state.handleUndo).not.toHaveBeenCalled();
		expect(state.handleReset).not.toHaveBeenCalled();
	});
});
