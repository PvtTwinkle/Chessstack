// Dashboard page server load.
//
// Fetches all stats needed by the dashboard widgets:
//   - Gap Finder (existing)
//   - Due Now count
//   - Mastered vs total cards
//   - Streak (consecutive days with completed drill sessions)
//   - Next Review (soonest due card after now)
//   - Card State Breakdown (New/Learning/Review/Relearning)
//   - Accuracy Trend (last 14 completed sessions)
//   - Trouble Spots (cards with lapses >= 3)
//   - Opening Report tile ("Fix this next" and retention)
//
// The queries don't depend on each other (except the gaps, which need the
// moves), so they run in parallel. The maths lives in $lib/dashboard/stats,
// which the page shares.

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { userMove, userRepertoireMove, drillSession, puzzleAttempt } from '$lib/db/schema';
import { eq, and, gt, gte, desc, countDistinct, sql } from 'drizzle-orm';
import { fenKey, loadGapData } from '$lib/gaps';
import type { Gap } from '$lib/gaps';
import { getEffectiveStartFens, buildInScopeFens, reconstructPath } from '$lib/repertoire';
import { STARTING_FEN } from '$lib/fen';
import { loadLanding } from '$lib/landing/landing.server';
import { log } from '$lib/server/log';
import { loadReportSummary, sameColorRepertoires, type ReportSummary } from '$lib/server/report';
import {
	STREAK_LOOKBACK_DAYS,
	TIME_ZONE_COOKIE,
	computeStreak,
	dayInZone,
	goalPeriodStart,
	healthScore as computeHealthScore,
	validTimeZone,
	type GoalFrequency
} from '$lib/dashboard/stats';

/** Shape of a trouble-spot card returned to the page. */
export interface TroubleSpot {
	fromFen: string;
	san: string;
	lapses: number;
	/** SAN moves to the position plus the move itself, for Build's ?line=; null if unreachable. */
	line: string | null;
}

/** Shape of a recent drill session for the accuracy trend. */
export interface SessionSummary {
	cardsReviewed: number;
	cardsCorrect: number;
	completedAt: number; // unix timestamp (seconds)
}

/**
 * The calendar days, in the player's zone, with a completed drill session over
 * the streak's look-back window. One row per day, however many sessions.
 */
async function loadSessionDays(userId: number, timeZone: string, now: Date): Promise<string[]> {
	const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
	const query = (zone: string) =>
		db
			.selectDistinct({
				// completed_at is stored as UTC without a zone.
				day: sql<string>`to_char((${drillSession.completedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${zone}::text, 'YYYY-MM-DD')`
			})
			.from(drillSession)
			.where(and(eq(drillSession.userId, userId), gte(drillSession.completedAt, since)));
	try {
		return (await query(timeZone)).map((r) => r.day);
	} catch (err) {
		// The browser and Postgres keep separate zone lists; count in UTC when
		// Postgres doesn't know this one rather than failing the dashboard.
		if (timeZone === 'UTC') throw err;
		log.warn('dashboard_time_zone_unknown', { timeZone, reason: String(err) });
		return (await query('UTC')).map((r) => r.day);
	}
}

/** Distinct puzzles solved since the start of the goal's period. */
async function loadPuzzlesSolved(userId: number, since: Date): Promise<number> {
	const [result] = await db
		.select({ solved: countDistinct(puzzleAttempt.puzzleId) })
		.from(puzzleAttempt)
		.where(
			and(
				eq(puzzleAttempt.userId, userId),
				eq(puzzleAttempt.solved, true),
				gte(puzzleAttempt.attemptedAt, since)
			)
		);
	return Number(result.solved);
}

export const load: PageServerLoad = async ({ parent, locals, cookies }) => {
	const { repertoires, activeRepertoireId, lockedRepertoireIds, settings } = await parent();

	// Defaults when there's nothing to show.
	const emptyStats = {
		repertoires,
		gaps: [] as Gap[],
		moveCount: 0,
		dueCount: 0,
		masteredCount: 0,
		totalCards: 0,
		nextReviewAt: null as number | null,
		cardStates: { new_: 0, learning: 0, review: 0, relearning: 0 },
		streak: 0,
		recentSessions: [] as SessionSummary[],
		troubleSpots: [] as TroubleSpot[],
		puzzleGoal: null as { count: number; frequency: string; solved: number } | null,
		healthScore: 0,
		report: null as ReportSummary | null
	};

	// Logged-out visitors see the landing page (cloud edition only; self-hosted
	// instances send them to /login before this runs).
	if (!locals.user) {
		return { ...emptyStats, ...loadLanding() };
	}

	if (!activeRepertoireId || repertoires.length === 0) {
		return emptyStats;
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		return emptyStats;
	}

	const userId = locals.user.id;
	const color = activeRep.color as 'WHITE' | 'BLACK';
	const now = new Date();
	const timeZone = validTimeZone(cookies.get(TIME_ZONE_COOKIE));

	const goalFrequency = settings?.puzzleGoalCount
		? (settings.puzzleGoalFrequency as GoalFrequency | null)
		: null;

	const [{ moves, gaps }, allCards, sessionDays, recentSessionRows, puzzlesSolved, report] =
		await Promise.all([
			// ── User moves, then the Gap Finder (masters-first, book fallback) ──
			db
				.select()
				.from(userMove)
				.where(and(eq(userMove.repertoireId, activeRepertoireId), eq(userMove.userId, userId)))
				.then(async (moves) => ({
					moves,
					gaps: await loadGapData(
						db,
						moves,
						color,
						activeRep.startFen ?? null,
						settings?.gapMinGames ?? 10000
					)
				})),
			// ── SR cards for active repertoire ──────────────────────────────
			db
				.select()
				.from(userRepertoireMove)
				.where(
					and(
						eq(userRepertoireMove.userId, userId),
						eq(userRepertoireMove.repertoireId, activeRepertoireId)
					)
				),
			// ── Days with a completed drill session, for the streak ─────────
			loadSessionDays(userId, timeZone, now),
			// ── Accuracy Trend (last 14 completed sessions, all repertoires) ─
			db
				.select({
					cardsReviewed: drillSession.cardsReviewed,
					cardsCorrect: drillSession.cardsCorrect,
					completedAt: drillSession.completedAt
				})
				.from(drillSession)
				.where(and(eq(drillSession.userId, userId), gt(drillSession.completedAt, new Date(0))))
				.orderBy(desc(drillSession.completedAt))
				.limit(14),
			// ── Puzzle Goal (distinct puzzles solved in the current period) ──
			goalFrequency
				? loadPuzzlesSolved(userId, goalPeriodStart(now, goalFrequency, timeZone))
				: Promise.resolve(0),
			// ── Opening Report tile (the report's default filters) ──────────
			loadReportSummary(
				userId,
				activeRepertoireId,
				color,
				sameColorRepertoires(repertoires, color, lockedRepertoireIds),
				now
			)
		]);

	// Scope-filter: only cards whose fromFen is reachable from start position.
	const startFens = getEffectiveStartFens(activeRep.startFen ?? null, moves, color);
	const inScope = buildInScopeFens(startFens, moves);
	const scopedCards = allCards.filter((c) => inScope.has(fenKey(c.fromFen)));

	const totalCards = scopedCards.length;

	// ── Due Now ─────────────────────────────────────────────────────────
	const dueCount = scopedCards.filter((c) => c.due && c.due <= now).length;

	// ── Mastered (state = 2 = Review) ───────────────────────────────────
	const masteredCount = scopedCards.filter((c) => c.state === 2).length;

	// ── Next Review (soonest due card after now) ────────────────────────
	let nextReviewAt: number | null = null;
	const futureCards = scopedCards
		.filter((c) => c.due && c.due > now)
		.sort((a, b) => a.due!.getTime() - b.due!.getTime());
	if (futureCards.length > 0) {
		nextReviewAt = Math.floor(futureCards[0].due!.getTime() / 1000);
	}

	// ── Card State Breakdown ────────────────────────────────────────────
	const cardStates = { new_: 0, learning: 0, review: 0, relearning: 0 };
	for (const c of scopedCards) {
		const s = c.state ?? 0;
		if (s === 0) cardStates.new_++;
		else if (s === 1) cardStates.learning++;
		else if (s === 2) cardStates.review++;
		else if (s === 3) cardStates.relearning++;
	}

	// ── Streak (consecutive days with a completed drill session) ────────
	const streak = computeStreak(sessionDays, dayInZone(now, timeZone));

	const recentSessions: SessionSummary[] = recentSessionRows
		.filter((s) => s.completedAt !== null && s.cardsReviewed > 0)
		.map((s) => ({
			cardsReviewed: s.cardsReviewed,
			cardsCorrect: s.cardsCorrect,
			completedAt: Math.floor(s.completedAt!.getTime() / 1000)
		}))
		.reverse(); // oldest first for left-to-right display

	// ── Trouble Spots (cards with lapses >= 3, top 5 by most lapses) ────
	const troubleCards = scopedCards.filter((c) => (c.lapses ?? 0) >= 3);
	const troubleSpots: TroubleSpot[] = [...troubleCards]
		.sort((a, b) => (b.lapses ?? 0) - (a.lapses ?? 0))
		.slice(0, 5)
		.map((c) => {
			// reconstructPath() answers [] both for the start position and for a
			// position it can't reach; only the first has a line.
			const path = reconstructPath(moves, c.fromFen);
			const reachable = path.length > 0 || fenKey(c.fromFen) === fenKey(STARTING_FEN);
			return {
				fromFen: c.fromFen,
				san: c.san,
				lapses: c.lapses ?? 0,
				line: reachable ? [...path, c.san].join(',') : null
			};
		});

	// ── Health Score (composite 0–100) ──────────────────────────────────
	const troubleCount = troubleCards.length;
	const healthScore = computeHealthScore({
		totalCards,
		gapCount: gaps.length,
		masteredCount,
		dueCount,
		troubleCount
	});

	const puzzleGoal =
		settings?.puzzleGoalCount && goalFrequency
			? { count: settings.puzzleGoalCount, frequency: goalFrequency, solved: puzzlesSolved }
			: null;

	return {
		repertoires,
		gaps,
		moveCount: moves.length,
		dueCount,
		masteredCount,
		totalCards,
		nextReviewAt,
		cardStates,
		streak,
		recentSessions,
		troubleSpots,
		puzzleGoal,
		healthScore,
		troubleCount,
		report
	};
};
