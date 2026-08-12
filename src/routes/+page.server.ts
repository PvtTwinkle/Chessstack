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

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { userMove, userRepertoireMove, drillSession, puzzleAttempt } from '$lib/db/schema';
import { eq, and, gt, gte, desc, count } from 'drizzle-orm';
import { fenKey, loadGapData } from '$lib/gaps';
import type { Gap } from '$lib/gaps';
import { getEffectiveStartFens, buildInScopeFens } from '$lib/repertoire';
import { gapRatingWindow } from '$lib/ratings';

/** Shape of a trouble-spot card returned to the page. */
export interface TroubleSpot {
	fromFen: string;
	san: string;
	lapses: number;
}

/** Shape of a recent drill session for the accuracy trend. */
export interface SessionSummary {
	cardsReviewed: number;
	cardsCorrect: number;
	completedAt: number; // unix timestamp (seconds)
}

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { repertoires, activeRepertoireId, settings } = await parent();

	// Defaults when there's nothing to show.
	const emptyStats = {
		repertoires,
		gaps: [] as Gap[],
		gapRatingLabel: gapRatingWindow(settings?.trainerRating ?? null).label,
		dueCount: 0,
		masteredCount: 0,
		totalCards: 0,
		nextReviewAt: null as number | null,
		cardStates: { new_: 0, learning: 0, review: 0, relearning: 0 },
		streak: 0,
		recentSessions: [] as SessionSummary[],
		troubleSpots: [] as TroubleSpot[],
		puzzleGoal: null as { count: number; frequency: string; solved: number } | null,
		healthScore: 0
	};

	if (!activeRepertoireId || repertoires.length === 0 || !locals.user) {
		return emptyStats;
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		return emptyStats;
	}

	const userId = locals.user.id;

	// ── User moves (needed for gap finder + scope filtering) ────────────
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, activeRepertoireId), eq(userMove.userId, userId)));

	// ── Gap Finder (players DB, rating window centered on trainerRating) ────
	const gapRatingLabel = gapRatingWindow(settings?.trainerRating ?? null).label;
	const gaps = await loadGapData(
		db,
		moves,
		activeRep.color as 'WHITE' | 'BLACK',
		activeRep.startFen ?? null,
		settings?.gapMinGames ?? 10000,
		settings?.gapMinPopularityPct ?? 5,
		settings?.trainerRating ?? null
	);

	// ── SR cards for active repertoire ──────────────────────────────────
	const allCards = await db
		.select()
		.from(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, userId),
				eq(userRepertoireMove.repertoireId, activeRepertoireId)
			)
		);

	// Scope-filter: only cards whose fromFen is reachable from start position.
	const startFens = getEffectiveStartFens(
		activeRep.startFen ?? null,
		moves,
		activeRep.color as 'WHITE' | 'BLACK'
	);
	const inScope = buildInScopeFens(startFens, moves);
	const scopedCards = allCards.filter((c) => inScope.has(fenKey(c.fromFen)));

	const now = new Date();
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
	// Query all distinct dates the user completed a session, most recent first.
	// We count backwards from today. A streak doesn't break until a full day
	// is missed (i.e., if today has no session yet, but yesterday does, we
	// start counting from yesterday).
	const completedSessions = await db
		.select({ completedAt: drillSession.completedAt })
		.from(drillSession)
		.where(and(eq(drillSession.userId, userId), gt(drillSession.completedAt, new Date(0))));

	// Build a set of YYYY-MM-DD date strings (in local time / UTC).
	const sessionDays = new Set<string>();
	for (const s of completedSessions) {
		if (s.completedAt) {
			sessionDays.add(s.completedAt.toISOString().slice(0, 10));
		}
	}

	let streak = 0;
	const day = new Date(now);
	// Start from today.
	day.setUTCHours(0, 0, 0, 0);
	const todayStr = day.toISOString().slice(0, 10);

	// If today doesn't have a session, check yesterday as the starting point.
	if (!sessionDays.has(todayStr)) {
		day.setUTCDate(day.getUTCDate() - 1);
	}

	// Count consecutive days backwards.
	while (sessionDays.has(day.toISOString().slice(0, 10))) {
		streak++;
		day.setUTCDate(day.getUTCDate() - 1);
	}

	// ── Accuracy Trend (last 14 completed sessions, across all repertoires) ─
	const recentSessionRows = await db
		.select({
			cardsReviewed: drillSession.cardsReviewed,
			cardsCorrect: drillSession.cardsCorrect,
			completedAt: drillSession.completedAt
		})
		.from(drillSession)
		.where(and(eq(drillSession.userId, userId), gt(drillSession.completedAt, new Date(0))))
		.orderBy(desc(drillSession.completedAt))
		.limit(14);
	const recentSessions: SessionSummary[] = recentSessionRows
		.filter((s) => s.completedAt !== null && s.cardsReviewed > 0)
		.map((s) => ({
			cardsReviewed: s.cardsReviewed,
			cardsCorrect: s.cardsCorrect,
			completedAt: Math.floor(s.completedAt!.getTime() / 1000)
		}))
		.reverse(); // oldest first for left-to-right display

	// ── Trouble Spots (cards with lapses >= 3, top 5 by most lapses) ────
	const troubleSpots: TroubleSpot[] = scopedCards
		.filter((c) => (c.lapses ?? 0) >= 3)
		.sort((a, b) => (b.lapses ?? 0) - (a.lapses ?? 0))
		.slice(0, 5)
		.map((c) => ({
			fromFen: c.fromFen,
			san: c.san,
			lapses: c.lapses ?? 0
		}));

	// ── Health Score (composite 0–100) ──────────────────────────────────
	const troubleCount = scopedCards.filter((c) => (c.lapses ?? 0) >= 3).length;
	let healthScore = 0;
	if (totalCards > 0) {
		const coverage = Math.max(0, 100 - gaps.length * 5);
		const mastery = Math.round((masteredCount / totalCards) * 100);
		const freshness = Math.round((1 - dueCount / totalCards) * 100);
		const stability = Math.round((1 - troubleCount / totalCards) * 100);
		healthScore = Math.round((coverage + mastery + freshness + stability) / 4);
	}

	// ── Puzzle Goal (solved count within current period) ────────────────
	let puzzleGoal: { count: number; frequency: string; solved: number } | null = null;

	if (settings?.puzzleGoalCount && settings?.puzzleGoalFrequency) {
		const periodStart = new Date(now);
		periodStart.setUTCHours(0, 0, 0, 0);

		if (settings.puzzleGoalFrequency === 'weekly') {
			// Week starts Monday: getUTCDay() 0=Sun,1=Mon,...,6=Sat
			const dow = periodStart.getUTCDay();
			periodStart.setUTCDate(periodStart.getUTCDate() - (dow === 0 ? 6 : dow - 1));
		} else if (settings.puzzleGoalFrequency === 'monthly') {
			periodStart.setUTCDate(1);
		}

		const [result] = await db
			.select({ solved: count() })
			.from(puzzleAttempt)
			.where(
				and(
					eq(puzzleAttempt.userId, userId),
					eq(puzzleAttempt.solved, true),
					gte(puzzleAttempt.attemptedAt, periodStart)
				)
			);

		puzzleGoal = {
			count: settings.puzzleGoalCount,
			frequency: settings.puzzleGoalFrequency,
			solved: Number(result.solved)
		};
	}

	return {
		repertoires,
		gaps,
		gapRatingLabel,
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
		troubleCount
	};
};
