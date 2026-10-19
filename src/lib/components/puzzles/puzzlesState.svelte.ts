/**
 * puzzlesState.svelte.ts — Svelte 5 runes module for the Puzzles page.
 *
 * PUZZLE FLOW
 * 1. fetchNext() asks GET /api/puzzles/next for a random matching puzzle.
 * 2. The board shows the puzzle's FEN, then plays the opponent's setup move.
 * 3. The user looks for the next solution move (handleMove).
 * 4. While solution moves remain, the opponent's reply is played and the
 *    user moves again; a wrong move shows the solution.
 * 5. Solving or failing records an attempt and enables Next Puzzle.
 *
 * PHASES
 * idle → loading → setup → waiting → correct → (opponent reply) → waiting → …
 *                                   ↘ incorrect → (solution shown) → idle
 *                                   ↘ solved
 */

import { Chess } from 'chess.js';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { puzzle as puzzleTable } from '$lib/db/schema';
import { playMove, playCapture, playCorrect, playIncorrect } from '$lib/sounds';
import { STARTING_FEN } from '$lib/fen';
import { applyUci, judgeMove, userSide } from '$lib/puzzles/solution';

export type Puzzle = typeof puzzleTable.$inferSelect;

export type Phase = 'idle' | 'loading' | 'setup' | 'waiting' | 'correct' | 'incorrect' | 'solved';

/** Delays (ms) that let the user see what happened before the next step. */
export const SETUP_DELAY_MS = 600;
export const REPLY_DELAY_MS = 500;
export const SOLUTION_DELAY_MS = 800;
const FLASH_MS = 600;

export interface CreatePuzzlesStateParams {
	getBaseUrl: () => string;
	/** Every family that matches the repertoire; used when none is selected. */
	getFamilies: () => string[];
	/** 'WHITE' or 'BLACK', for the "my colour only" filter. */
	getRepertoireColor: () => string | null;
}

export function createPuzzlesState(params: CreatePuzzlesStateParams) {
	let phase = $state<Phase>('idle');
	let puzzle = $state<Puzzle | null>(null);
	let currentFen = $state(STARTING_FEN);
	let orientation = $state<'white' | 'black'>('white');
	let lastMove = $state<[string, string] | undefined>(undefined);
	let flashColor = $state<'green' | 'red' | null>(null);
	let hintShapes = $state<DrawShape[]>([]);
	/** Why no puzzle is showing (rate limit, nothing matches, a failed request). */
	let message = $state<string | null>(null);

	let solutionMoves: string[] = [];
	let moveIndex = 0;
	let startTime = 0;

	let selectedFamilies = $state<string[]>([]);
	let minRating = $state('');
	let maxRating = $state('');
	let selectedThemes = $state<string[]>([]);
	let myColorOnly = $state(false);

	let solvedCount = $state(0);
	let failedCount = $state(0);
	const attempted = $derived(solvedCount + failedCount);
	const accuracy = $derived(attempted > 0 ? Math.round((solvedCount / attempted) * 100) : 0);

	// Every pending step is cleared when the page goes or a new puzzle starts,
	// so a late timer can't play a move on the wrong puzzle.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	const timers = new Set<ReturnType<typeof setTimeout>>();
	function later(fn: () => void, ms: number) {
		const id = setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
	}
	function clearTimers() {
		for (const id of timers) clearTimeout(id);
		timers.clear();
	}

	function flash(color: 'green' | 'red') {
		flashColor = color;
		later(() => (flashColor = null), FLASH_MS);
	}

	function queryString(): string {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read once, never rendered
		const search = new URLSearchParams();
		const families = selectedFamilies.length > 0 ? selectedFamilies : params.getFamilies();
		search.set('families', families.join(','));
		if (minRating) search.set('minRating', minRating);
		if (maxRating) search.set('maxRating', maxRating);
		if (selectedThemes.length > 0) search.set('themes', selectedThemes.join(','));
		const color = params.getRepertoireColor();
		if (myColorOnly && color) search.set('color', color);
		return search.toString();
	}

	async function fetchNext(): Promise<void> {
		if (params.getFamilies().length === 0) return;
		clearTimers();
		phase = 'loading';
		hintShapes = [];
		flashColor = null;
		puzzle = null;
		message = null;

		let next: Puzzle | null;
		try {
			const res = await fetch(`${params.getBaseUrl()}/api/puzzles/next?${queryString()}`);
			if (res.status === 429) {
				message = 'Too many puzzles requested. Wait a minute and try again.';
				phase = 'idle';
				return;
			}
			if (!res.ok) throw new Error(`status ${res.status}`);
			next = await res.json();
		} catch {
			message = "Couldn't load a puzzle. Check your connection and try again.";
			phase = 'idle';
			return;
		}
		if (!next) {
			message = 'No puzzle matches these filters. Try a wider rating range or fewer themes.';
			phase = 'idle';
			return;
		}

		puzzle = next;
		solutionMoves = next.moves.split(/\s+/).filter((m) => m.length > 0);
		moveIndex = 0;
		orientation = userSide(next.fen);
		currentFen = next.fen;
		lastMove = undefined;
		phase = 'setup';
		later(playSetupMove, SETUP_DELAY_MS);
	}

	/**
	 * Plays the next solution move for the opponent. Returns false (and gives
	 * up on the puzzle) when the stored move isn't legal.
	 */
	function playSolutionMove(): boolean {
		const chess = new Chess(currentFen);
		const uci = solutionMoves[moveIndex];
		const result = uci ? applyUci(chess, uci) : null;
		if (!result) {
			message = 'This puzzle has a broken solution. Try the next one.';
			phase = 'idle';
			return false;
		}
		currentFen = chess.fen();
		lastMove = [result.from, result.to];
		moveIndex++;
		if (result.captured) playCapture();
		else playMove();
		return true;
	}

	function playSetupMove() {
		if (!puzzle || !playSolutionMove()) return;
		startTime = Date.now();
		phase = 'waiting';
	}

	function finish(solved: boolean) {
		if (solved) {
			phase = 'solved';
			flash('green');
			playCorrect();
			solvedCount++;
		} else {
			phase = 'incorrect';
			flash('red');
			playIncorrect();
			failedCount++;
		}
		void recordAttempt(solved);
	}

	/** The board's onMove handler. */
	function handleMove(
		from: string,
		to: string,
		_san: string,
		newFen: string,
		isCapture: boolean,
		promotion?: string
	) {
		if (phase !== 'waiting' || !puzzle) return;
		const fenBefore = currentFen;
		const verdict = judgeMove(fenBefore, { from, to, promotion }, solutionMoves[moveIndex]);
		hintShapes = [];

		// The user's move stays on the board either way, so a wrong one can be
		// seen before the solution replaces it.
		currentFen = newFen;
		lastMove = [from, to];

		if (verdict === 'wrong') {
			finish(false);
			later(() => {
				currentFen = fenBefore;
				if (playSolutionMove()) phase = 'idle';
			}, SOLUTION_DELAY_MS);
			return;
		}

		if (isCapture) playCapture();
		else playMove();
		moveIndex++;
		if (verdict === 'mate' || moveIndex >= solutionMoves.length) {
			finish(true);
			return;
		}

		phase = 'correct';
		flash('green');
		later(() => {
			if (!playSolutionMove()) return;
			if (moveIndex >= solutionMoves.length) finish(true);
			else phase = 'waiting';
		}, REPLY_DELAY_MS);
	}

	async function recordAttempt(solved: boolean) {
		if (!puzzle) return;
		try {
			await fetch(`${params.getBaseUrl()}/api/puzzles/attempt`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ puzzleId: puzzle.puzzleId, solved, timeMs: Date.now() - startTime })
			});
		} catch {
			// The puzzle works without it; only the stats miss one attempt.
		}
	}

	/** Marks the square the next solution move starts from. */
	function showHint() {
		if (phase !== 'waiting' || moveIndex >= solutionMoves.length) return;
		hintShapes = [{ orig: solutionMoves[moveIndex].slice(0, 2) as Key, brush: 'green' }];
	}

	function toggleTheme(theme: string, on: boolean) {
		selectedThemes = on ? [...selectedThemes, theme] : selectedThemes.filter((t) => t !== theme);
	}

	return {
		get phase() {
			return phase;
		},
		get puzzle() {
			return puzzle;
		},
		get currentFen() {
			return currentFen;
		},
		get orientation() {
			return orientation;
		},
		get lastMove() {
			return lastMove;
		},
		get flashColor() {
			return flashColor;
		},
		get hintShapes() {
			return hintShapes;
		},
		get message() {
			return message;
		},
		get solvedCount() {
			return solvedCount;
		},
		get failedCount() {
			return failedCount;
		},
		get attempted() {
			return attempted;
		},
		get accuracy() {
			return accuracy;
		},
		/** Next Puzzle is available once nothing is in progress. */
		get canFetchNext() {
			return phase === 'idle' || phase === 'solved' || phase === 'incorrect';
		},
		get selectedFamilies() {
			return selectedFamilies;
		},
		set selectedFamilies(v: string[]) {
			selectedFamilies = v;
		},
		get minRating() {
			return minRating;
		},
		set minRating(v: string) {
			minRating = v;
		},
		get maxRating() {
			return maxRating;
		},
		set maxRating(v: string) {
			maxRating = v;
		},
		get selectedThemes() {
			return selectedThemes;
		},
		get myColorOnly() {
			return myColorOnly;
		},
		set myColorOnly(v: boolean) {
			myColorOnly = v;
		},
		fetchNext,
		handleMove,
		showHint,
		toggleTheme,
		destroy: clearTimers
	};
}

export type PuzzlesState = ReturnType<typeof createPuzzlesState>;
