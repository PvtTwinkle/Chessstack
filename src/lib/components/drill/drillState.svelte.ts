/**
 * drillState.svelte.ts — Svelte 5 runes module for Drill Mode.
 *
 * All reactive state ($state, $derived) and action functions live here.
 * The +page.svelte imports createDrillState() and wires the returned
 * state/actions to the template and child components. The page keeps the
 * $effects (data sync, keyboard listener, tempo timer, sound toggle) and
 * calls into this module from them.
 *
 * DRILL FLOW
 * ──────────
 * 1. Load all due SR cards and all moves from the server.
 * 2. Filter cards by depth section (All / Foundations / Mainlines / Deep).
 * 3. Pick the first due card. Reconstruct the path from move 1 to that position.
 * 4. Auto-play moves at `playbackSpeed` intervals until reaching the due position.
 * 5. Board becomes interactive — user must play the correct move.
 * 6. Correct: green flash → show Again/Good/Easy buttons → grade → next card.
 * 7. Wrong:   red flash → show correct move → auto-grade Again → next card.
 * 8. When queue is empty: show session summary.
 *
 * PHASE STATE MACHINE
 * ───────────────────
 * idle → playing → waiting → correct → (grading) → idle (next card)
 *                          ↘ incorrect → (auto-grade Again) → idle
 * idle (all done) → complete
 */

import { SvelteMap } from 'svelte/reactivity';
import { get } from 'svelte/store';
import { Chess } from 'chess.js';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { fenKey, STARTING_FEN } from '$lib/fen';
import { playMove, playCapture, playCorrect, playIncorrect } from '$lib/sounds';
import { tutorialStep } from '$lib/stores/tutorial';
import { reconstructPath } from '$lib/repertoire';
import { getHintSquare, getMoveSquares } from '$lib/chess/squares';
import {
	computePlyDepths,
	enumerateLines,
	getSection,
	sortLinesByWeakness
} from '$lib/drill/drill-logic';
import type {
	DrillSection,
	DueCard,
	LineStep,
	NavEntry,
	Phase,
	RepertoireMove,
	UndoSnapshot
} from '$lib/drill/types';

export type DrillType = 'card' | 'line';

/** The parts of the page's server data that the drill state reads. */
export interface DrillData {
	moves: RepertoireMove[];
	dueCards: DueCard[];
	settings?: {
		soundEnabled?: boolean | null;
		tempoEnabled?: boolean | null;
		tempoSeconds?: number | null;
		playbackSpeed?: number | null;
	} | null;
}

/** The subset of a KeyboardEvent the shortcut handler needs. */
export type ShortcutEvent = Pick<
	KeyboardEvent,
	'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'preventDefault'
>;

interface CreateDrillStateParams {
	getRepertoireId: () => number;
	getRepertoireColor: () => string;
	// Re-run the page's server load (invalidateAll in the page). Injected so
	// the module doesn't depend on $app/navigation and stays unit-testable.
	reload: () => Promise<unknown>;
}

export function createDrillState(params: CreateDrillStateParams) {
	// ── Reactive state ─────────────────────────────────────────────────────────

	// All moves in the repertoire — used for path reconstruction.
	let allMoves = $state<RepertoireMove[]>([]);

	// All due cards loaded from the server.
	let allDueCards = $state<DueCard[]>([]);

	// Which depth section to drill: 'all' = no filter.
	let selectedSection = $state<'all' | DrillSection>('all');

	// Index into filteredCards — which card we're currently drilling.
	let currentCardIdx = $state(0);

	// Navigation history (same shape as build/explorer mode).
	let navHistory = $state<NavEntry[]>([]);

	// FEN currently on the board.
	let currentFen = $state(STARTING_FEN);

	// Last move played (for yellow highlight on board).
	let lastMove = $state<[string, string] | undefined>(undefined);

	// Whether the user has clicked "Start Drilling" — false shows the summary screen.
	let started = $state(false);

	// Current phase of the drill state machine.
	let phase = $state<Phase>('idle');

	// Overlay colour for the correct/incorrect flash animation.
	// null = no overlay shown.
	let flashColor = $state<'green' | 'red' | null>(null);

	// Set when the user plays wrong — shows "The correct move was X" message.
	let revealedSan = $state<string | null>(null);

	// True while a grade fetch is in-flight — prevents double-grading.
	let grading = $state(false);

	// Hint state: whether the user asked for a hint this card, and which
	// square to highlight (the "from" square of the correct move).
	let hintUsed = $state(false);
	let hintSquare = $state<string | null>(null);

	// True after the user has graded a correct answer — shows "Next" button
	// instead of auto-advancing, giving them time to read the move note.
	let awaitingNext = $state(false);

	// Session stats (accumulated across all cards in this session).
	let totalReviewed = $state(0);
	let correctCount = $state(0);

	// ID of the drill_session row created when the user grades the first card.
	// Null until the first grade, then set for the rest of the session.
	let sessionId = $state<number | null>(null);

	// ISO timestamp of the next due card after this session completes.
	// Set by the finalize PATCH — displayed on the end screen.
	let nextDueAt = $state<string | null>(null);

	// Incrementing this forces ChessBoard to remount, snapping pieces back.
	let boardKey = $state(0);

	// Timer handle for auto-play. Kept outside reactive state so it doesn't
	// trigger re-renders when set/cleared.
	let autoPlayTimer: ReturnType<typeof setTimeout> | undefined;

	// Whether sound effects are enabled. Initialised from server settings,
	// can be toggled in-session via the mute button (persisted to the DB).
	let soundEnabled = $state(true);

	// ── Undo state ───────────────────────────────────────────────────────────
	// Snapshot of the last graded card's FSRS state — allows single-level undo.
	let undoSnapshot = $state<UndoSnapshot | null>(null);
	let undoing = $state(false);

	// ── Line-mode state ──────────────────────────────────────────────────────
	// 'card' = normal single-position drilling, 'line' = full root-to-leaf lines.
	let drillType = $state<DrillType>('card');

	// All enumerated root-to-leaf lines, sorted weakest-first.
	let allLines = $state<LineStep[][]>([]);

	// Index into allLines — which line we're currently drilling.
	let currentLineIdx = $state(0);

	// The line currently being drilled.
	let currentLine = $state<LineStep[]>([]);

	// Index into currentLine — the next step the user must play (always a user-move step).
	let lineStepIdx = $state(0);

	// Stats for the current line.
	let lineCorrect = $state(0);
	let lineTotal = $state(0);

	// Brief interstitial shown between lines.
	let lineComplete = $state(false);

	// ── Playback speed (ms between auto-played moves) ────────────────────────
	let playbackSpeed = $state(500);

	// ── Tempo training state ──────────────────────────────────────────────────
	let tempoEnabled = $state(false);
	let tempoSeconds = $state(10);
	let tempoRemaining = $state(0);
	let tempoFraction = $state(1);
	let tempoTimerId: ReturnType<typeof setInterval> | undefined;
	let tempoStartTime = 0;

	// ── Blindfold mode ───────────────────────────────────────────────────────
	let blindfoldEnabled = $state(false);
	let blindfoldAnnouncement = $state<string | null>(null);

	// ── Derived ───────────────────────────────────────────────────────────────

	// Depth of every repertoire position, used to put cards into depth sections.
	const plyDepths = $derived(computePlyDepths(allMoves));

	// How many due cards fall into each depth section.
	const sectionCounts = $derived({
		foundations: allDueCards.filter((c) => getSection(c.fromFen, plyDepths) === 'foundations')
			.length,
		mainlines: allDueCards.filter((c) => getSection(c.fromFen, plyDepths) === 'mainlines').length,
		deep: allDueCards.filter((c) => getSection(c.fromFen, plyDepths) === 'deep').length
	});

	// Due cards filtered to the selected section (or all if 'all').
	const filteredCards = $derived(
		selectedSection === 'all'
			? allDueCards
			: allDueCards.filter((c) => getSection(c.fromFen, plyDepths) === selectedSection)
	);

	// The card being drilled right now.
	const currentCard = $derived(filteredCards[currentCardIdx] ?? null);

	// The FENs from the navigation history, newest-first, for OpeningName.
	const fenHistory = $derived([...navHistory].reverse().map((e) => e.fromFen));

	// Progress fraction (0–1) for the progress bar.
	const progress = $derived(filteredCards.length === 0 ? 1 : currentCardIdx / filteredCards.length);

	// Board shapes: yellow hint circle + green arrow showing the correct move on wrong answer.
	const boardShapes = $derived.by<DrawShape[]>(() => {
		const shapes: DrawShape[] = [];
		if (hintSquare) {
			shapes.push({ orig: hintSquare as Key, brush: 'yellow' });
		}
		if (revealedSan) {
			const sq = getMoveSquares(currentFen, revealedSan);
			if (sq) {
				shapes.push({ orig: sq.from as Key, dest: sq.to as Key, brush: 'green' });
			}
		}
		return shapes;
	});

	// Note on the move that REACHES a given position (keyed by normalised toFen).
	// Used to show the opponent's last-move annotation while the user is thinking.
	const noteByPosition = $derived.by(() => {
		const map = new SvelteMap<string, string>();
		for (const m of allMoves) {
			if (m.notes) map.set(fenKey(m.toFen), m.notes);
		}
		return map;
	});

	// Note on a specific move (keyed by normalised fromFen + san).
	// Used to show the card's own annotation after the user guesses.
	const noteByMove = $derived.by(() => {
		const map = new SvelteMap<string, string>();
		for (const m of allMoves) {
			if (m.notes) map.set(fenKey(m.fromFen) + ':' + m.san, m.notes);
		}
		return map;
	});

	// Note for the current position (opponent's last move annotation).
	const currentPositionNote = $derived(
		currentCard ? (noteByPosition.get(fenKey(currentCard.fromFen)) ?? null) : null
	);

	// Note for the card's own move (the user's move annotation).
	const currentMoveNote = $derived(
		currentCard
			? (noteByMove.get(fenKey(currentCard.fromFen) + ':' + currentCard.san) ?? null)
			: null
	);

	// ── Sync from server data ──────────────────────────────────────────────────

	// Called by the page on mount and again whenever the server data changes
	// (e.g. invalidateAll). The page wraps the board reset in untrack() — see
	// restartFromData() — so this effect doesn't depend on filteredCards.
	function syncFromData(data: DrillData): void {
		allMoves = data.moves;
		allDueCards = data.dueCards;
		soundEnabled = data.settings?.soundEnabled ?? true;
		tempoEnabled = data.settings?.tempoEnabled ?? false;
		tempoSeconds = data.settings?.tempoSeconds ?? 10;
		playbackSpeed = data.settings?.playbackSpeed ?? 500;

		// Reset session.
		totalReviewed = 0;
		correctCount = 0;
		currentCardIdx = 0;
		sessionId = null;
		nextDueAt = null;
	}

	// Second half of the data sync: reset the board and, if the user already
	// started, restart the drill with the fresh data. Reads filteredCards and
	// allMoves, so the page must call it inside untrack().
	function restartFromData(): void {
		resetBoard();
		if (started) {
			if (drillType === 'line') {
				initLineMode();
			} else {
				startNextCard();
			}
		}
	}

	// ── Tempo ─────────────────────────────────────────────────────────────────

	function startTempoTimer(): void {
		stopTempoTimer();
		if (!tempoEnabled || tempoSeconds <= 0) return;

		tempoRemaining = tempoSeconds;
		tempoFraction = 1;
		tempoStartTime = Date.now();

		// Update every 100ms for smooth progress bar animation.
		// Uses wall-clock elapsed time so browser tab throttling doesn't cause drift.
		tempoTimerId = setInterval(() => {
			const elapsed = (Date.now() - tempoStartTime) / 1000;
			const remaining = Math.max(0, tempoSeconds - elapsed);
			tempoRemaining = Math.ceil(remaining);
			tempoFraction = remaining / tempoSeconds;

			if (remaining <= 0) {
				handleTempoTimeout();
			}
		}, 100);
	}

	function stopTempoTimer(): void {
		if (tempoTimerId !== undefined) {
			clearInterval(tempoTimerId);
			tempoTimerId = undefined;
		}
	}

	function handleTempoTimeout(): void {
		stopTempoTimer();
		if (phase !== 'waiting' || !currentCard) return;

		// Treat timeout exactly like an incorrect move.
		boardKey++;
		phase = 'incorrect';
		flashColor = 'red';
		playIncorrect();
		revealedSan = currentCard.san;
		setTimeout(() => (flashColor = null), 600);
	}

	// Stop both timers. Called by the page when it unmounts.
	function destroy(): void {
		stopAutoPlay();
		stopTempoTimer();
	}

	// ── Blindfold ─────────────────────────────────────────────────────────────

	function toggleBlindfold(): void {
		blindfoldEnabled = !blindfoldEnabled;
		if (!blindfoldEnabled) blindfoldAnnouncement = null;
	}

	// ── Keyboard shortcuts ─────────────────────────────────────────────────────

	// Grading and Next button shortcuts. The page registers the window listener
	// and skips events from text inputs before calling this.
	function handleShortcut(e: ShortcutEvent): void {
		// Ctrl+Z / Cmd+Z for undo (before the modifier guard).
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && undoSnapshot && awaitingNext) {
			e.preventDefault();
			undoLastGrade();
			return;
		}

		// Ignore other keypresses with modifiers.
		if (e.ctrlKey || e.altKey || e.metaKey) return;

		// Start screen: Space/Enter begins drilling.
		if (!started && (e.key === ' ' || e.key === 'Enter')) {
			e.preventDefault();
			if (filteredCards.length > 0 || drillType === 'line') startDrilling();
			return;
		}

		// Line mode: Space/Enter advances to the next line on the interstitial.
		if (drillType === 'line' && lineComplete && (e.key === ' ' || e.key === 'Enter')) {
			e.preventDefault();
			advanceToNextLine();
			return;
		}

		// "Next" shortcut: Space or Enter when the Next button is visible.
		// Visible when: awaitingNext (graded correct), or incorrect, or hint-used correct.
		const nextVisible = awaitingNext || phase === 'incorrect' || (phase === 'correct' && hintUsed);
		if (nextVisible && (e.key === ' ' || e.key === 'Enter')) {
			e.preventDefault();
			handleNext();
			return;
		}

		// Grade shortcuts: 1/2/3 for Again/Good/Easy during correct phase
		// (only when grade buttons are shown — not hint-used, not already graded).
		if (phase === 'correct' && !hintUsed && !awaitingNext) {
			if (e.key === '1') {
				e.preventDefault();
				submitGrade(1);
			} else if (e.key === '2') {
				e.preventDefault();
				submitGrade(3);
			} else if (e.key === '3') {
				e.preventDefault();
				submitGrade(4);
			}
		}

		// z for undo (without modifier) when undo is available.
		if (e.key === 'z' && undoSnapshot && awaitingNext) {
			e.preventDefault();
			undoLastGrade();
		}
	}

	// ── Utility functions ──────────────────────────────────────────────────────

	// Switch to a different depth section. Resets the drill session so the user
	// starts fresh with the filtered card set. Called from the section tab buttons.
	function setSection(section: 'all' | DrillSection): void {
		if (section === selectedSection) return;
		selectedSection = section;
		currentCardIdx = 0;
		totalReviewed = 0;
		correctCount = 0;
		sessionId = null;
		nextDueAt = null;
		resetBoard();
		if (started) startNextCard();
	}

	// ── Hint ───────────────────────────────────────────────────────────────────

	// Show the hint: highlight the source square of the correct move.
	// Guard against calling more than once per card or outside the waiting phase.
	function showHint(): void {
		if (hintUsed || !currentCard || phase !== 'waiting') return;
		hintSquare = getHintSquare(currentFen, currentCard.san);
		hintUsed = true;
	}

	// Reset board state to the starting position.
	function resetBoard(): void {
		stopAutoPlay();
		stopTempoTimer();
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		flashColor = null;
		revealedSan = null;
		hintUsed = false;
		hintSquare = null;
		awaitingNext = false;
		boardKey++;
	}

	// Stop any running auto-play timer.
	function stopAutoPlay(): void {
		if (autoPlayTimer !== undefined) {
			clearTimeout(autoPlayTimer);
			autoPlayTimer = undefined;
		}
	}

	// ── Card loading and auto-play ─────────────────────────────────────────────

	// Load the card at filteredCards[currentCardIdx] and start playing through from move 1.
	function startNextCard(): void {
		if (filteredCards.length === 0 || currentCardIdx >= filteredCards.length) {
			phase = 'complete';
			return;
		}

		const card = filteredCards[currentCardIdx];
		// SAN moves from move 1 to the due card's fromFen.
		const path = reconstructPath(allMoves, card.fromFen);

		resetBoard();
		phase = 'playing';
		startAutoPlay(path);
	}

	// Auto-play moves from `pathMoves` one at a time with a `playbackSpeed` delay.
	// When all moves are played, transitions to 'waiting' so the user can move.
	function startAutoPlay(pathMoves: string[]): void {
		// If the position is already at the starting FEN (no path), go to waiting
		// immediately — this card is about the very first move of the game.
		if (pathMoves.length === 0) {
			phase = 'waiting';
			return;
		}

		let fen = STARTING_FEN;
		let history: NavEntry[] = [];
		let idx = 0;

		function step() {
			if (phase !== 'playing') return; // aborted (e.g. repertoire switch)

			if (idx >= pathMoves.length) {
				// Reached the due position — hand control to the user.
				phase = 'waiting';
				blindfoldAnnouncement = null;
				return;
			}

			const san = pathMoves[idx];
			try {
				const chess = new Chess(fen);
				const result = chess.move(san);
				if (!result) {
					phase = 'waiting'; // move failed, show what we have
					blindfoldAnnouncement = null;
					return;
				}
				const entry: NavEntry = {
					fromFen: fen,
					toFen: chess.fen(),
					san: result.san,
					from: result.from,
					to: result.to
				};
				history = [...history, entry];
				fen = chess.fen();

				// Update reactive state so the board and sidebar update.
				navHistory = history;
				currentFen = fen;
				lastMove = [result.from, result.to];
				if (blindfoldEnabled) blindfoldAnnouncement = san;

				// Play the appropriate sound for this auto-played move.
				if (result.captured) playCapture();
				else playMove();
			} catch {
				phase = 'waiting';
				blindfoldAnnouncement = null;
				return;
			}

			idx++;
			autoPlayTimer = setTimeout(step, playbackSpeed);
		}

		// First move plays after a short pause so the user sees the starting position.
		autoPlayTimer = setTimeout(step, playbackSpeed);
	}

	// ── User move handling ─────────────────────────────────────────────────────

	// Called by ChessBoard when the user drags a piece.
	function handleMove(
		from: string,
		to: string,
		san: string,
		newFen: string,
		isCapture: boolean
	): void {
		if (phase !== 'waiting') return;

		// Line mode: check against the current line step.
		if (drillType === 'line') {
			const step = currentLine[lineStepIdx];
			if (!step) return;

			if (san === step.san) {
				handleLineMoveCorrect(from, to, san, newFen, isCapture);
			} else {
				handleLineMoveIncorrect();
			}
			return;
		}

		// Card mode: check against the current SR card.
		if (!currentCard) return;

		if (san === currentCard.san) {
			// Correct move played. Update the board position regardless.
			navHistory = [...navHistory, { fromFen: currentFen, toFen: newFen, san, from, to }];
			currentFen = newFen;
			lastMove = [from, to];
			flashColor = 'green';
			setTimeout(() => (flashColor = null), 600);
			if (isCapture) playCapture();
			else playMove();

			phase = 'correct';
			if (!hintUsed) playCorrect();
		} else {
			// Wrong move — snap the board back and show the correct move.
			boardKey++;
			phase = 'incorrect';
			flashColor = 'red';
			playIncorrect();
			revealedSan = currentCard.san;
			setTimeout(() => (flashColor = null), 600);
		}
	}

	// ── Grading ────────────────────────────────────────────────────────────────

	// Submit the grade for the current card to the server and update stats.
	// Does NOT advance to the next card — call advanceToNext() separately.
	async function submitGrade(rating: number): Promise<void> {
		if (grading || !currentCard) return;
		grading = true;

		const wasCorrect = phase === 'correct';

		// Snapshot the card's current FSRS state before we overwrite it,
		// so the user can undo if they picked the wrong grade.
		// Only for user-chosen grades (correct phase, no hint) — not auto-grades.
		if (wasCorrect && !hintUsed) {
			undoSnapshot = {
				cardId: currentCard.id,
				wasCorrect,
				previousState: {
					due: currentCard.due,
					stability: currentCard.stability,
					difficulty: currentCard.difficulty,
					elapsedDays: currentCard.elapsedDays,
					scheduledDays: currentCard.scheduledDays,
					reps: currentCard.reps,
					lapses: currentCard.lapses,
					state: currentCard.state,
					lastReview: currentCard.lastReview,
					learningSteps: currentCard.learningSteps
				}
			};
		} else {
			undoSnapshot = null;
		}

		// Create the session record the first time a card is graded.
		// Non-critical: if this fails we still let the user continue drilling.
		if (sessionId === null) {
			try {
				const sessRes = await fetch('/api/drill/session', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ repertoireId: params.getRepertoireId() })
				});
				if (sessRes.ok) {
					const sessData = await sessRes.json();
					sessionId = sessData.sessionId;
				}
			} catch {
				// Non-critical — session tracking is best-effort.
			}
		}

		try {
			const res = await fetch('/api/drill/grade', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cardId: currentCard.id, rating })
			});
			if (!res.ok) throw new Error(`Grade failed: ${res.status}`);
		} catch (err) {
			console.error('Failed to grade card:', err);
			// Don't block the user from continuing on a network error.
		}

		totalReviewed++;
		if (wasCorrect) correctCount++;

		grading = false;
		awaitingNext = true;

		// Tutorial: after grading 2+ cards, advance to step 5 (drill options)
		if (get(tutorialStep) === 4 && totalReviewed >= 2) {
			fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tutorialStep: 5 })
			}).then(() => params.reload());
		}
	}

	// Undo the last grade — restore the card's FSRS state and re-show grade buttons.
	async function undoLastGrade(): Promise<void> {
		if (!undoSnapshot || undoing) return;
		undoing = true;

		try {
			const res = await fetch('/api/drill/undo', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: undoSnapshot.cardId,
					previousState: undoSnapshot.previousState
				})
			});
			if (!res.ok) throw new Error(`Undo failed: ${res.status}`);

			// Roll back local session stats.
			totalReviewed--;
			if (undoSnapshot.wasCorrect) correctCount--;

			// Re-show the grade buttons.
			awaitingNext = false;
			undoSnapshot = null;
		} catch (err) {
			console.error('Failed to undo grade:', err);
		}

		undoing = false;
	}

	// Finalize the session record and retrieve the next-due timestamp to show
	// on the end screen. Non-critical: the end screen works without it.
	async function finalizeSession(): Promise<void> {
		if (sessionId === null) return;
		try {
			const finalRes = await fetch(`/api/drill/session/${sessionId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cardsReviewed: totalReviewed, cardsCorrect: correctCount })
			});
			if (finalRes.ok) {
				const finalData = await finalRes.json();
				nextDueAt = finalData.nextDueAt;
			}
		} catch {
			// Non-critical.
		}
	}

	// Advance to the next card after the user clicks "Next".
	async function advanceToNext(): Promise<void> {
		undoSnapshot = null; // Undo window closes when moving to the next card.
		currentCardIdx++;
		resetBoard();

		// If this was the last card, finalize the session record.
		if (currentCardIdx >= filteredCards.length) {
			await finalizeSession();
		}

		startNextCard();
	}

	// Called by the "Next" button. For incorrect/hint cases, grades as Again
	// first; for already-graded correct answers, just advances.
	async function handleNext(): Promise<void> {
		if (!awaitingNext) {
			// Not yet graded — this is an incorrect or hint-used card.
			await submitGrade(1); // Rating.Again
		}
		await advanceToNext();
	}

	// ── Line-mode functions ───────────────────────────────────────────────────

	// Find the SR card matching a line step (for auto-grading).
	function findCardForStep(step: LineStep): DueCard | null {
		return (
			allDueCards.find((c) => fenKey(c.fromFen) === fenKey(step.fromFen) && c.san === step.san) ??
			null
		);
	}

	// Auto-grade a line step's SR card (fire-and-forget, doesn't block the flow).
	function autoGradeStep(step: LineStep, rating: number): void {
		const card = findCardForStep(step);
		if (!card) return; // no SR card for this move (might not exist)

		// Create session on first grade (same as card mode).
		if (sessionId === null) {
			fetch('/api/drill/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId: params.getRepertoireId() })
			})
				.then((res) => (res.ok ? res.json() : null))
				.then((d) => {
					if (d) sessionId = d.sessionId;
				})
				.catch(() => {});
		}

		fetch('/api/drill/grade', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cardId: card.id, rating })
		}).catch((err) => console.error('Failed to auto-grade:', err));

		totalReviewed++;
		if (rating >= 3) correctCount++;
	}

	// Initialize line mode: enumerate lines, sort, and start the first line.
	function initLineMode(): void {
		const color = params.getRepertoireColor() as 'WHITE' | 'BLACK';
		const raw = enumerateLines(allMoves, color);
		allLines = sortLinesByWeakness(raw, allDueCards);
		currentLineIdx = 0;
		lineComplete = false;
		totalReviewed = 0;
		correctCount = 0;
		sessionId = null;
		nextDueAt = null;
		startNextLine();
	}

	// Start drilling the next line in the queue.
	function startNextLine(): void {
		lineComplete = false;

		if (allLines.length === 0 || currentLineIdx >= allLines.length) {
			phase = 'complete';
			return;
		}

		const line = allLines[currentLineIdx];
		currentLine = line;
		lineStepIdx = 0;
		lineCorrect = 0;
		lineTotal = line.filter((s) => s.isUserMove).length;

		resetBoard();
		phase = 'playing';

		// Auto-play from the start until the first user-move step.
		lineAutoPlayFromStart();
	}

	// Auto-play opponent (and lead-in) moves at the start of a line, or after
	// the user plays a correct move, until the next user-move step or end of line.
	function lineAutoPlayFromStart(): void {
		let fen = currentFen;
		let history = [...navHistory];
		let idx = lineStepIdx;

		function step() {
			if (phase !== 'playing') return;

			// If we've reached the end of the line, mark it complete.
			if (idx >= currentLine.length) {
				lineComplete = true;
				phase = 'idle';
				return;
			}

			const s = currentLine[idx];

			// If this is a user move, stop auto-playing and wait for input.
			if (s.isUserMove) {
				lineStepIdx = idx;
				phase = 'waiting';
				blindfoldAnnouncement = null;
				return;
			}

			// Auto-play this opponent move.
			try {
				const chess = new Chess(fen);
				const result = chess.move(s.san);
				if (!result) {
					lineStepIdx = idx;
					phase = 'waiting';
					return;
				}

				const entry: NavEntry = {
					fromFen: fen,
					toFen: chess.fen(),
					san: result.san,
					from: result.from,
					to: result.to
				};
				history = [...history, entry];
				fen = chess.fen();

				navHistory = history;
				currentFen = fen;
				lastMove = [result.from, result.to];
				if (blindfoldEnabled) blindfoldAnnouncement = s.san;

				if (result.captured) playCapture();
				else playMove();
			} catch {
				lineStepIdx = idx;
				phase = 'waiting';
				blindfoldAnnouncement = null;
				return;
			}

			idx++;
			autoPlayTimer = setTimeout(step, playbackSpeed);
		}

		autoPlayTimer = setTimeout(step, playbackSpeed);
	}

	// After the user plays a correct move in line mode, continue auto-playing
	// opponent moves until the next user move or end of line.
	function continueLineAfterUserMove(): void {
		// Advance past the just-played user step.
		lineStepIdx++;
		phase = 'playing';
		lineAutoPlayFromStart();
	}

	// Handle a correct move in line mode: flash green, auto-grade, continue.
	function handleLineMoveCorrect(
		from: string,
		to: string,
		san: string,
		newFen: string,
		isCapture: boolean
	): void {
		const step = currentLine[lineStepIdx];

		navHistory = [...navHistory, { fromFen: currentFen, toFen: newFen, san, from, to }];
		currentFen = newFen;
		lastMove = [from, to];
		flashColor = 'green';
		setTimeout(() => (flashColor = null), 300);
		if (isCapture) playCapture();
		else playMove();
		playCorrect();

		lineCorrect++;
		autoGradeStep(step, 3); // Rating.Good

		// Short pause then continue the line.
		setTimeout(() => continueLineAfterUserMove(), 400);
	}

	// Handle an incorrect move in line mode: flash red, show correct, auto-correct, continue.
	function handleLineMoveIncorrect(): void {
		const step = currentLine[lineStepIdx];

		boardKey++; // snap board back
		flashColor = 'red';
		playIncorrect();
		revealedSan = step.san;
		setTimeout(() => (flashColor = null), 600);

		autoGradeStep(step, 1); // Rating.Again

		// After 1.5s, auto-correct the board and continue.
		setTimeout(() => {
			revealedSan = null;

			// Play the correct move on the board.
			try {
				const chess = new Chess(currentFen);
				const result = chess.move(step.san);
				if (result) {
					navHistory = [
						...navHistory,
						{
							fromFen: currentFen,
							toFen: chess.fen(),
							san: result.san,
							from: result.from,
							to: result.to
						}
					];
					currentFen = chess.fen();
					lastMove = [result.from, result.to];
					boardKey++;
				}
			} catch {
				// Shouldn't happen — the correct move should always be valid.
			}

			continueLineAfterUserMove();
		}, 1500);
	}

	// Advance to the next line after the interstitial.
	async function advanceToNextLine(): Promise<void> {
		currentLineIdx++;

		if (currentLineIdx >= allLines.length) {
			// All lines done — finalize session.
			await finalizeSession();
			phase = 'complete';
			return;
		}

		startNextLine();
	}

	// Switch between card and line drill modes.
	function switchDrillType(type: DrillType): void {
		if (type === drillType) return;
		drillType = type;
		resetBoard();

		if (!started) return;

		if (type === 'line') {
			initLineMode();
		} else {
			// Back to card mode — reset card state.
			currentCardIdx = 0;
			totalReviewed = 0;
			correctCount = 0;
			sessionId = null;
			nextDueAt = null;
			startNextCard();
		}
	}

	// ── Start drilling ────────────────────────────────────────────────────────

	function startDrilling(): void {
		started = true;
		if (drillType === 'line') {
			initLineMode();
		} else {
			startNextCard();
		}
	}

	// ── Session restart ────────────────────────────────────────────────────────

	// Reload fresh due cards from the server, then let the page's data $effect
	// handle the reset and startNextCard(). This ensures we don't re-drill cards
	// that were just graded (their due dates are now in the future), and picks
	// up any repertoire change that happened while this page was open.
	function restartSession(): void {
		phase = 'idle'; // hide the complete screen immediately while data loads
		sessionId = null;
		nextDueAt = null;
		params.reload();
	}

	// Toggle sound on/off and persist the preference to the database.
	async function toggleSound(): Promise<void> {
		soundEnabled = !soundEnabled;
		try {
			await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ soundEnabled })
			});
		} catch {
			// Non-critical — the in-session toggle still works even if the save fails.
		}
	}

	return {
		// Reactive state (getters so reactivity crosses the module boundary)
		get allDueCards() {
			return allDueCards;
		},
		get selectedSection() {
			return selectedSection;
		},
		get currentCardIdx() {
			return currentCardIdx;
		},
		get navHistory() {
			return navHistory;
		},
		get currentFen() {
			return currentFen;
		},
		get lastMove() {
			return lastMove;
		},
		get started() {
			return started;
		},
		get phase() {
			return phase;
		},
		get flashColor() {
			return flashColor;
		},
		get revealedSan() {
			return revealedSan;
		},
		get grading() {
			return grading;
		},
		get hintUsed() {
			return hintUsed;
		},
		get hintSquare() {
			return hintSquare;
		},
		get awaitingNext() {
			return awaitingNext;
		},
		get totalReviewed() {
			return totalReviewed;
		},
		get correctCount() {
			return correctCount;
		},
		get sessionId() {
			return sessionId;
		},
		get nextDueAt() {
			return nextDueAt;
		},
		get boardKey() {
			return boardKey;
		},
		get soundEnabled() {
			return soundEnabled;
		},
		get undoSnapshot() {
			return undoSnapshot;
		},
		get undoing() {
			return undoing;
		},

		// Line mode
		get drillType() {
			return drillType;
		},
		get allLines() {
			return allLines;
		},
		get currentLineIdx() {
			return currentLineIdx;
		},
		get currentLine() {
			return currentLine;
		},
		get lineStepIdx() {
			return lineStepIdx;
		},
		get lineCorrect() {
			return lineCorrect;
		},
		get lineTotal() {
			return lineTotal;
		},
		get lineComplete() {
			return lineComplete;
		},

		// Settings-driven modes
		get playbackSpeed() {
			return playbackSpeed;
		},
		get tempoEnabled() {
			return tempoEnabled;
		},
		get tempoRemaining() {
			return tempoRemaining;
		},
		get tempoFraction() {
			return tempoFraction;
		},
		get blindfoldEnabled() {
			return blindfoldEnabled;
		},
		get blindfoldAnnouncement() {
			return blindfoldAnnouncement;
		},

		// Derived
		get sectionCounts() {
			return sectionCounts;
		},
		get filteredCards() {
			return filteredCards;
		},
		get currentCard() {
			return currentCard;
		},
		get fenHistory() {
			return fenHistory;
		},
		get progress() {
			return progress;
		},
		get boardShapes() {
			return boardShapes;
		},
		get currentPositionNote() {
			return currentPositionNote;
		},
		get currentMoveNote() {
			return currentMoveNote;
		},

		// Actions
		syncFromData,
		restartFromData,
		startTempoTimer,
		stopTempoTimer,
		destroy,
		toggleBlindfold,
		toggleSound,
		handleShortcut,
		setSection,
		showHint,
		handleMove,
		submitGrade,
		undoLastGrade,
		handleNext,
		advanceToNextLine,
		switchDrillType,
		startDrilling,
		restartSession
	};
}

export type DrillState = ReturnType<typeof createDrillState>;
