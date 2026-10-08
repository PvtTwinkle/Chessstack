/**
 * buildKeyboard.svelte.ts — keyboard shortcuts and hover arrows for Build Mode.
 *
 * Owns the "which move is highlighted" state shared by the keyboard handler,
 * the saved-move buttons and the candidate list, plus the blue arrow drawn on
 * the board for whichever move is hovered or highlighted.
 *
 * Shortcuts:
 *   ←        undo one move          →      play the (highlighted) saved move
 *   Home     back to the start      ↑ / ↓  cycle saved moves, else candidates
 *   Enter    play the highlighted candidate
 *   1–5      play that candidate    Tab / Shift+Tab  next / previous candidate tab
 *   Escape   clear the highlight
 */

import { Chess } from 'chess.js';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { RepertoireMove } from './buildState.svelte';

export type CandidateTab = 'book' | 'masters' | 'stars' | 'players' | 'engine';

export const TAB_ORDER: CandidateTab[] = ['book', 'masters', 'stars', 'players', 'engine'];

// The slice of the build state the shortcuts read and drive.
interface KeyboardTarget {
	readonly currentFen: string;
	readonly movesFromCurrentPosition: RepertoireMove[];
	readonly saving: boolean;
	handleUndo(): void;
	handleReset(): void;
	navigateTo(move: RepertoireMove): void;
	handleCandidateSelect(san: string): void;
}

// The parts of a KeyboardEvent the handler uses, so tests can pass plain objects.
export type BuildKeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target' | 'preventDefault'>;

interface CreateBuildKeyboardParams {
	state: KeyboardTarget;
	// True while a modal (annotation, delete, import) has the keyboard.
	isModalOpen: () => boolean;
}

/** Resolve from/to squares for a SAN move at the given FEN. */
export function getMoveSquares(fen: string, san: string): { from: string; to: string } | null {
	try {
		const chess = new Chess(fen);
		const result = chess.move(san);
		return result ? { from: result.from, to: result.to } : null;
	} catch {
		return null;
	}
}

/** Step a highlight down a list of `length` items, starting at the top. */
export function stepDown(idx: number | null, length: number): number {
	return idx === null ? 0 : Math.min(idx + 1, length - 1);
}

/** Step a highlight up a list of `length` items, starting at the bottom. */
export function stepUp(idx: number | null, length: number): number {
	return idx === null ? length - 1 : Math.max(idx - 1, 0);
}

/** The candidate tab after `current`, or before it when `backwards`. Wraps around. */
export function cycleTab(current: CandidateTab, backwards: boolean): CandidateTab {
	const idx = TAB_ORDER.indexOf(current);
	const step = backwards ? -1 : 1;
	return TAB_ORDER[(idx + step + TAB_ORDER.length) % TAB_ORDER.length];
}

function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	const tag = el?.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable;
}

export function createBuildKeyboard({ state: s, isModalOpen }: CreateBuildKeyboardParams) {
	let hoveredSan = $state<string | null>(null);
	let highlightedCandidateIdx = $state<number | null>(null);
	let highlightedContinuationIdx = $state<number | null>(null);
	let activeCandidates = $state<string[]>([]);
	let requestedTab = $state<CandidateTab | null>(null);
	let currentCandidateTab = $state<CandidateTab>('book');

	/** Blue arrow showing the hovered / keyboard-highlighted candidate on the board. */
	const boardShapes: DrawShape[] = $derived.by(() => {
		if (!hoveredSan) return [];
		const sq = getMoveSquares(s.currentFen, hoveredSan);
		if (!sq) return [];
		return [{ orig: sq.from as Key, dest: sq.to as Key, brush: 'blue' }];
	});

	// Clear every highlight; the page calls this whenever the position changes.
	function resetHighlights(): void {
		highlightedCandidateIdx = null;
		highlightedContinuationIdx = null;
		hoveredSan = null;
	}

	function handleKeydown(e: BuildKeyEvent): void {
		if (isModalOpen()) return;
		if (isTypingTarget(e.target)) return;

		const saved = s.movesFromCurrentPosition;

		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				s.handleUndo();
				break;

			case 'ArrowRight':
				e.preventDefault();
				if (saved.length > 0) {
					s.navigateTo(saved[highlightedContinuationIdx ?? 0]);
				}
				break;

			case 'Home':
				e.preventDefault();
				s.handleReset();
				break;

			case 'ArrowDown':
			case 'ArrowUp': {
				e.preventDefault();
				const step = e.key === 'ArrowDown' ? stepDown : stepUp;
				// Context-sensitive: cycle saved continuations when multiple exist,
				// otherwise fall through to candidate highlighting.
				if (saved.length > 1) {
					highlightedContinuationIdx = step(highlightedContinuationIdx, saved.length);
					hoveredSan = saved[highlightedContinuationIdx].san;
				} else if (activeCandidates.length > 0) {
					highlightedCandidateIdx = step(highlightedCandidateIdx, activeCandidates.length);
				}
				break;
			}

			case 'Enter':
				if (
					highlightedCandidateIdx !== null &&
					activeCandidates[highlightedCandidateIdx] &&
					!s.saving
				) {
					e.preventDefault();
					s.handleCandidateSelect(activeCandidates[highlightedCandidateIdx]);
					highlightedCandidateIdx = null;
				}
				break;

			case 'Tab':
				e.preventDefault();
				requestedTab = cycleTab(currentCandidateTab, e.shiftKey);
				highlightedCandidateIdx = null;
				break;

			case 'Escape':
				if (highlightedCandidateIdx !== null || highlightedContinuationIdx !== null) {
					e.preventDefault();
					resetHighlights();
				}
				break;

			default:
				// Number keys 1-5 directly select a candidate.
				if (e.key >= '1' && e.key <= '5' && !s.saving) {
					const idx = parseInt(e.key) - 1;
					if (activeCandidates[idx]) {
						e.preventDefault();
						s.handleCandidateSelect(activeCandidates[idx]);
						highlightedCandidateIdx = null;
					}
				}
				break;
		}
	}

	return {
		get hoveredSan() {
			return hoveredSan;
		},
		set hoveredSan(v: string | null) {
			hoveredSan = v;
		},
		get highlightedCandidateIdx() {
			return highlightedCandidateIdx;
		},
		get highlightedContinuationIdx() {
			return highlightedContinuationIdx;
		},
		get requestedTab() {
			return requestedTab;
		},
		get boardShapes() {
			return boardShapes;
		},

		// Callbacks for CandidateMoves.
		setCandidates(sans: string[]): void {
			activeCandidates = sans;
		},
		tabChanged(tab: CandidateTab): void {
			currentCandidateTab = tab;
			requestedTab = null;
		},

		resetHighlights,
		handleKeydown
	};
}

export type BuildKeyboard = ReturnType<typeof createBuildKeyboard>;
