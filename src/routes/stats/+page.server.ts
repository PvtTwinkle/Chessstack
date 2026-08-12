// Stats page server load.
//
// Fetches everything needed by the FSRS statistics widgets:
//   - Deck composition (New / Young+Learning / Mature)
//   - Workload forecast (due cards for the next 14 days, colour-split by maturity)
//   - True retention (observed success rate vs. the configured target, from review_log)
//   - Per-opening breakdown (lapse concentration by opening name)
//
// "Mature" follows the Anki convention: scheduledDays > 21. This is
// deliberately different from the dashboard's `masteredCount`, which counts
// state === Review (FSRS "graduated") regardless of interval length — a
// card can be in the Review state with an interval of only a few days.
// The two numbers are not meant to match.

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { userMove, userRepertoireMove, reviewLog } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { getEffectiveStartFens, buildInScopeFens } from '$lib/repertoire';
import { lookupEcoBatch } from '$lib/eco';
import { loadFsrsConfig } from '$lib/server/fsrs-config';
import { State, Rating } from '$lib/fsrs';

const MATURE_THRESHOLD_DAYS = 21;
const FORECAST_DAYS = 14;
const OPENING_STATS_LIMIT = 8;

export interface DeckComposition {
	new_: number;
	youngLearning: number;
	mature: number;
	total: number;
}

export interface ForecastDay {
	dayOffset: number; // 0 = today
	mature: number;
	youngLearning: number;
}

export interface RetentionStats {
	totalReviews: number;
	successCount: number; // rating !== Again
	observedRetention: number | null; // successCount / totalReviews, null if totalReviews === 0
	targetRetention: number;
	since: number | null; // unix seconds of the earliest review_log row counted, or null
}

export interface OpeningStat {
	name: string | null; // null = positions with no recognised ECO name ("Unclassified")
	code: string | null;
	totalCards: number;
	totalLapses: number;
	lapseRate: number; // totalLapses / totalCards
}

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { repertoires, activeRepertoireId } = await parent();

	const empty = {
		repertoires,
		deckComposition: { new_: 0, youngLearning: 0, mature: 0, total: 0 } as DeckComposition,
		forecast: [] as ForecastDay[],
		retention: {
			totalReviews: 0,
			successCount: 0,
			observedRetention: null,
			targetRetention: 0.9,
			since: null
		} as RetentionStats,
		openingStats: [] as OpeningStat[]
	};

	if (!activeRepertoireId || repertoires.length === 0 || !locals.user) {
		return empty;
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		return empty;
	}

	const userId = locals.user.id;

	// ── Scope: same in-scope filtering as the dashboard ──────────────────
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, activeRepertoireId), eq(userMove.userId, userId)));

	const allCards = await db
		.select()
		.from(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, userId),
				eq(userRepertoireMove.repertoireId, activeRepertoireId)
			)
		);

	const startFens = getEffectiveStartFens(
		activeRep.startFen ?? null,
		moves,
		activeRep.color as 'WHITE' | 'BLACK'
	);
	const inScope = buildInScopeFens(startFens, moves);
	const scopedCards = allCards.filter((c) => inScope.has(fenKey(c.fromFen)));

	if (scopedCards.length === 0) {
		return { ...empty, repertoires };
	}

	const now = new Date();

	// ── Deck Composition (New / Young+Learning / Mature) ──────────────────
	// Mature = graduated (state Review) AND interval > 21 days, matching
	// Anki's definition rather than the dashboard's looser "state === Review".
	let newCount = 0;
	let matureCount = 0;
	for (const c of scopedCards) {
		const state = c.state ?? State.New;
		if (state === State.New) {
			newCount++;
		} else if (state === State.Review && (c.scheduledDays ?? 0) > MATURE_THRESHOLD_DAYS) {
			matureCount++;
		}
	}
	const deckComposition: DeckComposition = {
		new_: newCount,
		mature: matureCount,
		youngLearning: scopedCards.length - newCount - matureCount,
		total: scopedCards.length
	};

	// ── Workload Forecast (next 14 days, split by current maturity) ───────
	// This mirrors Anki's forecast: it plots each card's currently scheduled
	// due date, it does not simulate what grade the user will give at that
	// future review. A card's maturity bucket here reflects its state today,
	// not a projection of what it will be when it comes due.
	const forecastBuckets: ForecastDay[] = Array.from({ length: FORECAST_DAYS }, (_, i) => ({
		dayOffset: i,
		mature: 0,
		youngLearning: 0
	}));
	const todayStart = new Date(now);
	todayStart.setUTCHours(0, 0, 0, 0);
	for (const c of scopedCards) {
		if (!c.due) continue;
		const isMature = c.state === State.Review && (c.scheduledDays ?? 0) > MATURE_THRESHOLD_DAYS;
		const dueDay = new Date(c.due);
		dueDay.setUTCHours(0, 0, 0, 0);
		let dayOffset = Math.round((dueDay.getTime() - todayStart.getTime()) / 86_400_000);
		if (dayOffset < 0) dayOffset = 0; // overdue cards count against today
		if (dayOffset >= FORECAST_DAYS) continue;
		if (isMature) forecastBuckets[dayOffset].mature++;
		else forecastBuckets[dayOffset].youngLearning++;
	}

	// ── True Retention (from review_log — only exists from deployment date
	//    of the fsrs-review-log branch onward, nothing retroactive) ───────
	const fsrsConfig = await loadFsrsConfig(userId);
	const cardIds = scopedCards.map((c) => c.id);
	const logRows = await db
		.select({ rating: reviewLog.rating, reviewedAt: reviewLog.reviewedAt })
		.from(reviewLog)
		.where(and(eq(reviewLog.userId, userId), inArray(reviewLog.cardId, cardIds)));

	let successCount = 0;
	let earliestReview: Date | null = null;
	for (const row of logRows) {
		if (row.rating !== Rating.Again) successCount++;
		if (!earliestReview || row.reviewedAt < earliestReview) earliestReview = row.reviewedAt;
	}
	const retention: RetentionStats = {
		totalReviews: logRows.length,
		successCount,
		observedRetention: logRows.length > 0 ? successCount / logRows.length : null,
		targetRetention: fsrsConfig.requestRetention ?? 0.9,
		since: earliestReview ? Math.floor(earliestReview.getTime() / 1000) : null
	};

	// ── Per-Opening Stats (lapse concentration by recognised opening) ─────
	const ecoByFen = await lookupEcoBatch(
		db,
		moves,
		scopedCards.map((c) => c.fromFen)
	);
	const byOpening = new Map<string, { name: string | null; code: string | null; cards: number; lapses: number }>();
	for (const c of scopedCards) {
		const match = ecoByFen.get(c.fromFen) ?? null;
		const key = match ? `${match.code} ${match.name}` : 'unclassified';
		let entry = byOpening.get(key);
		if (!entry) {
			entry = { name: match?.name ?? null, code: match?.code ?? null, cards: 0, lapses: 0 };
			byOpening.set(key, entry);
		}
		entry.cards++;
		entry.lapses += c.lapses ?? 0;
	}
	const openingStats: OpeningStat[] = Array.from(byOpening.values())
		.filter((e) => e.lapses > 0) // only openings actually causing trouble are interesting here
		.map((e) => ({
			name: e.name,
			code: e.code,
			totalCards: e.cards,
			totalLapses: e.lapses,
			lapseRate: e.lapses / e.cards
		}))
		.sort((a, b) => b.totalLapses - a.totalLapses)
		.slice(0, OPENING_STATS_LIMIT);

	return {
		repertoires,
		deckComposition,
		forecast: forecastBuckets,
		retention,
		openingStats
	};
};
