/**
 * reviewState.svelte.ts — Svelte 5 runes module for Review Mode.
 *
 * All reactive state ($state, $derived) and action functions for the
 * analysis screen live here. The +page.svelte calls createReviewState()
 * during component init and wires the returned state/actions to the
 * template and child components.
 *
 * ISSUE TYPES
 * ───────────
 * DEVIATION         — user's turn; played a different move than repertoire
 * BEYOND_REPERTOIRE — user's turn; no repertoire move at all for this position
 * OPPONENT_SURPRISE — opponent's turn; played a move user hasn't prepared for
 *
 * For each issue the user can: resolve it (fail card, add to repertoire, etc.)
 * or skip it. Issue-keyed state (loading, errors, chain legs, …) is keyed by
 * issue.ply.
 */

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { Chess } from 'chess.js';
import type { GameAnalysis, GameIssue } from '$lib/pgn';
import { playMove, playCapture } from '$lib/sounds';
import { STARTING_FEN, fenKey } from '$lib/fen';
import {
	computeCpl as cplForPly,
	evalBadgeClass as evalBadge,
	formatEval as evalFormat,
	formatPositionEval as positionEvalLabel,
	getCplClass,
	type CplClass,
	type PlayerColor,
	type PositionEval
} from '$lib/review/evaluation';
import {
	analysisCutoffPly,
	buildChainLeg as buildLeg,
	findUserMove,
	issuesByPly,
	moveColor,
	reviewBoardShapes,
	type ChainLeg,
	type RepertoireMoveRow
} from '$lib/review/analysis';
import { getEngine, type Engine } from '$lib/engine/engine';
import { evaluateGame, evaluatePosition } from '$lib/engine/evaluate';

export type { ChainLeg };

// Lichess Masters top-move row for DEVIATION issues (lazy-loaded on expand).
export interface MastersMove {
	san: string;
	white: number;
	draws: number;
	black: number;
	totalGames: number;
}

interface CreateReviewStateParams {
	// The active repertoire (used unless the server or the user picked another).
	getRepertoireId: () => number;
	// Moves loaded with the page, for client-side transposition detection.
	getMoves: () => readonly RepertoireMoveRow[];
	// Auto-play delay between moves in ms (Settings → Drill).
	getPlaybackSpeed: () => number;
	// Depth and time limit for single-position evals (Settings → Analysis).
	getEngineSettings: () => { depth: number; timeoutMs: number };
	// The in-browser Stockfish; tests pass a fake.
	engine?: Pick<Engine, 'analyse'>;
}

export function createReviewState(params: CreateReviewStateParams) {
	const engine = () => params.engine ?? getEngine();

	// ── Input / analysis hand-off (shared with ReviewInput) ─────────────────────

	let analysisError = $state<string | null>(null);
	// The imported game currently being reviewed (set when the user clicks "Review")
	let importedGameId = $state<number | null>(null);
	// Override repertoire ID (when reviewing an imported game against a specific repertoire)
	let overrideRepertoireId = $state<number | null>(null);

	// ── Analysis state ──────────────────────────────────────────────────────────

	let analysis = $state<GameAnalysis | null>(null);
	let parsedPgn = $state<string | null>(null);
	let analysisHeaders = $state<Record<string, string>>({});
	let analysedPlayerColor = $state<PlayerColor>('WHITE');
	let analysisRepName = $state<string | null>(null);
	let currentPlyIdx = $state(0); // 0 = starting position, N = position after ply N
	let isAutoPlaying = $state(false);
	let autoPlayTarget = $state<number | null>(null);
	const resolvedIssues = new SvelteSet<number>(); // issue.ply values of resolved issues
	const opponentMoveAdded = new SvelteSet<number>(); // OPPONENT_SURPRISE issues where phase 1 is done
	let notes = $state('');
	const actionError = new SvelteMap<number, string>(); // issue.ply → error message
	const actionLoading = new SvelteMap<number, boolean>();

	// ── Chain extension state ────────────────────────────────────────────────────
	// Keyed by issue.ply — only one active chain leg per issue at a time.
	const chainExtensions = new SvelteMap<number, ChainLeg>();

	// ── Client-side repertoire lookup (for transposition detection) ──────────
	// Tracks user-turn moves added during this review session so buildChainLeg()
	// can detect when the chain walks into a position already in the repertoire.
	const addedUserMoves = new SvelteMap<string, string>(); // fenKey → san

	// Evals for DEVIATION issues: evalCp from White's perspective after each move.
	// Fetched in the background when analysis loads; populated as results arrive.
	const deviationEvals = new SvelteMap<number, { played: number | null; correct: number | null }>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive to avoid $effect loop
	const deviationFetching = new Set<number>();

	// ── Masters data for DEVIATION issues (lazy-loaded on expand) ───────────────

	const deviationMasters = new SvelteMap<number, MastersMove[]>();
	const deviationMastersLoading = new SvelteMap<number, boolean>();
	const deviationMastersError = new SvelteMap<number, boolean>();
	const deviationMastersExpanded = new SvelteSet<number>();

	// ── Full-game engine evaluation (CPL classification) ────────────────────────
	// positionEvals maps position index → engine eval from white's perspective.
	// index 0 = starting position, index N = position after ply N.
	const positionEvals = new SvelteMap<number, PositionEval>();
	let evalProgress = $state<{ done: number; total: number } | null>(null);
	let evalAbortController = $state<AbortController | null>(null);

	// ── Hover arrow state (for ReviewIssuePicker → board arrow) ─────────────────

	let hoveredFen = $state<string | null>(null);
	let hoveredSan = $state<string | null>(null);

	// ── "Add to new repertoire" inline form state ──────────────────────────────

	let newRepIssuePly = $state<number | null>(null); // which issue is showing the form
	let newRepName = $state('');

	// ── Save state ──────────────────────────────────────────────────────────────

	let saving = $state(false);
	let savedId = $state<number | null>(null);

	// ── Derived values ──────────────────────────────────────────────────────────

	// Which UI state are we in?
	const pageState = $derived<'input' | 'analysis' | 'saved'>(
		savedId !== null ? 'saved' : analysis !== null ? 'analysis' : 'input'
	);

	// The FEN currently shown on the board.
	const currentFen = $derived(
		analysis ? (analysis.fenHistory[currentPlyIdx] ?? STARTING_FEN) : STARTING_FEN
	);

	// Last move for the yellow highlight on the board.
	const lastMove = $derived<[string, string] | undefined>(
		analysis && currentPlyIdx > 0
			? [analysis.fromSquares[currentPlyIdx - 1], analysis.toSquares[currentPlyIdx - 1]]
			: undefined
	);

	// Board orientation — use the analysed player color (which may differ from
	// the active repertoire's color when the server auto-matched a different one).
	const orientation = $derived<'white' | 'black'>(
		analysedPlayerColor === 'WHITE' ? 'white' : 'black'
	);

	// FEN history for OpeningName (positions from newest to oldest, without currentFen).
	const openingFenHistory = $derived(
		analysis ? analysis.fenHistory.slice(0, currentPlyIdx).reverse() : []
	);

	// Lookup map: issue.ply → GameIssue (for quick colour lookups in the move list).
	const issueByPly = $derived(issuesByPly(analysis));

	// The ply after which analysis stopped (off-book territory).
	const cutoffPly = $derived(analysisCutoffPly(analysis));

	// Arrows drawn on the board (deviation, chain phase A, hovered candidate).
	const boardShapes = $derived(
		reviewBoardShapes({
			analysis,
			currentPlyIdx,
			resolvedIssues,
			chainExtensions,
			hoveredFen,
			hoveredSan
		})
	);

	// Number of issues the user resolved (shown on the saved screen).
	const resolvedCount = $derived(
		analysis ? analysis.issues.filter((i) => resolvedIssues.has(i.ply)).length : 0
	);

	// The repertoire that actions and saving target.
	function targetRepertoireId(): number {
		return overrideRepertoireId ?? params.getRepertoireId();
	}

	// Combines server-loaded moves with session additions for transposition checks.
	function getUserMoveAt(fen: string): string | undefined {
		// Session additions take priority (may have replaced an existing move).
		const added = addedUserMoves.get(fenKey(fen));
		if (added !== undefined) return added;
		return findUserMove(params.getMoves(), targetRepertoireId(), analysedPlayerColor, fen);
	}

	// ── Auto-play ────────────────────────────────────────────────────────────────

	function stopAutoPlay(): void {
		autoPlayTarget = null;
		isAutoPlaying = false;
	}

	function startAutoPlay(targetPly: number): void {
		if (currentPlyIdx >= targetPly) return;
		autoPlayTarget = targetPly;
		isAutoPlaying = true;
	}

	// Play the correct sound when advancing forward to `ply`.
	function playMoveSound(ply: number): void {
		const san = analysis?.sanHistory[ply - 1] ?? '';
		if (san.includes('x')) playCapture();
		else playMove();
	}

	// Move forward one ply — cancels auto-play, plays sound.
	function goForward(): void {
		stopAutoPlay();
		if (!analysis) return;
		const next = Math.min(analysis.fenHistory.length - 1, currentPlyIdx + 1);
		if (next !== currentPlyIdx) {
			currentPlyIdx = next;
			playMoveSound(next);
		}
	}

	// Move backward one ply — cancels auto-play, no sound.
	function goBack(): void {
		stopAutoPlay();
		currentPlyIdx = Math.max(0, currentPlyIdx - 1);
	}

	// Drives auto-play animation. This $effect re-runs whenever currentPlyIdx
	// or autoPlayTarget changes. It schedules the next increment after the
	// playback delay, and the cleanup return value cancels any pending timer
	// automatically — the Svelte 5 pattern for timer-driven animation.
	$effect(() => {
		if (autoPlayTarget === null || currentPlyIdx >= autoPlayTarget) return;

		const nextPly = currentPlyIdx + 1;
		// Capture SAN synchronously so the setTimeout closure has it without
		// needing to read reactive state inside the async callback.
		const san = analysis?.sanHistory[nextPly - 1] ?? '';

		const timer = setTimeout(() => {
			currentPlyIdx = nextPly;
			if (san.includes('x')) playCapture();
			else playMove();
			if (nextPly >= (autoPlayTarget ?? 0)) {
				autoPlayTarget = null;
				isAutoPlaying = false;
			}
		}, params.getPlaybackSpeed());

		return () => clearTimeout(timer);
	});

	// ── Loading an analysis ─────────────────────────────────────────────────────

	// Store the result of the analyzeGame form action. On failure, show the
	// error. Called from the page's $effect inside untrack(), so none of the
	// reads here become dependencies of that effect (mutations from background
	// fetches would otherwise re-trigger it).
	function applyFormResult(form: Record<string, unknown>): void {
		if (typeof form.error === 'string') {
			analysisError = form.error;
			return;
		}

		if (!form.analysis) return;

		analysis = form.analysis as GameAnalysis;
		parsedPgn = form.parsedPgn as string;
		analysisHeaders = (form.headers as Record<string, string>) ?? {};
		analysedPlayerColor = (form.playerColor as PlayerColor) ?? 'WHITE';

		// Store the server-selected repertoire ID so saving targets the right
		// repertoire (which may differ from the active one if the server
		// auto-matched by opening moves).
		if (form.repertoireId && typeof form.repertoireId === 'number') {
			overrideRepertoireId = form.repertoireId;
		}
		analysisRepName = (form.repertoireName as string) ?? null;

		// Reset per-analysis state.
		currentPlyIdx = 0;
		notes = '';
		savedId = null;
		analysisError = null;
		resolvedIssues.clear();
		opponentMoveAdded.clear();
		chainExtensions.clear();
		addedUserMoves.clear();
		actionLoading.clear();
		actionError.clear();
		deviationEvals.clear();
		deviationFetching.clear();
		deviationMasters.clear();
		deviationMastersLoading.clear();
		deviationMastersError.clear();
		deviationMastersExpanded.clear();
		positionEvals.clear();
		evalAbortController?.abort();
		evalAbortController = null;
		evalProgress = null;
		hoveredFen = null;
		hoveredSan = null;
		newRepIssuePly = null;
		newRepName = '';

		// Auto-play from the start up to the first issue (or end of game if clean).
		const loaded = form.analysis as GameAnalysis;
		const targetPly =
			loaded.issues.length > 0 ? loaded.issues[0].ply : loaded.fenHistory.length - 1;
		startAutoPlay(targetPly);

		// Fetch evals for DEVIATION issues in the background (fire and forget).
		for (const issue of loaded.issues) {
			if (issue.type === 'DEVIATION') fetchDeviationEvals(issue);
		}

		// Kick off full-game engine evaluation for CPL classification.
		startBatchEval(loaded);
	}

	// ── Engine and masters data ─────────────────────────────────────────────────

	// Fetch Stockfish evals for a DEVIATION issue (wrong move and correct alternative).
	// Both positions are evaluated in parallel and results stored in deviationEvals.
	// evalCp is always from White's perspective (positive = White better).
	async function fetchDeviationEvals(issue: GameIssue): Promise<void> {
		if (deviationFetching.has(issue.ply)) return;
		deviationFetching.add(issue.ply);
		try {
			// Compute the FEN after the correct repertoire move.
			let correctToFen: string | null = null;
			if (issue.repertoireSan) {
				try {
					const chess = new Chess(issue.fromFen);
					chess.move(issue.repertoireSan);
					correctToFen = chess.fen();
				} catch {
					/* ignore */
				}
			}

			const evalPos = async (fen: string): Promise<number | null> => {
				try {
					const score = await evaluatePosition(engine(), fen, params.getEngineSettings());
					return score?.evalCp ?? null;
				} catch {
					return null;
				}
			};

			const [playedEval, correctEval] = await Promise.all([
				evalPos(issue.toFen),
				correctToFen ? evalPos(correctToFen) : Promise.resolve(null)
			]);

			deviationEvals.set(issue.ply, { played: playedEval, correct: correctEval });
		} finally {
			deviationFetching.delete(issue.ply);
		}
	}

	// Kick off background evaluation of all positions in the game. Results
	// arrive one position at a time and progressively update positionEvals /
	// colors.
	async function startBatchEval(gameAnalysis: GameAnalysis): Promise<void> {
		// Abort any in-flight evaluation from a previous analysis.
		evalAbortController?.abort();

		const controller = new AbortController();
		evalAbortController = controller;

		const fens = gameAnalysis.fenHistory;
		evalProgress = { done: 0, total: fens.length };

		try {
			await evaluateGame(
				engine(),
				fens,
				(index, score) => {
					positionEvals.set(index, score);
					evalProgress = { done: index + 1, total: fens.length };
				},
				controller.signal
			);
		} catch {
			// Engine failure: the game simply shows without accuracy colours.
		} finally {
			// A newer analysis may already have taken over the progress bar.
			if (evalAbortController === controller) evalProgress = null;
		}
	}

	// Fetch Lichess Masters top moves for a DEVIATION's position (lazy, cache-first).
	async function fetchDeviationMasters(issue: GameIssue): Promise<void> {
		if (deviationMasters.has(issue.ply) || deviationMastersLoading.get(issue.ply)) return;
		deviationMastersLoading.set(issue.ply, true);
		deviationMastersError.set(issue.ply, false);
		try {
			const res = await fetch(`/api/masters?fen=${encodeURIComponent(issue.fromFen)}`);
			if (!res.ok) throw new Error('Masters fetch failed');
			const data = await res.json();
			deviationMasters.set(issue.ply, ((data.moves as MastersMove[]) ?? []).slice(0, 5));
		} catch {
			deviationMastersError.set(issue.ply, true);
		} finally {
			deviationMastersLoading.set(issue.ply, false);
		}
	}

	// Toggle Masters section visibility for a DEVIATION issue; lazy-fetch on first expand.
	function toggleMasters(issue: GameIssue): void {
		if (deviationMastersExpanded.has(issue.ply)) {
			deviationMastersExpanded.delete(issue.ply);
		} else {
			deviationMastersExpanded.add(issue.ply);
			fetchDeviationMasters(issue);
		}
	}

	// ── Display helpers bound to this analysis ──────────────────────────────────
	// Pure versions live in $lib/review/evaluation and $lib/review/analysis.

	const formatEval = (cp: number) => evalFormat(cp, analysedPlayerColor);
	const evalBadgeClass = (cp: number) => evalBadge(cp, analysedPlayerColor);
	const formatPositionEval = (ev: PositionEval) => positionEvalLabel(ev, analysedPlayerColor);
	function getCplClassForPly(ply: number): CplClass | null {
		const cpl = cplForPly(ply, positionEvals);
		return cpl !== null ? getCplClass(cpl) : null;
	}
	const getMoveColor = (ply: number) =>
		moveColor(ply, analysedPlayerColor, positionEvals, issueByPly, cutoffPly);

	function handleHoverMove(fen: string, san: string | null): void {
		hoveredFen = san ? fen : null;
		hoveredSan = san;
	}

	// ── Issue resolution actions ─────────────────────────────────────────────────

	// Resolve an issue without any action (skip).
	function resolveIssue(ply: number): void {
		resolvedIssues.add(ply);
	}

	async function callApi(path: string, body: Record<string, unknown>): Promise<void> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(text || `Request failed (${res.status})`);
		}
	}

	// Shared loading/error bookkeeping for the per-issue actions: marks the
	// issue as loading, clears its previous error, and records a new one if
	// the action throws (falling back to `fallbackError` for empty messages).
	async function runIssueAction(
		ply: number,
		fallbackError: string,
		action: () => Promise<void>
	): Promise<void> {
		actionLoading.set(ply, true);
		actionError.delete(ply);
		try {
			await action();
		} catch (e) {
			actionError.set(ply, (e instanceof Error ? e.message : String(e)) || fallbackError);
		} finally {
			actionLoading.set(ply, false);
		}
	}

	// Case 1 — DEVIATION: mark FSRS card as failed.
	function handleFailCard(issue: GameIssue): Promise<void> {
		return runIssueAction(issue.ply, 'Failed to update card', async () => {
			await callApi('/api/review/fail-card', {
				repertoireId: targetRepertoireId(),
				fromFen: issue.fromFen
			});
			resolveIssue(issue.ply);
		});
	}

	// Case 1 — DEVIATION: update repertoire to the move the user actually played,
	// and also fail the SR card.
	function handleUpdateRepertoire(issue: GameIssue): Promise<void> {
		return runIssueAction(issue.ply, 'Failed to update repertoire', async () => {
			// Fail the card first (it's a deviation regardless of what we do with the repertoire).
			await callApi('/api/review/fail-card', {
				repertoireId: targetRepertoireId(),
				fromFen: issue.fromFen
			});
			// Replace the existing move in the repertoire with what the user played.
			await callApi('/api/review/add-move', {
				repertoireId: targetRepertoireId(),
				fromFen: issue.fromFen,
				san: issue.playedSan,
				forceReplace: true
			});
			addedUserMoves.set(fenKey(issue.fromFen), issue.playedSan);
			resolveIssue(issue.ply);
		});
	}

	// Case 3 — OPPONENT_SURPRISE, phase 1: add only the opponent's move.
	// Moves the card to phase 2 where the ReviewIssuePicker renders and
	// CandidateMoves handles fetching book/masters/engine data automatically.
	function handleAddOpponentMove(issue: GameIssue): Promise<void> {
		return runIssueAction(issue.ply, 'Failed to add move', async () => {
			await callApi('/api/review/add-move', {
				repertoireId: targetRepertoireId(),
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			opponentMoveAdded.add(issue.ply);
		});
	}

	// Case 3b — OPPONENT_SURPRISE, phase 1: create a new repertoire, add the
	// opponent's move to it, then continue as normal in phase 2.
	async function handleAddOpponentMoveNewRep(issue: GameIssue): Promise<void> {
		const name = newRepName.trim();
		if (!name) return;
		return runIssueAction(issue.ply, 'Failed to create repertoire', async () => {
			// Create the new repertoire (same color as current analysis).
			const repRes = await fetch('/api/repertoires', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, color: analysedPlayerColor })
			});
			if (!repRes.ok) throw new Error('Failed to create repertoire');
			const newRep = (await repRes.json()) as { id: number };

			// Switch the rest of this review to use the new repertoire.
			overrideRepertoireId = newRep.id;

			// Add the opponent's move to the new repertoire.
			await callApi('/api/review/add-move', {
				repertoireId: newRep.id,
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			opponentMoveAdded.add(issue.ply);
			newRepIssuePly = null;
			newRepName = '';
		});
	}

	// Show the "Add to new repertoire" inline form for an issue.
	function openNewRepForm(issuePly: number): void {
		newRepIssuePly = issuePly;
		newRepName = '';
	}

	function closeNewRepForm(): void {
		newRepIssuePly = null;
		newRepName = '';
	}

	// Build a chain leg for a given opponent ply in the current game.
	function buildChainLeg(opponentPlyInGame: number): ChainLeg | null {
		if (!analysis) return null;
		return buildLeg(analysis, opponentPlyInGame, getUserMoveAt);
	}

	// ── Chain extension handlers ─────────────────────────────────────────────────
	// These run when the user is working through a chain leg (phase 3+) rather
	// than the original issue phases. All are keyed by the original issue.ply.

	// Chain phase A — add the opponent's move for the current chain leg.
	// Transitions to chain phase B where ReviewIssuePicker renders and
	// CandidateMoves handles fetching book/masters/engine data automatically.
	async function handleChainAddOpponent(issuePly: number): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg) return;
		return runIssueAction(issuePly, 'Failed to add move', async () => {
			await callApi('/api/review/add-move', {
				repertoireId: targetRepertoireId(),
				fromFen: leg.opponentFen,
				san: leg.opponentSan
			});
			chainExtensions.set(issuePly, { ...leg, opponentAdded: true });
			currentPlyIdx = leg.plyInGame; // advance board to position after opponent's move
		});
	}

	// User clicks "Done" anywhere in the chain — stop extending, mark resolved.
	function skipChain(issuePly: number): void {
		chainExtensions.delete(issuePly);
		resolveIssue(issuePly);
	}

	// ── Unified response handlers (used by ReviewIssuePicker) ───────────────────

	// Called when user picks a move from ReviewIssuePicker for an original issue
	// (OPPONENT_SURPRISE phase 2 or BEYOND_REPERTOIRE). Saves the move, then
	// checks if the game continues and offers to chain-extend.
	function handlePickResponseMove(issue: GameIssue, san: string): Promise<void> {
		const fromFen = issue.type === 'OPPONENT_SURPRISE' ? issue.toFen : issue.fromFen;
		const gameSan = issue.type === 'OPPONENT_SURPRISE' ? issue.userResponseSan : issue.playedSan;
		return runIssueAction(issue.ply, 'Failed to add move', async () => {
			await callApi('/api/review/add-move', {
				repertoireId: targetRepertoireId(),
				fromFen,
				san
			});
			addedUserMoves.set(fenKey(fromFen), san);
			// If the picked move matches the game continuation, try to chain-extend.
			if (san === gameSan) {
				const nextOpponentPly = issue.type === 'OPPONENT_SURPRISE' ? issue.ply + 2 : issue.ply + 1;
				const leg = buildChainLeg(nextOpponentPly);
				if (leg) {
					const advancePly = issue.type === 'OPPONENT_SURPRISE' ? issue.ply + 1 : issue.ply;
					currentPlyIdx = advancePly;
					chainExtensions.set(issue.ply, leg);
					return;
				}
			}
			resolveIssue(issue.ply);
		});
	}

	// Called when user picks a move from ReviewIssuePicker during a chain leg
	// (phase B — choosing a response after the chain opponent's move was added).
	async function handlePickChainResponse(issuePly: number, san: string): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg || !leg.userFen) return;
		const userFen = leg.userFen;
		return runIssueAction(issuePly, 'Failed to add move', async () => {
			await callApi('/api/review/add-move', {
				repertoireId: targetRepertoireId(),
				fromFen: userFen,
				san
			});
			addedUserMoves.set(fenKey(userFen), san);
			if (san === leg.userSan) {
				// Same move as the game — advance the chain.
				const nextLeg = buildChainLeg(leg.plyInGame + 2);
				if (nextLeg) {
					currentPlyIdx = leg.plyInGame + 1;
					chainExtensions.set(issuePly, nextLeg);
					return;
				}
			}
			chainExtensions.delete(issuePly);
			resolveIssue(issuePly);
		});
	}

	// ── Transposition handlers ──────────────────────────────────────────────────
	// Called from the chain-extension UI when buildChainLeg() detected that the
	// user-response position already has a repertoire move (transposition).

	// Fail the SR card for the existing repertoire move (user deviated from it in-game).
	async function handleTranspositionFailCard(issuePly: number): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg?.userFen || !leg.transposition) return;
		const userFen = leg.userFen;
		return runIssueAction(issuePly, 'Failed to fail card', async () => {
			await callApi('/api/review/fail-card', {
				repertoireId: targetRepertoireId(),
				fromFen: userFen
			});
			chainExtensions.delete(issuePly);
			resolveIssue(issuePly);
		});
	}

	// Replace the existing repertoire move at the transposition with the user's game move.
	async function handleTranspositionReplace(issuePly: number): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg?.userFen || !leg.userSan) return;
		const userFen = leg.userFen;
		const userSan = leg.userSan;
		return runIssueAction(issuePly, 'Failed to replace move', async () => {
			await callApi('/api/review/add-move', {
				repertoireId: targetRepertoireId(),
				fromFen: userFen,
				san: userSan,
				forceReplace: true
			});
			addedUserMoves.set(fenKey(userFen), userSan);
			chainExtensions.delete(issuePly);
			resolveIssue(issuePly);
		});
	}

	// ── Save / reset ────────────────────────────────────────────────────────────

	// Save the reviewed game record to the database.
	async function saveReview(): Promise<void> {
		if (!parsedPgn || !analysis || saving) return;
		saving = true;
		try {
			const res = await fetch('/api/review/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId: targetRepertoireId(),
					pgn: parsedPgn,
					deviationFen: analysis.firstDeviationFen,
					notes: notes || null,
					importedGameId: importedGameId ?? undefined
				})
			});
			if (res.ok) {
				const result = (await res.json()) as { id: number };
				savedId = result.id;
				const { invalidateAll } = await import('$app/navigation');
				await invalidateAll();
			}
		} finally {
			saving = false;
		}
	}

	// Go back to the input state to review another game.
	function reviewAnother(): void {
		evalAbortController?.abort();
		evalAbortController = null;
		evalProgress = null;
		positionEvals.clear();
		analysis = null;
		parsedPgn = null;
		savedId = null;
		analysisError = null;
		importedGameId = null;
		overrideRepertoireId = null;
		hoveredFen = null;
		hoveredSan = null;
		newRepIssuePly = null;
		newRepName = '';
	}

	// ── Public API ──────────────────────────────────────────────────────────────

	return {
		// Bindable state (getter + setter so the page can bind: to these).
		get analysisError() {
			return analysisError;
		},
		set analysisError(v) {
			analysisError = v;
		},
		get importedGameId() {
			return importedGameId;
		},
		set importedGameId(v) {
			importedGameId = v;
		},
		get overrideRepertoireId() {
			return overrideRepertoireId;
		},
		set overrideRepertoireId(v) {
			overrideRepertoireId = v;
		},
		get currentPlyIdx() {
			return currentPlyIdx;
		},
		set currentPlyIdx(v) {
			currentPlyIdx = v;
		},
		get notes() {
			return notes;
		},
		set notes(v) {
			notes = v;
		},
		get newRepName() {
			return newRepName;
		},
		set newRepName(v) {
			newRepName = v;
		},

		// Read-only state.
		get analysis() {
			return analysis;
		},
		get analysisHeaders() {
			return analysisHeaders;
		},
		get analysedPlayerColor() {
			return analysedPlayerColor;
		},
		get analysisRepName() {
			return analysisRepName;
		},
		get isAutoPlaying() {
			return isAutoPlaying;
		},
		get evalProgress() {
			return evalProgress;
		},
		get newRepIssuePly() {
			return newRepIssuePly;
		},
		get saving() {
			return saving;
		},
		get savedId() {
			return savedId;
		},
		resolvedIssues: resolvedIssues as ReadonlySet<number>,
		opponentMoveAdded: opponentMoveAdded as ReadonlySet<number>,
		actionError: actionError as ReadonlyMap<number, string>,
		actionLoading: actionLoading as ReadonlyMap<number, boolean>,
		chainExtensions: chainExtensions as ReadonlyMap<number, ChainLeg>,
		deviationEvals: deviationEvals as ReadonlyMap<
			number,
			{ played: number | null; correct: number | null }
		>,
		deviationMasters: deviationMasters as ReadonlyMap<number, MastersMove[]>,
		deviationMastersLoading: deviationMastersLoading as ReadonlyMap<number, boolean>,
		deviationMastersError: deviationMastersError as ReadonlyMap<number, boolean>,
		deviationMastersExpanded: deviationMastersExpanded as ReadonlySet<number>,
		positionEvals: positionEvals as ReadonlyMap<number, PositionEval>,

		// Derived values.
		get pageState() {
			return pageState;
		},
		get currentFen() {
			return currentFen;
		},
		get lastMove() {
			return lastMove;
		},
		get orientation() {
			return orientation;
		},
		get openingFenHistory() {
			return openingFenHistory;
		},
		get boardShapes() {
			return boardShapes;
		},
		get resolvedCount() {
			return resolvedCount;
		},

		// Display helpers.
		formatEval,
		evalBadgeClass,
		formatPositionEval,
		getCplClassForPly,
		getMoveColor,

		// Actions.
		applyFormResult,
		goForward,
		goBack,
		handleHoverMove,
		toggleMasters,
		resolveIssue,
		handleFailCard,
		handleUpdateRepertoire,
		handleAddOpponentMove,
		handleAddOpponentMoveNewRep,
		openNewRepForm,
		closeNewRepForm,
		handleChainAddOpponent,
		skipChain,
		handlePickResponseMove,
		handlePickChainResponse,
		handleTranspositionFailCard,
		handleTranspositionReplace,
		saveReview,
		reviewAnother
	};
}

export type ReviewState = ReturnType<typeof createReviewState>;
