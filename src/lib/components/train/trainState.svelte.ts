/**
 * trainState.svelte.ts — Svelte 5 runes module for the Opening Trainer (/train).
 *
 * All reactive state ($state, $derived) and action functions live here.
 * The +page.svelte imports createTrainState() and wires the returned
 * state/actions to the template and the panel components.
 *
 * PHASE STATE MACHINE
 * ───────────────────
 * setup → playing → ended
 *                   ↓
 *                   (review handoff via sessionStorage → /review)
 */

import { Chess } from 'chess.js';
import { getEngine } from '$lib/engine/engine';
import { evaluatePosition } from '$lib/engine/evaluate';
import { engineSettings } from '$lib/engine/settings';
import { fenKey, STARTING_FEN, toFullFen } from '$lib/fen';
import { reconstructPath } from '$lib/repertoire';
import { setSoundEnabled, playMove, playCapture } from '$lib/sounds';
import type { TrainerEvalResult } from '$lib/trainer';
import { RATING_BRACKETS } from '$lib/ratings';

export type Phase = 'setup' | 'playing' | 'ended';
export type SetupMode = 'repertoire' | 'custom' | 'saved';
export type MoveSource = 'PLAYERS' | 'MASTERS';

export interface SavedPosition {
	id: number;
	fen: string;
	name: string;
	leadInMoves: string | null; // JSON array of SAN strings, or null
	createdAt: Date;
}

export interface GameMove {
	san: string;
	fen: string;
	from: string;
	to: string;
}

export interface MovePair {
	num: number;
	white?: string;
	black?: string;
}

// The parts of the page data the trainer reads. The page passes its whole
// PageData through a getter so the state always sees the latest load result.
export interface TrainPageData {
	repertoire: { id: number; name: string; color: string; startFen: string | null };
	repertoireMoves: { fromFen: string; toFen: string; san: string }[];
	user?: { username: string } | null;
	settings?: {
		playbackSpeed?: number;
		stockfishDepth?: number | null;
		stockfishTimeout?: number | null;
	} | null;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Format a centipawn eval (white's perspective) for display, or null if missing. */
export function formatEval(cp: number | null | undefined): string | null {
	if (!cp && cp !== 0) return null;
	if (cp === 99999) return 'Mate (winning)';
	if (cp === -99999) return 'Mate (losing)';
	const pawns = (cp / 100).toFixed(2);
	return cp >= 0 ? `+${pawns}` : pawns;
}

/**
 * Group the interactive moves into numbered pairs for display. Move numbers
 * are offset by the lead-in length so they match the actual PGN move numbers.
 */
export function groupMovePairs(sans: string[], leadInLength: number): MovePair[] {
	const pairs: MovePair[] = [];
	for (let i = 0; i < sans.length; i++) {
		const plyIndex = leadInLength + i; // absolute ply in the full game
		const moveNum = Math.floor(plyIndex / 2) + 1;
		if (plyIndex % 2 === 0) {
			// White's move
			pairs.push({ num: moveNum, white: sans[i] });
		} else {
			// Black's move — append to existing pair or start new one
			if (pairs.length > 0 && pairs[pairs.length - 1].num === moveNum) {
				pairs[pairs.length - 1].black = sans[i];
			} else {
				pairs.push({ num: moveNum, black: sans[i] });
			}
		}
	}
	return pairs;
}

/** PGN date header value (YYYY.MM.DD) in local time. */
export function pgnDate(now: Date): string {
	return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
}

/** Lichess analysis board URL for a position, seen from the given side. */
export function lichessAnalysisUrl(fen: string, orientation: 'white' | 'black'): string {
	return `https://lichess.org/analysis/${(fenKey(fen) + ' 0 1').replaceAll(' ', '_')}?color=${orientation}`;
}

// ── State ────────────────────────────────────────────────────────────────────

export function createTrainState(getData: () => TrainPageData) {
	let phase = $state<Phase>('setup');

	// Setup configuration
	let moveSource = $state<MoveSource>('PLAYERS');
	let depthLimit = $state(0); // 0 = no limit
	let rated = $state(true);
	let setupMode = $state<SetupMode>('repertoire');
	// Rating bracket for Players mode; the page syncs its default from the
	// trainer rating (see syncBracket).
	let selectedBracket = $state(3);

	// Starting position — derived from setup mode
	let customFen = $state(STARTING_FEN);
	let customSetupMoves = $state<string[]>([]); // SAN moves made during custom position setup
	let selectedSavedId = $state<number | null>(null);

	// First-time rating setup
	let showRatingSetup = $state(false);
	let initialRating = $state(1200);
	let trainerRating = $state<number | null>(null);

	// Board state
	let currentFen = $state(STARTING_FEN);
	let lastMove = $state<[string, string] | undefined>(undefined);
	let boardKey = $state(0);

	// Game state (during playing phase)
	// gameChess maintains the full move history for PGN export — never replace it mid-game.
	// Re-created in startTraining(); only accessed during playing/ended phases.
	let gameChess = $state(new Chess());
	let gameMoves = $state<GameMove[]>([]);
	let waitingForComputer = $state(false);
	let moveCount = $state(0); // total half-moves played by both sides during interactive phase
	let leadInLength = $state(0); // half-moves replayed before interactive play
	let endReason = $state('');

	// Sound
	let soundEnabled = $state(true);

	// Saved positions
	let savedPositions = $state<SavedPosition[]>([]);
	let savePositionName = $state('');
	let savingPosition = $state(false);

	// End screen state
	let evalResult = $state<TrainerEvalResult | null>(null);
	let evaluating = $state(false);

	// ── Derived ──────────────────────────────────────────────────────────────

	const orientation = $derived<'white' | 'black'>(
		getData().repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	const startFen = $derived.by(() => {
		if (setupMode === 'repertoire') {
			return getData().repertoire.startFen ?? STARTING_FEN;
		}
		if (setupMode === 'saved' && selectedSavedId !== null) {
			const pos = savedPositions.find((p) => p.id === selectedSavedId);
			return pos?.fen ?? STARTING_FEN;
		}
		return fenKey(customFen);
	});

	const isUserTurn = $derived.by(() => {
		const sideToMove = currentFen.split(' ')[1]; // 'w' or 'b'
		const userColor = getData().repertoire.color === 'WHITE' ? 'w' : 'b';
		return sideToMove === userColor;
	});

	const evalDisplay = $derived(formatEval(evalResult?.evalCp));

	const moveListDisplay = $derived(
		groupMovePairs(
			gameMoves.map((m) => m.san),
			leadInLength
		)
	);

	// Full moves completed during interactive play (both sides moved).
	const fullMovesPlayed = $derived(Math.floor(moveCount / 2));

	// ── Sync from server data ────────────────────────────────────────────────

	function syncRating(rating: number | null) {
		showRatingSetup = rating === null;
		trainerRating = rating;
	}

	function syncSound(enabled: boolean) {
		soundEnabled = enabled;
	}

	function syncSavedPositions(positions: SavedPosition[]) {
		savedPositions = positions;
	}

	function syncBracket(bracket: number) {
		selectedBracket = bracket;
	}

	// ── Sound ────────────────────────────────────────────────────────────────

	function playMoveSound(isCapture: boolean) {
		if (!soundEnabled) return;
		if (isCapture) playCapture();
		else playMove();
	}

	function toggleSound() {
		soundEnabled = !soundEnabled;
		setSoundEnabled(soundEnabled);
		try {
			fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ soundEnabled })
			});
		} catch {
			// Non-critical
		}
	}

	// ── Rating setup ─────────────────────────────────────────────────────────

	async function saveInitialRating() {
		const clamped = Math.max(100, Math.min(3000, Math.round(initialRating)));
		try {
			await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trainerRating: clamped })
			});
			trainerRating = clamped;
			showRatingSetup = false;
		} catch {
			// If save fails, let user retry
		}
	}

	// ── Setup: custom position ───────────────────────────────────────────────

	function handleSetupMove(
		from: string,
		to: string,
		san: string,
		newFen: string,
		isCapture: boolean
	) {
		customFen = newFen;
		customSetupMoves = [...customSetupMoves, san];
		currentFen = newFen;
		lastMove = [from, to] as [string, string];
		playMoveSound(isCapture);
	}

	function resetCustomPosition() {
		customFen = STARTING_FEN;
		customSetupMoves = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		boardKey++;
	}

	// ── Setup: saved positions ───────────────────────────────────────────────

	async function saveCurrentPosition() {
		if (!savePositionName.trim()) return;
		savingPosition = true;
		try {
			const res = await fetch('/api/train/saved-positions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fen: customFen,
					name: savePositionName.trim(),
					leadInMoves: customSetupMoves.length > 0 ? customSetupMoves : undefined
				})
			});
			if (res.ok) {
				const { position } = await res.json();
				savedPositions = [position, ...savedPositions];
				savePositionName = '';
			}
		} finally {
			savingPosition = false;
		}
	}

	async function deleteSavedPosition(id: number) {
		try {
			const res = await fetch('/api/train/saved-positions', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				savedPositions = savedPositions.filter((p) => p.id !== id);
				if (selectedSavedId === id) selectedSavedId = null;
			}
		} catch {
			// Non-critical
		}
	}

	// Get the lead-in moves for the current setup mode.
	// Returns SAN array from the standard starting position to the training start.
	function getLeadInMoves(): string[] {
		if (setupMode === 'custom') {
			return customSetupMoves;
		}
		if (setupMode === 'saved' && selectedSavedId !== null) {
			const pos = savedPositions.find((p) => p.id === selectedSavedId);
			if (pos?.leadInMoves) {
				try {
					return JSON.parse(pos.leadInMoves) as string[];
				} catch {
					return [];
				}
			}
			return [];
		}
		if (setupMode === 'repertoire') {
			const data = getData();
			const repStart = data.repertoire.startFen;
			if (!repStart) return []; // default starting position, no lead-in needed
			return reconstructPath(data.repertoireMoves, repStart);
		}
		return [];
	}

	// ── Setup mode changes ───────────────────────────────────────────────────

	function switchSetupMode(mode: SetupMode) {
		setupMode = mode;
		if (mode === 'repertoire') {
			currentFen = toFullFen(getData().repertoire.startFen ?? STARTING_FEN);
			lastMove = undefined;
			boardKey++;
		} else if (mode === 'custom') {
			currentFen = toFullFen(customFen);
			lastMove = undefined;
		} else if (mode === 'saved') {
			if (selectedSavedId) {
				const pos = savedPositions.find((p) => p.id === selectedSavedId);
				if (pos) {
					currentFen = toFullFen(pos.fen);
					lastMove = undefined;
					boardKey++;
				}
			}
		}
	}

	function selectSavedPosition(id: number) {
		selectedSavedId = id;
		const pos = savedPositions.find((p) => p.id === id);
		if (pos) {
			currentFen = toFullFen(pos.fen);
			lastMove = undefined;
			boardKey++;
		}
	}

	// ── Game start ───────────────────────────────────────────────────────────

	function startTraining() {
		const data = getData();
		// Always start from the standard position and replay lead-in moves so the
		// PGN records the full game from move 1 (no [SetUp] header).
		const leadIn = getLeadInMoves();

		gameChess = new Chess();

		// Set PGN headers so the game is identifiable in review
		const username = data.user?.username ?? 'Player';
		const bracketLabel =
			moveSource === 'PLAYERS' ? ` (${RATING_BRACKETS[selectedBracket].label})` : ' (Masters)';

		if (data.repertoire.color === 'WHITE') {
			gameChess.header('White', username, 'Black', `Chessstack Trainer${bracketLabel}`);
		} else {
			gameChess.header('White', `Chessstack Trainer${bracketLabel}`, 'Black', username);
		}
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive one-shot usage
		const now = new Date();
		gameChess.header(
			'Event',
			'Opening Trainer',
			'Site',
			'Chessstack',
			'Date',
			pgnDate(now),
			'Round',
			'-'
		);
		if (trainerRating !== null) {
			const ratingKey = data.repertoire.color === 'WHITE' ? 'WhiteElo' : 'BlackElo';
			gameChess.header(ratingKey, String(trainerRating));
		}

		for (const san of leadIn) {
			gameChess.move(san);
		}
		leadInLength = leadIn.length;

		currentFen = gameChess.fen();
		lastMove = undefined;
		gameMoves = [];
		moveCount = 0;
		endReason = '';
		evalResult = null;
		evaluating = false;
		boardKey++;
		phase = 'playing';

		// If it's the computer's turn first (user plays black and white moves first),
		// fetch the computer's opening move
		if (!isUserTurn) {
			fetchComputerMove();
		}
	}

	// ── User move handling ───────────────────────────────────────────────────

	function handleMove(from: string, to: string, san: string, newFen: string, isCapture: boolean) {
		if (phase !== 'playing' || !isUserTurn) return;

		// Record the move on the persistent Chess instance (preserves PGN history)
		const moveResult = gameChess.move(san);
		if (!moveResult) return; // shouldn't happen (Chessground validated), but don't crash
		gameMoves = [...gameMoves, { san, fen: newFen, from, to }];
		currentFen = newFen;
		lastMove = [from, to] as [string, string];
		moveCount++;

		playMoveSound(isCapture);

		// Check end conditions
		if (checkEndConditions()) return;

		// Computer's turn
		fetchComputerMove();
	}

	// ── Computer move ────────────────────────────────────────────────────────

	async function fetchComputerMove() {
		waitingForComputer = true;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive one-shot usage
		const params = new URLSearchParams({
			fen: currentFen,
			source: moveSource.toLowerCase()
		});
		if (moveSource === 'PLAYERS') {
			params.set('rating', String(selectedBracket));
		}

		try {
			const res = await fetch(`/api/train/computer-move?${params}`);
			const result = await res.json();

			if (result.noMoves) {
				endReason = 'The database has no more moves for this position.';
				endGame();
				return;
			}

			// Brief delay for natural feel
			await new Promise((r) => setTimeout(r, getData().settings?.playbackSpeed ?? 500));

			// Apply the computer's move on the persistent Chess instance
			const moveResult = gameChess.move(result.san);
			if (!moveResult) {
				// Shouldn't happen, but fall back gracefully
				endReason = 'Computer returned an invalid move.';
				endGame();
				return;
			}

			const newFen = gameChess.fen();
			gameMoves = [
				...gameMoves,
				{ san: result.san, fen: newFen, from: moveResult.from, to: moveResult.to }
			];
			currentFen = newFen;
			lastMove = [moveResult.from, moveResult.to] as [string, string];
			moveCount++;
			boardKey++;

			playMoveSound(!!moveResult.captured);

			// Check end conditions after computer's move
			checkEndConditions();
		} catch {
			endReason = 'Failed to fetch computer move.';
			endGame();
		} finally {
			waitingForComputer = false;
		}
	}

	// ── End condition checks ─────────────────────────────────────────────────

	function checkEndConditions(): boolean {
		if (gameChess.isGameOver()) {
			if (gameChess.isCheckmate()) endReason = 'Checkmate!';
			else if (gameChess.isStalemate()) endReason = 'Stalemate.';
			else if (gameChess.isDraw()) endReason = 'Draw.';
			else endReason = 'Game over.';
			endGame();
			return true;
		}

		// Depth limit check: only after a full move pair (both sides moved)
		// depthLimit counts full moves, moveCount counts half-moves
		if (depthLimit > 0) {
			const fullMoves = Math.floor(moveCount / 2);
			if (fullMoves >= depthLimit) {
				endReason = `Reached the depth limit of ${depthLimit} move${depthLimit === 1 ? '' : 's'}.`;
				endGame();
				return true;
			}
		}

		return false;
	}

	// ── Stop button (manual end) ─────────────────────────────────────────────

	function stopTraining() {
		endReason = 'Training stopped manually.';
		endGame();
	}

	// ── End game + evaluate ──────────────────────────────────────────────────

	async function endGame() {
		const data = getData();
		phase = 'ended';
		evaluating = true;

		// Set the Result header based on how the game ended
		if (gameChess.isCheckmate()) {
			// The side that just moved delivered checkmate
			const loser = gameChess.turn(); // side that cannot move = lost
			gameChess.header('Result', loser === 'w' ? '0-1' : '1-0');
		} else if (gameChess.isDraw() || gameChess.isStalemate()) {
			gameChess.header('Result', '1/2-1/2');
		} else {
			gameChess.header('Result', '*');
		}

		// Count only the user's half-moves. gameMoves only contains moves made
		// during the interactive phase (after lead-in replay), so index 0 is
		// always the first post-lead-in move.
		const userColor = data.repertoire.color;
		const userMoves = gameMoves.filter((_, i) => {
			return userColor === 'WHITE' ? i % 2 === 0 : i % 2 === 1;
		}).length;

		try {
			// The browser scores the final position; the server turns that into
			// the result and rating change and saves the session.
			const score = await evaluatePosition(
				getEngine(),
				currentFen,
				engineSettings(data.settings)
			).catch(() => null);
			const res = await fetch('/api/train/evaluate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					evalCp: score?.evalCp ?? null,
					evalMate: score?.evalMate ?? null,
					fen: currentFen,
					rated: rated && trainerRating !== null,
					repertoireId: data.repertoire.id,
					pgn: gameChess.pgn(),
					movesPlayed: userMoves,
					startFen: startFen,
					moveSource,
					playerColor: data.repertoire.color,
					ratingBracket: moveSource === 'PLAYERS' ? selectedBracket : null
				})
			});
			evalResult = await res.json();
			if (evalResult?.ratingAfter != null) {
				trainerRating = evalResult.ratingAfter;
			}
		} catch {
			evalResult = null;
		} finally {
			evaluating = false;
		}
	}

	// ── Review handoff ───────────────────────────────────────────────────────

	// What the Review page reads from sessionStorage ('chessstack:trainer-review').
	function reviewHandoff() {
		const data = getData();
		return {
			pgn: gameChess.pgn(),
			playerColor: data.repertoire.color,
			repertoireId: data.repertoire.id
		};
	}

	// ── Play again ───────────────────────────────────────────────────────────

	function playAgain() {
		phase = 'setup';
		currentFen = STARTING_FEN;
		lastMove = undefined;
		gameMoves = [];
		moveCount = 0;
		leadInLength = 0;
		endReason = '';
		evalResult = null;
		boardKey++;
	}

	return {
		// Phase
		get phase() {
			return phase;
		},

		// Setup configuration
		get moveSource() {
			return moveSource;
		},
		set moveSource(v: MoveSource) {
			moveSource = v;
		},
		get depthLimit() {
			return depthLimit;
		},
		set depthLimit(v: number) {
			depthLimit = v;
		},
		get rated() {
			return rated;
		},
		set rated(v: boolean) {
			rated = v;
		},
		get setupMode() {
			return setupMode;
		},
		get selectedBracket() {
			return selectedBracket;
		},
		set selectedBracket(v: number) {
			selectedBracket = v;
		},
		get selectedSavedId() {
			return selectedSavedId;
		},
		get customSetupMoves() {
			return customSetupMoves;
		},

		// Rating
		get showRatingSetup() {
			return showRatingSetup;
		},
		get initialRating() {
			return initialRating;
		},
		set initialRating(v: number) {
			initialRating = v;
		},
		get trainerRating() {
			return trainerRating;
		},

		// Board
		get currentFen() {
			return currentFen;
		},
		get lastMove() {
			return lastMove;
		},
		get boardKey() {
			return boardKey;
		},
		get orientation() {
			return orientation;
		},

		// Game
		get gameMoves() {
			return gameMoves;
		},
		get waitingForComputer() {
			return waitingForComputer;
		},
		get moveCount() {
			return moveCount;
		},
		get fullMovesPlayed() {
			return fullMovesPlayed;
		},
		get leadInLength() {
			return leadInLength;
		},
		get endReason() {
			return endReason;
		},

		// Sound
		get soundEnabled() {
			return soundEnabled;
		},

		// Saved positions
		get savedPositions() {
			return savedPositions;
		},
		get savePositionName() {
			return savePositionName;
		},
		set savePositionName(v: string) {
			savePositionName = v;
		},
		get savingPosition() {
			return savingPosition;
		},

		// End screen
		get evalResult() {
			return evalResult;
		},
		get evaluating() {
			return evaluating;
		},

		// Derived
		get startFen() {
			return startFen;
		},
		get isUserTurn() {
			return isUserTurn;
		},
		get evalDisplay() {
			return evalDisplay;
		},
		get moveListDisplay() {
			return moveListDisplay;
		},

		// Actions
		syncRating,
		syncSound,
		syncSavedPositions,
		syncBracket,
		toggleSound,
		saveInitialRating,
		handleSetupMove,
		resetCustomPosition,
		saveCurrentPosition,
		deleteSavedPosition,
		getLeadInMoves,
		switchSetupMode,
		selectSavedPosition,
		startTraining,
		handleMove,
		stopTraining,
		reviewHandoff,
		playAgain
	};
}

export type TrainState = ReturnType<typeof createTrainState>;
