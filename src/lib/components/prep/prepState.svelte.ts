/**
 * prepState.svelte.ts — Svelte 5 runes module for Opponent Prep Mode.
 *
 * Similar to buildState.svelte.ts but tailored for the prep workflow:
 * - No repertoire ownership (moves are sandboxed in prep_moves)
 * - Three-layer display: opponent moves, repertoire coverage, prep moves
 * - Color toggle (White/Black) to switch which side the user is prepping as
 * - Gap detection and priority navigation
 */

// The maps and sets built inside $derived blocks below are rebuilt whole on
// each change and never mutated afterwards, so they are plain Map/Set: the
// reactive versions would only add overhead on big preps.
/* eslint-disable svelte/prefer-svelte-reactivity */

import { untrack } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { Chess } from 'chess.js';
import { playMove, playCapture } from '$lib/sounds';
import { fenKey, STARTING_FEN } from '$lib/fen';
import type {
	opponentMoves as opponentMovesTable,
	prepMoves as prepMovesTable
} from '$lib/db/schema';
import { prepSubtreeIds } from '$lib/prep/subtree';

// ── Types ────────────────────────────────────────────────────────────────────

/** An opponent move row from the database. */
export type OpponentMoveRow = typeof opponentMovesTable.$inferSelect;

/** A prep move row from the database (createdAt arrives as a string from fetch). */
export type PrepMoveRow = Omit<typeof prepMovesTable.$inferSelect, 'createdAt'> & {
	createdAt: Date | string | number;
};

/** Shape of a repertoire coverage entry (read-only). */
export interface CoverageEntry {
	fromFen: string;
	san: string;
	color: string;
	repertoireName?: string;
}

/** Navigation history entry. */
export interface NavEntry {
	fromFen: string;
	toFen: string;
	san: string;
	from: string;
	to: string;
}

/** Gap detection result for a single opponent move. */
export type GapStatus = 'green' | 'yellow' | 'red';

export interface GapInfo {
	positionFen: string;
	moveSan: string;
	resultingFen: string;
	gamesPlayed: number;
	status: GapStatus;
	depth: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveSquares(fen: string, san: string): [string, string] | undefined {
	try {
		const chess = new Chess(fen);
		const result = chess.move(san);
		return result ? [result.from, result.to] : undefined;
	} catch {
		return undefined;
	}
}

/** The position after `san`, or null when it isn't legal there. */
function playedFen(fen: string, san: string): string | null {
	try {
		const chess = new Chess(fen);
		chess.move(san);
		return fenKey(chess.fen());
	} catch {
		return null;
	}
}

// ── State factory ────────────────────────────────────────────────────────────

/** How long filter changes wait for more changes before they're saved. */
export const FILTER_SAVE_DELAY_MS = 500;

interface CreatePrepStateParams {
	getPrepId: () => number;
	getBaseUrl: () => string;
}

export function createPrepState(params: CreatePrepStateParams) {
	// ── Reactive state ───────────────────────────────────────────────────

	let opponentMoves = $state<OpponentMoveRow[]>([]);
	let prepMoves = $state<PrepMoveRow[]>([]);
	let coverageEntries = $state<CoverageEntry[]>([]);

	let navHistory = $state<NavEntry[]>([]);
	let currentFen = $state(STARTING_FEN);
	let lastMove = $state<[string, string] | undefined>(undefined);
	let saving = $state(false);
	let conflictSan = $state<string | null>(null);
	let errorMsg = $state<string | null>(null);

	// Which color the user is prepping as ('white' or 'black').
	// This determines: the board orientation and which opponent moves to show.
	let activeColor = $state<'white' | 'black'>('white');

	// ── Filters ──────────────────────────────────────────────────────────
	let minGames = $state(2);
	const excludedKeys = new SvelteSet<string>();

	// ── Derived: Move lookups ────────────────────────────────────────────

	// Opponent moves indexed by position FEN for O(1) lookup.
	const oppMovesByFen = $derived.by(() => {
		const map = new Map<string, OpponentMoveRow[]>();
		for (const m of opponentMoves) {
			const key = m.positionFen;
			const arr = map.get(key);
			if (arr) arr.push(m);
			else map.set(key, [m]);
		}
		return map;
	});

	// Prep moves indexed by fromFen.
	const prepMovesByFen = $derived.by(() => {
		const map = new Map<string, PrepMoveRow[]>();
		for (const m of prepMoves) {
			const key = fenKey(m.fromFen);
			const arr = map.get(key);
			if (arr) arr.push(m);
			else map.set(key, [m]);
		}
		return map;
	});

	// Repertoire coverage indexed by fromFen.
	const coverageByFen = $derived.by(() => {
		const map = new Map<string, CoverageEntry[]>();
		for (const c of coverageEntries) {
			const key = fenKey(c.fromFen);
			const arr = map.get(key);
			if (arr) arr.push(c);
			else map.set(key, [c]);
		}
		return map;
	});

	// The user's repertoire moves for the active colour, as fromFen → the
	// positions they lead to. Worked out once per data or colour change, so
	// walking the tree never has to build chess.js boards.
	const coverageTargets = $derived.by(() => {
		const userRepColor = activeColor === 'white' ? 'WHITE' : 'BLACK';
		const map = new Map<string, { san: string; toFen: string }[]>();
		for (const c of coverageEntries) {
			if (c.color !== userRepColor) continue;
			const from = fenKey(c.fromFen);
			const toFen = playedFen(from, c.san);
			if (!toFen) continue;
			const arr = map.get(from);
			if (arr) arr.push({ san: c.san, toFen });
			else map.set(from, [{ san: c.san, toFen }]);
		}
		return map;
	});

	// True when it is the user's turn at the current board position.
	const isUserTurn = $derived.by(() => {
		const fenActiveSide = currentFen.split(' ')[1]; // 'w' or 'b'
		return (
			(activeColor === 'white' && fenActiveSide === 'w') ||
			(activeColor === 'black' && fenActiveSide === 'b')
		);
	});

	// ── Turn-based move display ──────────────────────────────────────────
	//
	// Color model reminder:
	//   opponent_color == FEN active side → opponent's choice (what they play)
	//   opponent_color != FEN active side → context move (what their opponents played)
	//
	// On the OPPONENT's turn: show opponent's choices (moves they actually play).
	// On the USER's turn: show suggestions (context = what opponent's opponents played here).

	// Helper: check if a move passes the active filters.
	function passesFilters(m: OpponentMoveRow): boolean {
		if (m.gamesPlayed < minGames) return false;
		if (excludedKeys.has(`${m.positionFen}|${m.moveSan}`)) return false;
		return true;
	}

	// Opponent's actual moves at this position — shown when it's the opponent's turn.
	// These are moves where the opponent was playing as the FEN active side.
	const opponentMovesAtPosition = $derived.by(() => {
		const all = oppMovesByFen.get(fenKey(currentFen)) ?? [];
		const fenActiveSide = currentFen.split(' ')[1];
		return all
			.filter((m) => m.opponentColor === fenActiveSide && passesFilters(m))
			.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
	});

	// Suggestions for the user — shown when it's the user's turn.
	const suggestionsAtPosition = $derived.by(() => {
		const all = oppMovesByFen.get(fenKey(currentFen)) ?? [];
		const fenActiveSide = currentFen.split(' ')[1];
		return all
			.filter((m) => m.opponentColor !== fenActiveSide && passesFilters(m))
			.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
	});

	// Prep moves at the current position, filtered by active color.
	const prepMovesAtPosition = $derived.by(() => {
		return (prepMovesByFen.get(fenKey(currentFen)) ?? []).filter((m) => m.color === activeColor);
	});

	// Repertoire coverage at the current position, filtered by active color.
	const coverageAtPosition = $derived.by(() => {
		const userRepColor = activeColor === 'white' ? 'WHITE' : 'BLACK';
		return (coverageByFen.get(fenKey(currentFen)) ?? []).filter((c) => c.color === userRepColor);
	});

	// Combined move list for the MoveTree component.
	// Merges prep moves (user's responses) and opponent moves (their choices)
	// into a unified format that MoveTree can render.
	const treeMoves = $derived.by(() => {
		const moves: {
			id: number;
			fromFen: string;
			toFen: string;
			san: string;
			source: string;
			notes: null;
			userId: number;
			repertoireId: number;
			createdAt: Date | string | number;
		}[] = [];
		let syntheticId = -1;

		// Add prep moves
		for (const pm of prepMoves) {
			if (pm.color !== activeColor) continue;
			moves.push({
				id: pm.id,
				fromFen: fenKey(pm.fromFen),
				toFen: fenKey(pm.toFen),
				san: pm.san,
				source: 'PREP',
				notes: null,
				userId: pm.userId,
				repertoireId: pm.prepId,
				createdAt: pm.createdAt
			});
		}

		// Add opponent moves that are reachable and pass filters
		for (const om of opponentMoves) {
			if (!passesFilters(om)) continue;
			const fenActive = om.positionFen.split(' ')[1];
			if (om.opponentColor !== fenActive) continue; // Only opponent's actual choices
			moves.push({
				id: syntheticId--,
				fromFen: om.positionFen,
				toFen: om.resultingFen,
				san: om.moveSan,
				source: 'OPPONENT',
				notes: null,
				userId: 0,
				repertoireId: 0,
				createdAt: 0
			});
		}

		return moves;
	});

	// Navigation history as move pairs for display.
	const movePairs = $derived.by(() => {
		const pairs: [NavEntry, NavEntry | null][] = [];
		for (let i = 0; i < navHistory.length; i += 2) {
			pairs.push([navHistory[i], navHistory[i + 1] ?? null]);
		}
		return pairs;
	});

	// ── Gap detection ────────────────────────────────────────────────────

	/**
	 * For a given resulting position after an opponent move, determine
	 * if we have coverage (green), partial coverage (yellow), or no coverage (red).
	 */
	function getGapStatus(resultingFen: string): GapStatus {
		const key = fenKey(resultingFen);
		const userRepColor = activeColor === 'white' ? 'WHITE' : 'BLACK';

		const hasPrepMove = (prepMovesByFen.get(key) ?? []).some((m) => m.color === activeColor);
		if (hasPrepMove) return 'green';

		const hasCoverage = (coverageByFen.get(key) ?? []).some((c) => c.color === userRepColor);
		if (hasCoverage) return 'yellow';

		return 'red';
	}

	// Single BFS walk of the reachable move tree. Produces both gap list and
	// dashboard stats in one pass to avoid duplicating the traversal.
	const treeAnalysis = $derived.by(() => {
		const gaps: GapInfo[] = [];
		let totalPositions = 0;
		let greenCount = 0;
		let yellowCount = 0;
		const visited = new Set<string>();
		const counted = new Set<string>();
		const queue: { fen: string; depth: number }[] = [{ fen: STARTING_FEN, depth: 0 }];

		// An index instead of queue.shift(), which copies the array each time.
		for (let head = 0; head < queue.length; head++) {
			const { fen, depth } = queue[head];
			const key = fenKey(fen);
			if (visited.has(key)) continue;
			visited.add(key);

			const fenActiveSide = fen.split(' ')[1];
			const isUserTurnHere =
				(activeColor === 'white' && fenActiveSide === 'w') ||
				(activeColor === 'black' && fenActiveSide === 'b');

			if (!isUserTurnHere) {
				for (const m of oppMovesByFen.get(key) ?? []) {
					if (!passesFilters(m)) continue;
					if (m.opponentColor !== fenActiveSide) continue;

					const status = getGapStatus(m.resultingFen);

					// Dashboard stats — count each unique resulting position once
					const rKey = fenKey(m.resultingFen);
					if (!counted.has(rKey)) {
						counted.add(rKey);
						totalPositions++;
						if (status === 'green') greenCount++;
						else if (status === 'yellow') yellowCount++;
					}

					// Gap list
					if (status !== 'green') {
						gaps.push({
							positionFen: m.positionFen,
							moveSan: m.moveSan,
							resultingFen: m.resultingFen,
							gamesPlayed: m.gamesPlayed,
							status,
							depth
						});
					}

					queue.push({ fen: m.resultingFen, depth: depth + 1 });
				}
			} else {
				for (const pm of (prepMovesByFen.get(key) ?? []).filter((m) => m.color === activeColor)) {
					queue.push({ fen: fenKey(pm.toFen), depth: depth + 1 });
				}
				for (const c of coverageTargets.get(key) ?? []) {
					queue.push({ fen: c.toFen, depth: depth + 1 });
				}
			}
		}

		gaps.sort((a, b) => {
			const statusWeight = (s: GapStatus) => (s === 'red' ? 2 : 1);
			const wA = statusWeight(a.status) * a.gamesPlayed * (1 / (a.depth + 1));
			const wB = statusWeight(b.status) * b.gamesPlayed * (1 / (b.depth + 1));
			return wB - wA;
		});

		return { gaps, totalPositions, greenCount, yellowCount };
	});

	const allGaps = $derived(treeAnalysis.gaps);
	const totalOpponentPositions = $derived(treeAnalysis.totalPositions);
	const coveredPositions = $derived({
		green: treeAnalysis.greenCount,
		yellow: treeAnalysis.yellowCount
	});

	// ── Sync ─────────────────────────────────────────────────────────────

	// Replay a sequence of SAN moves from the starting position (used by MoveTree).
	function navigateToLine(sans: string[]): void {
		let fen = STARTING_FEN;
		const history: NavEntry[] = [];
		for (const san of sans) {
			try {
				const chess = new Chess(fen);
				const result = chess.move(san);
				if (!result) break;
				history.push({
					fromFen: fen,
					toFen: fenKey(chess.fen()),
					san: result.san,
					from: result.from,
					to: result.to
				});
				fen = fenKey(chess.fen());
			} catch {
				break;
			}
		}
		if (history.length > 0) {
			navHistory = history;
			currentFen = fen;
			lastMove = [history[history.length - 1].from, history[history.length - 1].to];
		}
	}

	function syncFromData(
		newOpponentMoves: OpponentMoveRow[],
		newPrepMoves: PrepMoveRow[],
		newCoverage: CoverageEntry[],
		initialMinGames?: number,
		initialExcluded?: string[]
	): void {
		opponentMoves = newOpponentMoves;
		prepMoves = newPrepMoves;
		coverageEntries = newCoverage;
		errorMsg = null;
		// A reload (after adding to a repertoire, say) keeps the board where it
		// is while every step to it is still in the data.
		// untrack: the page calls this from an effect, which must rerun for new
		// data only, not every time the board moves.
		if (!untrack(pathStillExists)) {
			navHistory = [];
			currentFen = STARTING_FEN;
			lastMove = undefined;
		}

		if (initialMinGames !== undefined) minGames = initialMinGames;
		excludedKeys.clear();
		if (initialExcluded) {
			for (const key of initialExcluded) excludedKeys.add(key);
		}
	}

	/** Whether every move in the current line is still an opponent, prep or repertoire move. */
	function pathStillExists(): boolean {
		return navHistory.every((step) => {
			const from = fenKey(step.fromFen);
			const to = fenKey(step.toFen);
			return (
				(oppMovesByFen.get(from) ?? []).some((m) => fenKey(m.resultingFen) === to) ||
				(prepMovesByFen.get(from) ?? []).some((m) => fenKey(m.toFen) === to) ||
				(coverageTargets.get(from) ?? []).some((c) => c.toFen === to)
			);
		});
	}

	// ── Navigation ───────────────────────────────────────────────────────

	function handleUndo(): void {
		stopAnimation();
		conflictSan = null;
		if (navHistory.length === 0) return;
		const prev = navHistory[navHistory.length - 1];
		navHistory = navHistory.slice(0, -1);
		currentFen = prev.fromFen;
		lastMove =
			navHistory.length > 0
				? [navHistory[navHistory.length - 1].from, navHistory[navHistory.length - 1].to]
				: undefined;
		errorMsg = null;
	}

	function handleReset(): void {
		stopAnimation();
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		conflictSan = null;
		errorMsg = null;
	}

	function clickOpponentMove(san: string, resultingFen: string): void {
		const squares = resolveSquares(currentFen, san);
		if (!squares) return;
		navHistory = [
			...navHistory,
			{
				fromFen: currentFen,
				toFen: resultingFen,
				san,
				from: squares[0],
				to: squares[1]
			}
		];
		currentFen = resultingFen;
		lastMove = squares;
		if (san.includes('x')) playCapture();
		else playMove();
	}

	function navigateToHistoryIdx(idx: number): void {
		navHistory = navHistory.slice(0, idx + 1);
		currentFen = navHistory[idx].toFen;
		lastMove =
			navHistory[idx].from && navHistory[idx].to
				? [navHistory[idx].from, navHistory[idx].to]
				: undefined;
		errorMsg = null;
	}

	/**
	 * Build the full move path from the starting position to a target FEN
	 * by doing a BFS through opponent moves, prep moves, and coverage moves.
	 * Returns an array of NavEntry representing each move in sequence.
	 */
	function buildPathTo(targetFen: string): NavEntry[] {
		const targetKey = fenKey(targetFen);
		if (targetKey === fenKey(STARTING_FEN)) return [];

		const visited = new Set<string>();
		const parent = new Map<string, { fromFen: string; san: string }>();
		const queue: string[] = [STARTING_FEN];
		visited.add(fenKey(STARTING_FEN));

		for (let head = 0; head < queue.length; head++) {
			const fen = queue[head];
			const key = fenKey(fen);

			// Collect all moves from this position (opponent + prep + coverage)
			const moves: { san: string; toFen: string }[] = [];

			// Opponent moves
			for (const m of oppMovesByFen.get(key) ?? []) {
				moves.push({ san: m.moveSan, toFen: m.resultingFen });
			}

			// Prep moves
			for (const m of (prepMovesByFen.get(key) ?? []).filter((m) => m.color === activeColor)) {
				moves.push({ san: m.san, toFen: fenKey(m.toFen) });
			}

			// Coverage moves
			for (const c of coverageTargets.get(key) ?? []) moves.push(c);

			for (const move of moves) {
				const toKey = fenKey(move.toFen);
				if (visited.has(toKey)) continue;
				visited.add(toKey);
				parent.set(toKey, { fromFen: fen, san: move.san });

				if (toKey === targetKey) {
					// Found it — reconstruct the path
					const path: NavEntry[] = [];
					let current = toKey;
					while (parent.has(current)) {
						const p = parent.get(current)!;
						const sq = resolveSquares(p.fromFen, p.san);
						const chess = new Chess(p.fromFen);
						const result = chess.move(p.san);
						path.unshift({
							fromFen: p.fromFen,
							toFen: result ? fenKey(chess.fen()) : current,
							san: p.san,
							from: sq?.[0] ?? '',
							to: sq?.[1] ?? ''
						});
						current = fenKey(p.fromFen);
					}
					return path;
				}

				queue.push(move.toFen);
			}
		}

		return []; // No path found
	}

	// ── Animated gap navigation ─────────────────────────────────────────

	let animationTimer: ReturnType<typeof setTimeout> | undefined;
	const ANIMATION_DELAY_MS = 400;

	function stopAnimation(): void {
		if (animationTimer) clearTimeout(animationTimer);
		animationTimer = undefined;
	}

	function navigateToGap(): void {
		if (allGaps.length === 0) return;
		stopAnimation();

		// Find the first gap the user isn't already looking at.
		const currentKey = fenKey(currentFen);
		let gap = allGaps[0];
		for (const g of allGaps) {
			if (fenKey(g.resultingFen) !== currentKey) {
				gap = g;
				break;
			}
		}

		// Build the full path from the starting position to the gap
		const path = buildPathTo(gap.resultingFen);

		if (path.length === 0) {
			// Fallback: jump directly if no path found
			const squares = resolveSquares(gap.positionFen, gap.moveSan);
			navHistory = squares
				? [
						{
							fromFen: gap.positionFen,
							toFen: gap.resultingFen,
							san: gap.moveSan,
							from: squares[0],
							to: squares[1]
						}
					]
				: [];
			currentFen = gap.resultingFen;
			lastMove = squares ?? undefined;
			errorMsg = null;
			return;
		}

		// Reset board to starting position, then animate through the path
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		errorMsg = null;

		let step = 0;
		function playNext() {
			if (step >= path.length) {
				return;
			}
			const entry = path[step];
			navHistory = path.slice(0, step + 1);
			currentFen = entry.toFen;
			lastMove = entry.from && entry.to ? [entry.from, entry.to] : undefined;
			if (entry.san.includes('x')) playCapture();
			else playMove();
			step++;
			animationTimer = setTimeout(playNext, ANIMATION_DELAY_MS);
		}

		// Small delay before first move so the user sees the starting position
		animationTimer = setTimeout(playNext, ANIMATION_DELAY_MS);
	}

	function toggleColor(): void {
		activeColor = activeColor === 'white' ? 'black' : 'white';
		// Reset navigation when switching color
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		errorMsg = null;
	}

	// ── Move handler (play a prep response on the board) ─────────────────

	async function handlePlayMove(
		from: string,
		to: string,
		san: string,
		newFen: string,
		isCapture = false
	): Promise<void> {
		conflictSan = null;
		errorMsg = null;

		const navigate = () => {
			navHistory = [...navHistory, { fromFen: currentFen, toFen: newFen, san, from, to }];
			currentFen = newFen;
			lastMove = [from, to];
			if (isCapture) playCapture();
			else playMove();
		};

		if (!isUserTurn) {
			// Opponent's turn — just navigate through the tree, no saving
			navigate();
			return;
		}

		// User's turn — check if a move already exists at this position
		const existingPreps = (prepMovesByFen.get(fenKey(currentFen)) ?? []).filter(
			(m) => m.color === activeColor
		);
		if (existingPreps.length > 0) {
			if (existingPreps[0].san === san) {
				// Exact same move — just navigate
				navigate();
				return;
			}
			// Different move exists — conflict, snap board back
			conflictSan = existingPreps[0].san;
			return;
		}

		// New prep move on the user's turn — save it to the database
		saving = true;
		try {
			const res = await fetch(`${params.getBaseUrl()}/api/prep/${params.getPrepId()}/moves`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fromFen: currentFen,
					san,
					color: activeColor
				})
			});

			if (res.status === 409) {
				// Server-side conflict (race condition fallback)
				const body = await res.json();
				conflictSan = body.existing?.san ?? '?';
				return;
			}

			if (!res.ok) {
				errorMsg = 'Failed to save prep move.';
				return;
			}

			const savedMove: PrepMoveRow = await res.json();
			prepMoves = [...prepMoves, savedMove];
			navigate();
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			saving = false;
		}
	}

	// ── Delete prep move ─────────────────────────────────────────────────

	/**
	 * How many prep moves after `moveId` go with it when it's deleted: the
	 * ones no other line on the board still reaches. The server works out the
	 * same set.
	 */
	function followingMoveCount(moveId: number): number {
		return deletionIds(moveId).length - 1;
	}

	function deletionIds(moveId: number): number[] {
		const sameColor = prepMoves.filter((m) => m.color === activeColor);
		const walkable = [
			...opponentMoves.map((m) => ({
				fromFen: m.positionFen,
				toFen: m.resultingFen,
				san: m.moveSan
			})),
			...[...coverageTargets].flatMap(([fromFen, targets]) =>
				targets.map((t) => ({ fromFen, toFen: t.toFen, san: t.san }))
			)
		];
		return prepSubtreeIds(STARTING_FEN, sameColor, walkable, moveId);
	}

	async function deletePrepMove(moveId: number): Promise<void> {
		if (saving) return;
		saving = true;
		errorMsg = null;

		try {
			const res = await fetch(`${params.getBaseUrl()}/api/prep/${params.getPrepId()}/moves`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ moveId })
			});

			if (!res.ok) {
				errorMsg = 'Failed to delete prep move.';
				return;
			}

			const body: { ids?: number[] } = await res.json().catch(() => ({}));
			const removed = new Set(body.ids ?? [moveId]);
			prepMoves = prepMoves.filter((m) => !removed.has(m.id));
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			saving = false;
		}
	}

	// ── Filter actions ──────────────────────────────────────────────────

	// Filter changes are saved once they stop for a moment, one request at a
	// time, and each request sends the state as it is when it goes out, so a
	// slow request can never land after a newer one and save older filters.
	let filterTimer: ReturnType<typeof setTimeout> | undefined;
	let filterSaving: Promise<void> | null = null;
	let filterDirty = false;

	async function saveFilters(): Promise<void> {
		while (filterDirty) {
			filterDirty = false;
			try {
				const res = await fetch(`${params.getBaseUrl()}/api/prep/${params.getPrepId()}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ minGames, excludedMoves: Array.from(excludedKeys) })
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
			} catch {
				errorMsg = "Couldn't save the filter change. It applies until you leave this page.";
			}
		}
		filterSaving = null;
	}

	function persistFilters(): void {
		filterDirty = true;
		clearTimeout(filterTimer);
		filterTimer = setTimeout(() => {
			filterTimer = undefined;
			filterSaving ??= saveFilters();
		}, FILTER_SAVE_DELAY_MS);
	}

	/** Saves a pending filter change now (the page is being left). */
	function flushFilters(): Promise<void> | null {
		if (filterTimer !== undefined) {
			clearTimeout(filterTimer);
			filterTimer = undefined;
			filterSaving ??= saveFilters();
		}
		return filterSaving;
	}

	function setMinGames(n: number): void {
		minGames = Math.max(1, Math.min(100, n));
		persistFilters();
	}

	function excludeMove(fen: string, san: string): void {
		excludedKeys.add(`${fen}|${san}`);
		persistFilters();
	}

	function restoreAllMoves(): void {
		excludedKeys.clear();
		persistFilters();
	}

	// ── Candidate move selection (from CandidateMoves tabs) ─────────────

	async function handleCandidateSelect(san: string): Promise<void> {
		try {
			const chess = new Chess(currentFen);
			const result = chess.move(san);
			if (result) {
				await handlePlayMove(result.from, result.to, result.san, chess.fen(), !!result.captured);
			}
		} catch {
			errorMsg = 'Could not play the selected move.';
		}
	}

	// ── Return public API ────────────────────────────────────────────────

	return {
		// State
		get currentFen() {
			return currentFen;
		},
		get lastMove() {
			return lastMove;
		},
		get navHistory() {
			return navHistory;
		},
		get saving() {
			return saving;
		},
		get conflictSan() {
			return conflictSan;
		},
		get errorMsg() {
			return errorMsg;
		},
		get activeColor() {
			return activeColor;
		},

		// Derived — turn state
		get isUserTurn() {
			return isUserTurn;
		},

		// Derived — current position
		get opponentMovesAtPosition() {
			return opponentMovesAtPosition;
		},
		get suggestionsAtPosition() {
			return suggestionsAtPosition;
		},
		get prepMovesAtPosition() {
			return prepMovesAtPosition;
		},
		get coverageAtPosition() {
			return coverageAtPosition;
		},
		get movePairs() {
			return movePairs;
		},
		get treeMoves() {
			return treeMoves;
		},

		// Derived — gaps
		get allGaps() {
			return allGaps;
		},
		get totalOpponentPositions() {
			return totalOpponentPositions;
		},
		get coveredPositions() {
			return coveredPositions;
		},

		// Gap helper
		getGapStatus,

		// Filters
		get minGames() {
			return minGames;
		},
		get excludedKeys() {
			return excludedKeys;
		},

		// Actions
		syncFromData,
		navigateToLine,
		handleUndo,
		handleReset,
		handlePlayMove,
		handleCandidateSelect,
		clickOpponentMove,
		navigateToHistoryIdx,
		navigateToGap,
		toggleColor,
		deletePrepMove,
		followingMoveCount,
		setMinGames,
		excludeMove,
		restoreAllMoves,
		flushFilters,
		dismissConflict() {
			conflictSan = null;
		},
		dismissError() {
			errorMsg = null;
		}
	};
}

export type PrepState = ReturnType<typeof createPrepState>;
