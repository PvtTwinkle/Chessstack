<!--
	Drill Mode — /drill
	───────────────────
	Spaced repetition practice: surface due cards, play through from move 1,
	pause at the user's turn, grade their response.

	DRILL FLOW
	──────────
	1. Load all due SR cards and all moves from the server.
	2. Filter cards by sub-mode (Main / Punishment / Mixed).
	3. Pick the first due card. Reconstruct the path from move 1 to that position.
	4. Auto-play moves at 500ms intervals until reaching the due position.
	5. Board becomes interactive — user must play the correct move.
	6. Correct: green flash → show Again/Good/Easy buttons → grade → next card.
	7. Wrong:   red flash → show correct move → auto-grade Again → next card.
	8. When queue is empty: show session summary.

	PHASE STATE MACHINE
	───────────────────
	idle → playing → waiting → correct → (grading) → idle (next card)
	                         ↘ incorrect → (auto-grade Again) → idle
	idle (all done) → complete
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import { fenKey, STARTING_FEN } from '$lib/fen';
	import { SvelteMap } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Chess } from 'chess.js';
	import type { PageData } from './$types';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { Key } from '@lichess-org/chessground/types';
	import {
		initSounds,
		setSoundEnabled,
		playMove,
		playCapture,
		playCorrect,
		playIncorrect
	} from '$lib/sounds';
	import { tutorialStep } from '$lib/stores/tutorial';
	import { getEffectiveStartFens, buildInScopeFens } from '$lib/repertoire';

	// Shape of a move row from the server (user_move table).
	interface RepertoireMove {
		id: number;
		fromFen: string;
		toFen: string;
		san: string;
		notes: string | null;
	}

	// Shape of a due SR card from the server (user_repertoire_move table).
	interface DueCard {
		id: number;
		fromFen: string;
		san: string;
		state: number | null;
		due: string | null;
		stability: number | null;
		difficulty: number | null;
		elapsedDays: number | null;
		scheduledDays: number | null;
		reps: number | null;
		lapses: number | null;
		lastReview: string | null;
		learningSteps: number;
		intervalLabels: {
			forgot: string;
			unsure: string;
			easy: string;
		};
	}

	// Snapshot of a card's FSRS state before grading — used for undo.
	interface UndoSnapshot {
		cardId: number;
		wasCorrect: boolean;
		previousState: {
			due: string | null;
			stability: number | null;
			difficulty: number | null;
			elapsedDays: number | null;
			scheduledDays: number | null;
			reps: number | null;
			lapses: number | null;
			state: number | null;
			lastReview: string | null;
			learningSteps: number;
		};
	}

	// One step in the current navigation path through the board.
	interface NavEntry {
		fromFen: string;
		toFen: string;
		san: string;
		from: string;
		to: string;
	}

	// One step in a root-to-leaf line through the repertoire tree.
	interface LineStep {
		fromFen: string;
		toFen: string;
		san: string;
		isUserMove: boolean; // true when it's the user's color to move
	}

	type Phase = 'idle' | 'playing' | 'waiting' | 'correct' | 'incorrect' | 'complete';

	let { data }: { data: PageData } = $props();

	// ── Reactive state ─────────────────────────────────────────────────────────

	// All moves in the repertoire — used for path reconstruction.
	let allMoves = $state<RepertoireMove[]>([]);

	// All due cards loaded from the server.
	let allDueCards = $state<DueCard[]>([]);

	// Which depth section to drill: 'all' = no filter.
	let selectedSection = $state<'all' | DrillSection>('all');

	// Index into filteredCards — which card we're currently drilling.
	let currentCardIdx = $state(0);

	// SAN moves from move 1 to the current due card's fromFen.
	// The auto-play mechanic steps through this list.
	let path = $state<string[]>([]);

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

	// ── Board resize ─────────────────────────────────────────────────────────
	// Fire-and-forget: the ResizableBoard component already shows the new size
	// via localWidth; no invalidateAll() needed (which would reset drill state).
	function handleBoardResize(size: number) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ boardSize: size })
		});
	}

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
	// Restored from ?type=line so the "Drill all lines" link (which does a full
	// page navigation to apply ?mode=all) lands back on the same tab instead
	// of silently reverting to card mode.
	let drillType = $state<'card' | 'line'>(page.url.searchParams.get('type') === 'line' ? 'line' : 'card');

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

	function toggleBlindfold(): void {
		blindfoldEnabled = !blindfoldEnabled;
		if (!blindfoldEnabled) blindfoldAnnouncement = null;
	}

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

	// Preload audio files once on mount so sounds play without latency.
	onMount(() => {
		initSounds();
		return () => {
			stopAutoPlay();
			stopTempoTimer();
		};
	});

	// ── Keyboard shortcuts ─────────────────────────────────────────────────────

	// Register a keydown listener for grading and Next button shortcuts.
	// The $effect cleanup function removes the listener when the component unmounts.
	$effect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
			const nextVisible =
				awaitingNext || phase === 'incorrect' || (phase === 'correct' && hintUsed);
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

		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	});

	// ── Sync from server data ──────────────────────────────────────────────────

	// Runs on mount and again whenever the server data changes (e.g. invalidateAll).
	// IMPORTANT: resetBoard() and startNextCard() are wrapped in untrack() to prevent
	// them from adding filteredCards/allMoves/currentCardIdx as reactive dependencies
	// of this effect. Without untrack, writing allDueCards/drillMode above invalidates
	// filteredCards, and then reading filteredCards inside startNextCard() makes it a
	// dependency — causing this effect to re-run infinitely.
	// Keep the sounds module in sync with soundEnabled state.
	$effect(() => {
		setSoundEnabled(soundEnabled);
	});

	$effect(() => {
		allMoves = data.moves as RepertoireMove[];
		allDueCards = data.dueCards as DueCard[];
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

		untrack(() => {
			resetBoard();
			if (started) {
				if (drillType === 'line') {
					initLineMode();
				} else {
					startNextCard();
				}
			}
		});
	});

	// Start/stop the tempo timer whenever the drill phase changes.
	// When phase becomes 'waiting', start counting down; otherwise, stop.
	// Tempo is disabled in line mode — it doesn't make sense with auto-advancing.
	$effect(() => {
		if (phase === 'waiting' && drillType === 'card') {
			untrack(() => startTempoTimer());
		} else {
			untrack(() => stopTempoTimer());
		}
	});

	// ── Derived ───────────────────────────────────────────────────────────────

	// How many due cards fall into each depth section.
	const sectionCounts = $derived({
		foundations: allDueCards.filter((c) => getSection(c.fromFen) === 'foundations').length,
		mainlines: allDueCards.filter((c) => getSection(c.fromFen) === 'mainlines').length,
		deep: allDueCards.filter((c) => getSection(c.fromFen) === 'deep').length
	});

	// Due cards filtered to the selected section (or all if 'all').
	const filteredCards = $derived(
		selectedSection === 'all'
			? allDueCards
			: allDueCards.filter((c) => getSection(c.fromFen) === selectedSection)
	);

	// Number of lines that will actually be drilled if line mode is started
	// right now (due-filtered unless drillMode is 'all') — computed eagerly so
	// the start screen shows the real count instead of the due-card count.
	// totalLineCount is the unfiltered count, used to tell apart "repertoire
	// has no lines at all yet" from "every line is already reviewed" — the
	// "No lines to drill" empty state below used to conflate the two.
	const lineCounts = $derived.by(() => {
		if (drillType !== 'line') return { total: 0, due: 0 };
		const raw = enumerateLines(allMoves, data.repertoire.color as 'WHITE' | 'BLACK');
		const scoped =
			data.drillMode === 'all' ? raw : raw.filter((line) => lineHasDueStep(line, allDueCards));
		return { total: raw.length, due: scoped.length };
	});
	const dueLineCount = $derived(lineCounts.due);
	const totalLineCount = $derived(lineCounts.total);

	// The card being drilled right now.
	const currentCard = $derived(filteredCards[currentCardIdx] ?? null);

	// The FENs from the navigation history, newest-first, for OpeningName.
	const fenHistory = $derived([...navHistory].reverse().map((e) => e.fromFen));

	// Orientation: white at bottom for white repertoires.
	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

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

	// ── Utility functions ──────────────────────────────────────────────────────

	// Formats the next-due timestamp into a human-readable string for the end screen.
	// e.g. "Today at 2:30 PM", "Tomorrow at 9:00 AM", "In 3 days".
	function formatNextSession(isoStr: string): string {
		const due = new Date(isoStr);
		const now = new Date();

		// Strip time components to compare calendar days only.
		const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

		const timeStr = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

		if (diffDays === 0) return `Today at ${timeStr}`;
		if (diffDays === 1) return `Tomorrow at ${timeStr}`;
		return `In ${diffDays} days`;
	}

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

	// Use Chess.js to find which square the correct piece moves FROM.
	// Returns null if the SAN can't be found in the current position (shouldn't happen).
	function getHintSquare(fen: string, san: string): string | null {
		const chess = new Chess(fen);
		const move = chess.moves({ verbose: true }).find((m) => m.san === san);
		return move?.from ?? null;
	}

	// Resolve a SAN move in a position to its origin and destination squares.
	function getMoveSquares(fen: string, san: string): { from: string; to: string } | null {
		try {
			const chess = new Chess(fen);
			const result = chess.move(san);
			return result ? { from: result.from, to: result.to } : null;
		} catch {
			return null;
		}
	}

	// Show the hint: highlight the source square of the correct move.
	// Guard against calling more than once per card or outside the waiting phase.
	function showHint(): void {
		if (hintUsed || !currentCard || phase !== 'waiting') return;
		hintSquare = getHintSquare(currentFen, currentCard.san);
		hintUsed = true;
	}

	// ── Depth section helpers ─────────────────────────────────────────────────

	type DrillSection = 'foundations' | 'mainlines' | 'deep';

	// Extract the full-move number from a FEN string (6th field, 1-indexed).
	function getMoveNumber(fen: string): number {
		return parseInt(fen.split(' ')[5], 10) || 1;
	}

	// Map a FEN to one of the three depth sections.
	function getSection(fen: string): DrillSection {
		const move = getMoveNumber(fen);
		if (move <= 5) return 'foundations';
		if (move <= 15) return 'mainlines';
		return 'deep';
	}

	// Reconstruct the sequence of SAN moves from the starting position to
	// `targetFen` by walking the move tree backwards.
	// When multiple paths exist (transpositions), any one is chosen — all are
	// equally valid for giving context before the due position.
	function reconstructPath(moves: RepertoireMove[], targetFen: string): string[] {
		// Build a reverse map: normalised(toFen) → { fromFen, san }
		const reverse = new SvelteMap<string, { fromFen: string; san: string }>();
		for (const m of moves) {
			reverse.set(fenKey(m.toFen), { fromFen: m.fromFen, san: m.san });
		}

		const pathSans: string[] = [];
		let current = fenKey(targetFen);
		const startKey = fenKey(STARTING_FEN);

		// Walk backward until we reach the starting position or get stuck.
		while (current !== startKey) {
			const prev = reverse.get(current);
			if (!prev) break; // position not reachable from our tree — stop
			pathSans.unshift(prev.san);
			current = fenKey(prev.fromFen);
		}

		return pathSans;
	}

	// ── Line enumeration ──────────────────────────────────────────────────────

	// Enumerate all root-to-leaf lines through the repertoire's move tree.
	// A "leaf" is any position with no outgoing edges. Each line is an ordered
	// list of LineSteps from the starting position to the leaf.
	//
	// Lead-in moves (before the repertoire's effective start position — see
	// getEffectiveStartFens) are still walked and auto-played for context,
	// but are never marked isUserMove, even when they fall on the user's own
	// turn. This mirrors card mode and the Gap Finder, which both exclude
	// lead-in positions from what's actively drilled — the "Set Start"
	// button in Build Mode promises exactly that ("moves before it won't be
	// drilled"), which line mode did not previously honor.
	function enumerateLines(moves: RepertoireMove[], color: 'WHITE' | 'BLACK'): LineStep[][] {
		const adj = new SvelteMap<string, RepertoireMove[]>();
		for (const m of moves) {
			const key = fenKey(m.fromFen);
			const list = adj.get(key);
			if (list) list.push(m);
			else adj.set(key, [m]);
		}

		const startFens = getEffectiveStartFens(data.repertoire.startFen ?? null, moves, color);
		const inScope = buildInScopeFens(startFens, moves);

		const lines: LineStep[][] = [];
		const MAX_LINES = 500;

		function isUserTurn(fen: string): boolean {
			const sideToMove = fen.split(' ')[1]; // 'w' or 'b'
			return (color === 'WHITE' && sideToMove === 'w') || (color === 'BLACK' && sideToMove === 'b');
		}

		function dfs(fen: string, path: LineStep[], visited: Set<string>): void {
			if (lines.length >= MAX_LINES) return;

			const children = adj.get(fenKey(fen)) ?? [];
			if (children.length === 0) {
				// Leaf — only record if path has at least one user move.
				if (path.some((s) => s.isUserMove)) {
					lines.push([...path]);
				}
				return;
			}

			for (const child of children) {
				const toKey = fenKey(child.toFen);
				if (visited.has(toKey)) continue; // cycle protection

				visited.add(toKey);
				path.push({
					fromFen: child.fromFen,
					toFen: child.toFen,
					san: child.san,
					isUserMove: isUserTurn(child.fromFen) && inScope.has(fenKey(child.fromFen))
				});
				dfs(child.toFen, path, visited);
				path.pop();
				visited.delete(toKey);
			}
		}

		const startKey = fenKey(STARTING_FEN);
		const visited = new Set<string>([startKey]);
		dfs(STARTING_FEN, [], visited);
		return lines;
	}

	// Score a line by how many weak/due SR cards it contains.
	// Higher score = more urgent to drill.
	function scoreLine(line: LineStep[], dueCards: DueCard[]): number {
		const dueSet = new Set(dueCards.map((c) => fenKey(c.fromFen) + ':' + c.san));
		const cardMap = new SvelteMap<string, DueCard>();
		for (const c of dueCards) {
			cardMap.set(fenKey(c.fromFen) + ':' + c.san, c);
		}

		let score = 0;
		for (const step of line) {
			if (!step.isUserMove) continue;
			const key = fenKey(step.fromFen) + ':' + step.san;
			if (dueSet.has(key)) {
				score += 3;
			} else {
				const card = cardMap.get(key);
				if (card && (card.lapses ?? 0) > 0) score += 1;
			}
		}
		return score;
	}

	// Whether a line contains at least one step matching a currently-due card.
	// Used to scope line mode to "due" the same way card mode already is —
	// enumerateLines produces every line in the tree regardless of due
	// status, sortLinesByWeakness only orders them, so without this filter
	// "due" line-mode sessions silently drilled (and auto-graded) the whole
	// repertoire, duplicating what the existing "Drill all cards" link
	// (?mode=all) is for.
	function lineHasDueStep(line: LineStep[], dueCards: DueCard[]): boolean {
		const dueSet = new Set(dueCards.map((c) => fenKey(c.fromFen) + ':' + c.san));
		return line.some((s) => s.isUserMove && dueSet.has(fenKey(s.fromFen) + ':' + s.san));
	}

	// Sort lines by score descending, breaking ties randomly.
	function sortLinesByWeakness(lines: LineStep[][], dueCards: DueCard[]): LineStep[][] {
		const scored = lines.map((line) => ({
			line,
			score: scoreLine(line, dueCards),
			rand: Math.random()
		}));
		scored.sort((a, b) => b.score - a.score || a.rand - b.rand);
		return scored.map((s) => s.line);
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
		path = reconstructPath(allMoves, card.fromFen);

		resetBoard();
		phase = 'playing';
		startAutoPlay(path);
	}

	// Auto-play moves from `pathMoves` one at a time with a 500ms delay.
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
					body: JSON.stringify({ repertoireId: data.repertoire.id })
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
		if ($tutorialStep === 4 && totalReviewed >= 2) {
			fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tutorialStep: 5 })
			}).then(() => invalidateAll());
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

	// Advance to the next card after the user clicks "Next".
	async function advanceToNext(): Promise<void> {
		undoSnapshot = null; // Undo window closes when moving to the next card.
		currentCardIdx++;
		resetBoard();

		// If this was the last card, finalize the session record and retrieve
		// the next-due timestamp to show on the end screen.
		if (currentCardIdx >= filteredCards.length && sessionId !== null) {
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
				body: JSON.stringify({ repertoireId: data.repertoire.id })
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

	// Initialize line mode: enumerate lines, filter to due unless in "all"
	// mode, sort, and start the first line.
	function initLineMode(): void {
		const color = data.repertoire.color as 'WHITE' | 'BLACK';
		const raw = enumerateLines(allMoves, color);
		const scoped =
			data.drillMode === 'all' ? raw : raw.filter((line) => lineHasDueStep(line, allDueCards));
		allLines = sortLinesByWeakness(scoped, allDueCards);
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
			// All lines done — finalize session. lineComplete must be reset here,
			// otherwise the template's if/else chain (which checks lineComplete
			// before phase === 'complete') keeps re-rendering the same
			// "Line complete" interstitial forever, making the Next Line button
			// appear to do nothing on the last line of the queue.
			lineComplete = false;
			if (sessionId !== null) {
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
			phase = 'complete';
			return;
		}

		startNextLine();
	}

	// Switch between card and line drill modes.
	function switchDrillType(type: 'card' | 'line'): void {
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

	// Reload fresh due cards from the server, then let the $effect handle the
	// reset and startNextCard(). This ensures we don't re-drill cards that were
	// just graded (their due dates are now in the future), and picks up any
	// repertoire change that happened while this page was open.
	function restartSession(): void {
		phase = 'idle'; // hide the complete screen immediately while data loads
		sessionId = null;
		nextDueAt = null;
		// Reset to the start screen rather than auto-resuming a session: the
		// data reload below may find nothing left due, and letting the start
		// screen (with its own "All caught up!" / due-count branches) handle
		// that is simpler than re-deriving the same distinction further down
		// in the started-session branches, which exist for switchDrillType's
		// sake but shouldn't also have to cover this path.
		started = false;
		invalidateAll();
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
</script>

<div class="page">
	<!-- ── Board column ──────────────────────────────────────────────────────── -->
	<div class="board-col">
		<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={handleBoardResize}>
			<div class="board-wrap" class:blindfold={blindfoldEnabled}>
				{#key boardKey}
					<ChessBoard
						fen={currentFen}
						{orientation}
						boardTheme={data.settings?.boardTheme ?? 'blue'}
						interactive={phase === 'waiting'}
						lastMove={blindfoldEnabled ? undefined : lastMove}
						autoShapes={boardShapes}
						onMove={handleMove}
					/>
				{/key}

				<!-- Green/red flash overlay on correct/incorrect -->
				{#if flashColor}
					<div
						class="flash-overlay"
						class:flash-correct={flashColor === 'green'}
						class:flash-incorrect={flashColor === 'red'}
					></div>
				{/if}

				<!-- Blindfold move announcement -->
				{#if blindfoldAnnouncement}
					<div class="blindfold-announce">{blindfoldAnnouncement}</div>
				{/if}

				<!-- Auto-play indicator -->
				{#if phase === 'playing'}
					<div class="autoplay-badge">▶ Playing through…</div>
				{/if}
			</div>
		</ResizableBoard>
	</div>

	<!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
	<div class="sidebar">
		<!-- Repertoire identity -->
		<div class="rep-header">
			<span class="rep-icon"
				><span
					class="color-dot {data.repertoire.color === 'WHITE'
						? 'color-dot--white'
						: 'color-dot--black'}"
				></span></span
			>
			<span class="rep-name">{data.repertoire.name}</span>
			<span
				class="color-badge"
				class:badge-white={data.repertoire.color === 'WHITE'}
				class:badge-black={data.repertoire.color === 'BLACK'}
			>
				{data.repertoire.color === 'WHITE' ? 'White' : 'Black'}
			</span>
			<button
				class="mute-btn"
				class:muted={!soundEnabled}
				onclick={toggleSound}
				title={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
				aria-label={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
			>
				{soundEnabled ? '🔊' : '🔇'}
			</button>
			<button
				class="mute-btn"
				class:muted={blindfoldEnabled}
				onclick={toggleBlindfold}
				title={blindfoldEnabled ? 'Disable blindfold' : 'Enable blindfold'}
				aria-label={blindfoldEnabled ? 'Disable blindfold' : 'Enable blindfold'}
			>
				{blindfoldEnabled ? '🙈' : '👁️'}
			</button>
		</div>

		<!-- Drill-all mode banner -->
		{#if data.drillMode === 'all'}
			<div class="drill-all-banner">
				{data.fromFen ? 'Drilling subtree' : 'Drilling all cards'}
				<a href="/drill" class="drill-all-exit">Exit</a>
			</div>
		{/if}

		<!-- Drill type toggle: Cards vs Lines -->
		{#if phase !== 'complete'}
			<div class="drill-type-toggle">
				<button
					class="drill-type-btn"
					class:active={drillType === 'card'}
					onclick={() => switchDrillType('card')}
				>
					Cards
				</button>
				<button
					class="drill-type-btn"
					class:active={drillType === 'line'}
					onclick={() => switchDrillType('line')}
				>
					Lines
				</button>
			</div>
		{/if}

		<!-- ECO opening name -->
		<OpeningName {currentFen} {fenHistory} />

		<!-- Depth section filter (card mode only) -->
		{#if drillType === 'card' && allDueCards.length > 0 && phase !== 'complete'}
			<div class="section-filter">
				<div class="section-label">FOCUS</div>
				<div class="section-tabs">
					<button
						class="section-tab"
						class:active={selectedSection === 'all'}
						onclick={() => setSection('all')}
					>
						All Moves <span class="tab-count">{allDueCards.length}</span>
					</button>
					<button
						class="section-tab"
						class:active={selectedSection === 'foundations'}
						class:dimmed={sectionCounts.foundations === 0}
						onclick={() => setSection('foundations')}
					>
						Foundation (1–5) <span class="tab-count">{sectionCounts.foundations}</span>
					</button>
					<button
						class="section-tab"
						class:active={selectedSection === 'mainlines'}
						class:dimmed={sectionCounts.mainlines === 0}
						onclick={() => setSection('mainlines')}
					>
						Mainlines (6–15) <span class="tab-count">{sectionCounts.mainlines}</span>
					</button>
					<button
						class="section-tab"
						class:active={selectedSection === 'deep'}
						class:dimmed={sectionCounts.deep === 0}
						onclick={() => setSection('deep')}
					>
						Deep Lines (16+) <span class="tab-count">{sectionCounts.deep}</span>
					</button>
				</div>
			</div>
		{/if}

		<!-- Progress bar -->
		{#if started && drillType === 'card' && phase !== 'complete' && filteredCards.length > 0}
			<div class="progress-section">
				<div class="progress-label">
					Card {Math.min(currentCardIdx + 1, filteredCards.length)} of {filteredCards.length}
				</div>
				<div class="progress-bar">
					<div class="progress-fill" style="width: {progress * 100}%"></div>
				</div>
			</div>
		{:else if started && drillType === 'line' && phase !== 'complete' && allLines.length > 0}
			<div class="progress-section">
				<div class="progress-label">
					Line {Math.min(currentLineIdx + 1, allLines.length)} of {allLines.length}
				</div>
				<div class="progress-bar">
					<div
						class="progress-fill"
						style="width: {(currentLineIdx / allLines.length) * 100}%"
					></div>
				</div>
				{#if currentLine.length > 0 && !lineComplete}
					<div class="progress-sub">
						Move {Math.min(lineStepIdx + 1, lineTotal)} of {lineTotal} in this line
					</div>
				{/if}
			</div>
		{/if}

		<!-- ── Phase-specific content ─────────────────────────────────────────── -->

		{#if !started}
			<!-- Start screen — shown before the user begins drilling -->
			{#if (drillType === 'card' && allDueCards.length === 0) || (drillType === 'line' && dueLineCount === 0)}
				<div class="empty-state">
					<div class="empty-icon">✓</div>
					<p class="empty-title">All caught up!</p>
					<p class="empty-hint">
						No cards due right now. Come back later or build more repertoire.
					</p>
					<a href="/build" class="btn btn--primary">Build Mode</a>
					<a href="/drill?mode=all{drillType === 'line' ? '&type=line' : ''}" class="btn btn--secondary"
						>Drill all {drillType === 'line' ? 'lines' : 'cards'}</a
					>
				</div>
			{:else}
				<div class="start-screen">
					<div class="start-count">
						{drillType === 'card' ? filteredCards.length : dueLineCount}
					</div>
					<div class="start-label">{drillType === 'card' ? 'cards' : 'lines'} to drill</div>

					{#if drillType === 'card'}
						<div class="start-breakdown">
							<div class="start-breakdown-row">
								<span>Foundations (1–5)</span>
								<span>{sectionCounts.foundations}</span>
							</div>
							<div class="start-breakdown-row">
								<span>Mainlines (6–15)</span>
								<span>{sectionCounts.mainlines}</span>
							</div>
							<div class="start-breakdown-row">
								<span>Deep Lines (16+)</span>
								<span>{sectionCounts.deep}</span>
							</div>
						</div>
					{/if}

					<button
						class="btn btn--primary start-btn"
						disabled={(drillType === 'card' && filteredCards.length === 0) ||
							(drillType === 'line' && dueLineCount === 0)}
						onclick={startDrilling}
					>
						Start Drilling <kbd>Space</kbd>
					</button>
				</div>
			{/if}
		{:else if drillType === 'line' && lineComplete}
			<!-- Line-complete interstitial -->
			<div class="line-complete-screen">
				<div class="feedback feedback--correct">
					<span class="feedback-icon">✓</span> Line complete
				</div>
				<div class="complete-stats">
					<div class="stat-row">
						<span class="stat-label">Moves correct</span>
						<span class="stat-value">
							{lineCorrect} / {lineTotal}
							{#if lineTotal > 0}
								<span class="stat-pct">({Math.round((lineCorrect / lineTotal) * 100)}%)</span>
							{/if}
						</span>
					</div>
				</div>
				<button class="btn btn--primary next-btn" onclick={advanceToNextLine}>
					Next Line <kbd>Space</kbd>
				</button>
				<a
					href="/build?line={encodeURIComponent(currentLine.map((s) => s.san).join(','))}"
					class="btn btn--secondary"
				>
					Build from this line
				</a>
			</div>
		{:else if drillType === 'line' && allLines.length === 0 && phase !== 'playing' && totalLineCount === 0}
			<!-- Line mode, repertoire truly has no complete lines yet -->
			<div class="empty-state">
				<div class="empty-icon">✓</div>
				<p class="empty-title">No lines to drill</p>
				<p class="empty-hint">Your repertoire has no complete lines yet. Build more moves first.</p>
				<a href="/build" class="btn btn--primary">Build Mode</a>
			</div>
		{:else if drillType === 'line' && allLines.length === 0 && phase !== 'playing'}
			<!-- Line mode, repertoire has lines but none are currently due — same
			     messaging as the pre-start empty state, reached here because
			     "Drill again" re-runs initLineMode() without a full page reload. -->
			<div class="empty-state">
				<div class="empty-icon">✓</div>
				<p class="empty-title">All caught up!</p>
				<p class="empty-hint">No cards due right now. Come back later or build more repertoire.</p>
				<a href="/build" class="btn btn--primary">Build Mode</a>
				<a href="/drill?mode=all&type=line" class="btn btn--secondary">Drill all lines</a>
			</div>
		{:else if drillType === 'card' && allDueCards.length === 0}
			<!-- No cards due -->
			<div class="empty-state">
				<div class="empty-icon">✓</div>
				<p class="empty-title">All caught up!</p>
				<p class="empty-hint">No cards due right now. Come back later or build more repertoire.</p>
				<a href="/build" class="btn btn--primary">Build Mode</a>
				<a href="/drill?mode=all" class="btn btn--secondary">Drill all cards</a>
			</div>
		{:else if drillType === 'card' && filteredCards.length === 0}
			<!-- Due cards exist but none match the selected section -->
			<div class="empty-state">
				<p class="empty-title">No cards in this range</p>
				<p class="empty-hint">Try a different section, or select "All" to drill everything.</p>
			</div>
		{:else if phase === 'complete'}
			<!-- Session complete screen -->
			<div class="complete-screen">
				<div class="complete-title">Session complete</div>
				<div class="complete-stats">
					<div class="stat-row">
						<span class="stat-label"
							>{drillType === 'line' ? 'Moves reviewed' : 'Cards reviewed'}</span
						>
						<span class="stat-value">{totalReviewed}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Correct first try</span>
						<span class="stat-value">
							{correctCount}
							{#if totalReviewed > 0}
								<span class="stat-pct">({Math.round((correctCount / totalReviewed) * 100)}%)</span>
							{/if}
						</span>
					</div>
					{#if drillType === 'line'}
						<div class="stat-row">
							<span class="stat-label">Lines drilled</span>
							<span class="stat-value">{currentLineIdx}</span>
						</div>
					{/if}
					<div class="stat-row">
						<span class="stat-label">Next session</span>
						<span class="stat-value">
							{#if nextDueAt}
								{formatNextSession(nextDueAt)}
							{:else}
								—
							{/if}
						</span>
					</div>
				</div>
				<button class="btn btn--primary" onclick={restartSession}> Drill again </button>
				<a href="/" class="btn btn--secondary">Dashboard</a>
			</div>
		{:else if phase === 'playing'}
			<!-- Auto-playing through the line -->
			<div class="section">
				<div class="section-label">PLAYING THROUGH LINE</div>
				<p class="phase-hint">Watch the moves — your turn is coming…</p>
			</div>

			<!-- Current line display -->
			{#if navHistory.length > 0}
				<div class="section">
					<div class="section-label">CURRENT LINE</div>
					<div class="move-list">
						{#each navHistory as entry, i (i)}
							{#if i % 2 === 0}
								<span class="move-num">{Math.floor(i / 2) + 1}.</span>
							{/if}
							<span class="move-san move-san--auto">{entry.san}</span>
						{/each}
					</div>
				</div>
			{/if}
		{:else if phase === 'waiting'}
			<!-- User's turn to play -->
			<div class="turn-indicator user-turn">
				<span class="turn-dot"></span>
				YOUR TURN <span class="turn-hint">— play your move</span>
			</div>

			<!-- Tempo countdown bar (card mode only) -->
			{#if drillType === 'card' && tempoEnabled}
				<div class="tempo-bar-wrap">
					<div
						class="tempo-bar-fill"
						class:tempo-warning={tempoFraction <= 0.5 && tempoFraction > 0.2}
						class:tempo-danger={tempoFraction <= 0.2}
						style="width: {tempoFraction * 100}%"
					></div>
					<span class="tempo-label">{tempoRemaining}s</span>
				</div>
			{/if}

			<!-- Hint button / hint-active indicator (card mode only) -->
			{#if drillType === 'card'}
				{#if !hintUsed}
					<button class="hint-btn" onclick={showHint}>💡 Hint</button>
				{:else}
					<div class="hint-active">
						<span>💡 Hint active — piece highlighted</span>
						<span class="hint-penalty">Move will be graded Forgot</span>
					</div>
				{/if}
			{/if}

			<!-- Current line display -->
			{#if navHistory.length > 0}
				<div class="section">
					<div class="section-label">CURRENT LINE</div>
					<div class="move-list">
						{#each navHistory as entry, i (i)}
							{#if i % 2 === 0}
								<span class="move-num">{Math.floor(i / 2) + 1}.</span>
							{/if}
							<span class="move-san move-san--auto">{entry.san}</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Revealed correct move (line mode: shown briefly on wrong answer) -->
			{#if drillType === 'line' && revealedSan}
				<div class="section">
					<div class="section-label">CORRECT MOVE</div>
					<div class="revealed-move">{revealedSan}</div>
				</div>
			{/if}

			<!-- Note on the opponent's last move (the move that reached this position) -->
			{#if drillType === 'card' && currentPositionNote}
				<div class="note-box">
					<div class="note-label">NOTE</div>
					<div class="note-text">{currentPositionNote}</div>
				</div>
			{/if}
		{:else if phase === 'correct'}
			<!-- Correct! Show grading buttons or Next (if hint-used / already graded). -->
			<div class="feedback feedback--correct">
				<span class="feedback-icon">✓</span>
				{hintUsed ? 'Correct! (hint used)' : 'Correct!'}
			</div>

			{#if navHistory.length > 0}
				<div class="section">
					<div class="section-label">CURRENT LINE</div>
					<div class="move-list">
						{#each navHistory as entry, i (i)}
							{#if i % 2 === 0}
								<span class="move-num">{Math.floor(i / 2) + 1}.</span>
							{/if}
							<span class="move-san move-san--auto">{entry.san}</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Note on the card's move (the user's annotation for this move) -->
			{#if currentMoveNote}
				<div class="note-box">
					<div class="note-label">NOTE</div>
					<div class="note-text">{currentMoveNote}</div>
				</div>
			{/if}

			{#if hintUsed}
				<!-- Hint was used — will be graded Again when Next is clicked. -->
				<p class="auto-advance-hint">Will be graded as Forgot</p>
				<button class="btn btn--primary next-btn" onclick={handleNext}>
					Next <kbd>Space</kbd>
				</button>
			{:else if awaitingNext}
				<!-- Already graded — show Next + Undo buttons. -->
				<div class="next-row">
					<button class="btn btn--primary next-btn" onclick={handleNext}>
						Next <kbd>Space</kbd>
					</button>
					{#if undoSnapshot}
						<button class="btn btn--ghost undo-btn" onclick={undoLastGrade} disabled={undoing}>
							Undo <kbd>Z</kbd>
						</button>
					{/if}
				</div>
			{:else}
				<div class="section">
					<div class="section-label">HOW CONFIDENT WAS YOUR RESPONSE?</div>
					<div class="grade-buttons">
						<button
							class="grade-btn grade-btn--forgot"
							onclick={() => submitGrade(1)}
							disabled={grading}
						>
							<span class="grade-label">Forgot</span>
							{#if currentCard?.intervalLabels}
								<span class="grade-interval">{currentCard.intervalLabels.forgot}</span>
							{/if}
						</button>
						<button
							class="grade-btn grade-btn--unsure"
							onclick={() => submitGrade(3)}
							disabled={grading}
						>
							<span class="grade-label">Unsure</span>
							{#if currentCard?.intervalLabels}
								<span class="grade-interval">{currentCard.intervalLabels.unsure}</span>
							{/if}
						</button>
						<button
							class="grade-btn grade-btn--easy"
							onclick={() => submitGrade(4)}
							disabled={grading}
						>
							<span class="grade-label">Easy</span>
							{#if currentCard?.intervalLabels}
								<span class="grade-interval">{currentCard.intervalLabels.easy}</span>
							{/if}
						</button>
					</div>
					<div class="shortcut-hints">
						<span class="shortcut"><kbd>1</kbd> Forgot</span>
						<span class="shortcut"><kbd>2</kbd> Unsure</span>
						<span class="shortcut"><kbd>3</kbd> Easy</span>
					</div>
				</div>
			{/if}
		{:else if phase === 'incorrect'}
			<!-- Wrong move — reveal the correct answer, show note, and Next button. -->
			<div class="feedback feedback--incorrect">
				<span class="feedback-icon">✗</span> Incorrect
			</div>

			{#if revealedSan}
				<div class="section">
					<div class="section-label">CORRECT MOVE</div>
					<div class="revealed-move">{revealedSan}</div>
				</div>
			{/if}

			<!-- Note on the card's move (the user's annotation for this move) -->
			{#if currentMoveNote}
				<div class="note-box">
					<div class="note-label">NOTE</div>
					<div class="note-text">{currentMoveNote}</div>
				</div>
			{/if}

			<p class="auto-advance-hint">Will be graded as Forgot</p>
			<button class="btn btn--primary next-btn" onclick={handleNext}>
				Next <kbd>Space</kbd>
			</button>
		{/if}
	</div>
</div>

<style>
	/* ── Page layout ──────────────────────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.board-col {
		width: 100%;
	}

	.board-wrap {
		position: relative; /* needed for overlays */
		width: 100%;
	}

	.sidebar {
		width: 100%;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	/* Tablet (768px – 1023px) — --bp-md */
	@media (min-width: 768px) {
		.page {
			display: grid;
			grid-template-columns: auto 280px;
			gap: var(--space-4);
			align-items: start;
			justify-content: center;
			padding: 0;
		}
	}

	/* Desktop (≥1024px) — --bp-lg */
	@media (min-width: 1024px) {
		.page {
			grid-template-columns: auto 340px;
			gap: var(--space-6);
			max-width: 1100px;
			margin: 0 auto;
		}
	}

	/* ── Section filter tabs ─────────────────────────────────────────────────── */

	.section-filter {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-tabs {
		display: flex;
		gap: 0.35rem;
	}

	.section-tab {
		flex: 1;
		padding: 0.35rem 0.25rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.7rem;
		font-family: var(--font-body);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-snap);
		text-align: center;
	}

	.section-tab:hover {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
	}

	.section-tab.active {
		background: rgba(91, 127, 164, 0.15);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.section-tab.dimmed {
		opacity: 0.45;
	}

	.section-tab.dimmed:hover {
		opacity: 0.7;
	}

	.tab-count {
		font-weight: 400;
		opacity: 0.6;
		font-size: 0.65rem;
	}

	/* ── Board overlays ──────────────────────────────────────────────────────── */

	.flash-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: 2px;
		animation: flash-fade 0.6s ease-out forwards;
	}

	.flash-correct {
		background: rgba(74, 222, 128, 0.35);
	}

	.flash-incorrect {
		background: rgba(248, 113, 113, 0.35);
	}

	@keyframes flash-fade {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.autoplay-badge {
		position: absolute;
		bottom: var(--space-2);
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-family: var(--font-body);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		pointer-events: none;
		white-space: nowrap;
	}

	/* ── Drill-all banner ───────────────────────────────────────────────────── */

	.drill-all-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--color-accent-subtle, rgba(59, 130, 246, 0.1));
		border: 1px solid var(--color-accent, #3b82f6);
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-accent, #3b82f6);
	}

	.drill-all-exit {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-decoration: underline;
	}

	/* ── Repertoire header ───────────────────────────────────────────────────── */

	.rep-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.rep-icon {
		font-size: 1.2rem;
		line-height: 1;
	}

	.rep-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text-primary);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-sm);
		font-family: var(--font-body);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		flex-shrink: 0;
	}

	.badge-white {
		background: var(--color-surface);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.badge-black {
		background: var(--color-base);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	/* ── Mute toggle button ───────────────────────────────────────────────────── */

	.mute-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0.1rem var(--space-1);
		border-radius: var(--radius-sm);
		opacity: 0.6;
		transition: opacity var(--dur-fast) var(--ease-snap);
		flex-shrink: 0;
	}

	.mute-btn:hover {
		opacity: 1;
	}

	.mute-btn.muted {
		opacity: 0.35;
	}

	/* ── Blindfold mode ─────────────────────────────────────────────────────── */
	.board-wrap.blindfold :global(.cg-wrap piece) {
		opacity: 0 !important;
	}

	.board-wrap.blindfold :global(cg-board square.move-dest) {
		background: none !important;
	}

	.board-wrap.blindfold :global(cg-board square.oc.move-dest) {
		background: none !important;
	}

	.board-wrap.blindfold :global(cg-board square.selected) {
		background-color: transparent !important;
	}

	.blindfold-announce {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2.5rem;
		font-weight: 700;
		color: white;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
		pointer-events: none;
		z-index: 3;
	}

	/* ── Hint button ──────────────────────────────────────────────────────────── */

	.hint-btn {
		width: 100%;
		padding: 0.45rem;
		border-radius: var(--radius-md);
		border: 1px solid rgba(91, 127, 164, 0.35);
		background: rgba(91, 127, 164, 0.08);
		color: var(--color-accent);
		font-size: 0.8rem;
		font-family: var(--font-body);
		cursor: pointer;
		transition: filter var(--dur-fast) var(--ease-snap);
	}

	.hint-btn:hover {
		filter: brightness(1.2);
		box-shadow: var(--glow-accent);
	}

	.hint-active {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid rgba(91, 127, 164, 0.25);
		background: rgba(91, 127, 164, 0.06);
		font-size: 0.78rem;
		color: var(--color-accent-dim);
	}

	.hint-penalty {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		font-style: italic;
	}

	/* ── Keyboard shortcut hints ──────────────────────────────────────────────── */

	.shortcut-hints {
		display: flex;
		gap: var(--space-4);
		margin-top: var(--space-2);
	}

	.shortcut {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	kbd {
		display: inline-block;
		padding: 0.05rem 0.3rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: 0.65rem;
		font-family: var(--font-body);
		line-height: 1.4;
	}

	/* ── Progress bar ─────────────────────────────────────────────────────────── */

	.progress-section {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		box-shadow: var(--shadow-surface);
	}

	.progress-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.progress-bar {
		height: 6px;
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		border-radius: var(--radius-sm);
		transition: width var(--dur-base) ease;
	}

	/* ── Section headings and move list ──────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-label {
		font-size: 11px;
		font-family: var(--font-body);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.move-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: 0.85rem;
	}

	.move-num {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.move-san--auto {
		color: var(--color-text-secondary);
	}

	/* ── Turn indicator ───────────────────────────────────────────────────────── */

	.turn-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
	}

	.turn-indicator.user-turn {
		background: rgba(91, 127, 164, 0.1);
		border-color: rgba(91, 127, 164, 0.3);
		color: var(--color-accent);
	}

	.turn-dot {
		width: var(--space-2);
		height: var(--space-2);
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	.turn-hint {
		font-weight: 400;
		font-size: 0.75rem;
		opacity: 0.8;
	}

	/* ── Feedback banners ─────────────────────────────────────────────────────── */

	.feedback {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-3);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		font-weight: 600;
		box-shadow: var(--shadow-surface);
	}

	.feedback--correct {
		background: rgba(74, 222, 128, 0.12);
		border: 1px solid rgba(74, 222, 128, 0.35);
		color: var(--color-success);
	}

	.feedback--incorrect {
		background: rgba(248, 113, 113, 0.12);
		border: 1px solid rgba(248, 113, 113, 0.35);
		color: var(--color-danger);
	}

	.feedback-icon {
		font-size: 1.1rem;
	}

	/* ── Grading buttons ──────────────────────────────────────────────────────── */

	.grade-buttons {
		display: flex;
		gap: var(--space-2);
	}

	.grade-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--space-3) var(--space-2);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		font-size: 0.8rem;
		font-family: var(--font-body);
		font-weight: 700;
		cursor: pointer;
		transition: filter var(--dur-fast) var(--ease-snap);
	}

	.grade-interval {
		font-size: 0.65rem;
		font-weight: 500;
		opacity: 0.75;
	}

	.grade-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.grade-btn:not(:disabled):hover {
		filter: brightness(1.15);
	}

	.grade-btn--forgot {
		background: rgba(248, 113, 113, 0.18);
		border-color: rgba(248, 113, 113, 0.45);
		color: var(--color-danger);
	}

	.grade-btn--unsure {
		background: rgba(91, 127, 164, 0.15);
		border-color: rgba(91, 127, 164, 0.4);
		color: var(--color-accent);
	}

	.grade-btn--easy {
		background: rgba(74, 222, 128, 0.18);
		border-color: rgba(74, 222, 128, 0.45);
		color: var(--color-success);
	}

	/* ── Revealed correct move ────────────────────────────────────────────────── */

	.revealed-move {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--color-accent);
		padding: 0.3rem 0;
	}

	/* ── Phase hints ─────────────────────────────────────────────────────────── */

	.phase-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.auto-advance-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
		font-style: italic;
	}

	/* ── Empty state ──────────────────────────────────────────────────────────── */

	.empty-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) 0;
	}

	.empty-icon {
		font-size: 2rem;
		color: var(--color-success);
	}

	.empty-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.empty-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.5;
	}

	/* ── Session complete screen ──────────────────────────────────────────────── */

	.complete-screen {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-2) 0;
	}

	.complete-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.complete-stats {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.stat-label {
		color: var(--color-text-secondary);
	}

	.stat-value {
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.stat-pct {
		color: var(--color-text-secondary);
		font-weight: 400;
	}

	/* ── Generic buttons ──────────────────────────────────────────────────────── */

	.btn {
		display: block;
		text-align: center;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
		font-family: var(--font-body);
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		border: 1px solid transparent;
		transition: filter var(--dur-fast) var(--ease-snap);
	}

	.btn:hover {
		filter: brightness(1.15);
	}

	.btn--primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-base);
	}

	.btn--primary:hover:not(:disabled) {
		box-shadow: var(--glow-accent);
	}

	.btn--secondary {
		background: var(--color-surface);
		border-color: var(--color-border);
		color: var(--color-text-secondary);
	}

	.btn--secondary:hover {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
	}

	/* ── Note box (annotations) ──────────────────────────────────────────────── */

	.note-box {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border-left: 3px solid var(--color-accent);
		background: var(--color-accent-glow);
	}

	.note-label {
		font-size: 0.6rem;
		font-family: var(--font-body);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--color-accent);
		text-transform: uppercase;
	}

	.note-text {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		line-height: 1.45;
		font-style: italic;
		white-space: pre-wrap;
	}

	/* ── Next + Undo buttons ─────────────────────────────────────────────────── */

	.next-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.next-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		flex: 1;
	}

	.next-btn kbd {
		font-size: 0.6rem;
		opacity: 0.5;
	}

	.undo-btn {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border-color: var(--color-border);
		color: var(--color-text-secondary);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.undo-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
	}

	.undo-btn kbd {
		font-size: 0.6rem;
		opacity: 0.5;
	}

	/* ── Tempo timer bar ─────────────────────────────────────────────────────── */

	.tempo-bar-wrap {
		position: relative;
		height: 6px;
		background: var(--color-surface-alt);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: var(--space-3);
	}

	.tempo-bar-fill {
		height: 100%;
		border-radius: 3px;
		background: var(--color-success);
		transition:
			width 0.1s linear,
			background 0.3s ease;
	}

	.tempo-bar-fill.tempo-warning {
		background: var(--color-accent);
	}

	.tempo-bar-fill.tempo-danger {
		background: var(--color-danger);
	}

	.tempo-label {
		position: absolute;
		right: 0;
		top: -18px;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* ── Drill type toggle ────────────────────────────────────────────── */

	.drill-type-toggle {
		display: flex;
		gap: 0.35rem;
	}

	.drill-type-btn {
		flex: 1;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.8rem;
		font-family: var(--font-body);
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		transition: all var(--dur-fast) var(--ease-snap);
	}

	.drill-type-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
	}

	.drill-type-btn.active {
		background: rgba(91, 127, 164, 0.15);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	/* ── Line-complete interstitial ───────────────────────────────────── */

	.line-complete-screen {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* ── Progress sub-label ──────────────────────────────────────────── */

	.progress-sub {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-top: 0.15rem;
	}

	/* ── Start screen ────────────────────────────────────────────────── */

	.start-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) 0;
	}

	.start-count {
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1;
	}

	.start-label {
		font-size: 0.95rem;
		color: var(--color-text-secondary);
		margin-top: calc(-1 * var(--space-2));
	}

	.start-breakdown {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	.start-breakdown-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}

	.start-btn {
		width: 100%;
		margin-top: var(--space-2);
	}

	/* ── Tablets and phones (< 768px) ── --bp-md */
	@media (max-width: 767px) {
		.section-tab {
			min-height: 44px;
			font-size: 0.8rem;
			padding: var(--space-2) var(--space-3);
			display: flex;
			align-items: center;
			justify-content: center;
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.page {
			padding: var(--space-2);
			gap: var(--space-2);
		}

		.sidebar {
			padding: var(--space-3);
			gap: var(--space-3);
		}

		.grade-btn {
			min-height: 44px;
			padding: var(--space-2);
		}

		.grade-buttons {
			gap: var(--space-1);
		}
	}
</style>
