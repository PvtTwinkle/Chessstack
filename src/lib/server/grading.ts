// Writes for grading a drill card: the card's new FSRS state and its
// review_log row always change together, in one transaction, so the log
// never records a grade the card doesn't reflect (or the other way round).
//
// The card is read FOR UPDATE inside that transaction and FSRS runs on that
// read. Two grades of one card at once (two tabs, or a drill grade racing a
// Review "fail card") then take turns, and the second builds on the first
// instead of both starting from the same state and one being lost.

import { db } from '$lib/db';
import { drillSession, reviewLog, userRepertoireMove } from '$lib/db/schema';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { buildReviewLogEntry, gradeCard } from '$lib/fsrs';
import type { FSRSUpdate, FSRSUserConfig, Rating, ReviewSource } from '$lib/fsrs';
import type { z } from 'zod';
import type { undoGradeSchema } from './schemas/drill';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How long after a Review "fail card" the same card is not failed again: a
 * retry after a half-finished action, or a second review of the same game,
 * would otherwise count one mistake as two lapses.
 */
export const REVIEW_FAIL_REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A grade of Good or Easy counts as correct in a drill session's stats. */
const isCorrect = (rating: number) => rating >= 3;

export interface GradeOptions {
	now?: Date;
	/** The drill session the grade belongs to; its counts go up with the grade. */
	sessionId?: number | null;
	/**
	 * Skip the grade when the card already has a review_log row from this
	 * source in the last `withinMs` (Review's fail-card uses it).
	 */
	skipIfRecent?: { source: ReviewSource; withinMs: number };
}

export type GradeResult =
	| { status: 'graded'; updated: FSRSUpdate; reviewedAt: Date }
	| { status: 'skipped'; due: Date | null }
	| { status: 'not_found' };

async function lockCard(tx: Transaction, userId: number, cardId: number) {
	const [card] = await tx
		.select()
		.from(userRepertoireMove)
		.where(and(eq(userRepertoireMove.id, cardId), eq(userRepertoireMove.userId, userId)))
		.for('update');
	return card;
}

/** Grade one of the user's cards. The caller checks the repertoire isn't locked. */
export async function applyGrade(
	userId: number,
	cardId: number,
	rating: Rating,
	source: ReviewSource,
	config: FSRSUserConfig,
	{ now = new Date(), sessionId = null, skipIfRecent }: GradeOptions = {}
): Promise<GradeResult> {
	return db.transaction(async (tx): Promise<GradeResult> => {
		const card = await lockCard(tx, userId, cardId);
		if (!card) return { status: 'not_found' };

		if (skipIfRecent) {
			const [recent] = await tx
				.select({ id: reviewLog.id })
				.from(reviewLog)
				.where(
					and(
						eq(reviewLog.cardId, card.id),
						eq(reviewLog.source, skipIfRecent.source),
						gte(reviewLog.reviewedAt, new Date(now.getTime() - skipIfRecent.withinMs))
					)
				)
				.limit(1);
			if (recent) return { status: 'skipped', due: card.due };
		}

		const updated = gradeCard(card, rating, now, config);
		const entry = buildReviewLogEntry(card, rating, updated, source, config);

		await tx.update(userRepertoireMove).set(updated).where(eq(userRepertoireMove.id, card.id));
		await tx.insert(reviewLog).values({ userId, cardId: card.id, ...entry });

		if (sessionId !== null) {
			// Counted as the grades arrive, so a session left half way still
			// records what was drilled. Only an open session of this user and
			// repertoire; anything else is ignored rather than failing the grade.
			await tx
				.update(drillSession)
				.set({
					cardsReviewed: sql`${drillSession.cardsReviewed} + 1`,
					cardsCorrect: sql`${drillSession.cardsCorrect} + ${isCorrect(rating) ? 1 : 0}`
				})
				.where(
					and(
						eq(drillSession.id, sessionId),
						eq(drillSession.userId, userId),
						eq(drillSession.repertoireId, card.repertoireId),
						isNull(drillSession.completedAt)
					)
				);
		}

		return { status: 'graded', updated, reviewedAt: entry.reviewedAt };
	});
}

export type UndoResult = 'restored' | 'stale' | 'not_found';

/**
 * Undo the drill grade made at `reviewedAt`: restore the card's pre-grade
 * FSRS state and drop that grade from review_log. Only while that grade is
 * still the card's latest (card.lastReview equals it): otherwise it never
 * reached the server, or the card has been graded since (another tab, a
 * Review fail), and writing the old snapshot back would undo that too.
 */
export async function undoGrade(
	userId: number,
	cardId: number,
	reviewedAt: Date,
	previousState: z.infer<typeof undoGradeSchema>['previousState'],
	sessionId: number | null = null
): Promise<UndoResult> {
	return db.transaction(async (tx): Promise<UndoResult> => {
		const card = await lockCard(tx, userId, cardId);
		if (!card) return 'not_found';
		if (card.lastReview?.getTime() !== reviewedAt.getTime()) return 'stale';

		await tx
			.update(userRepertoireMove)
			.set(previousState)
			.where(eq(userRepertoireMove.id, card.id));
		const [removed] = await tx
			.delete(reviewLog)
			.where(
				and(
					eq(reviewLog.cardId, card.id),
					eq(reviewLog.source, 'DRILL'),
					eq(reviewLog.reviewedAt, reviewedAt)
				)
			)
			.returning({ rating: reviewLog.rating });

		if (removed && sessionId !== null) {
			await tx
				.update(drillSession)
				.set({
					cardsReviewed: sql`greatest(${drillSession.cardsReviewed} - 1, 0)`,
					cardsCorrect: sql`greatest(${drillSession.cardsCorrect} - ${isCorrect(removed.rating) ? 1 : 0}, 0)`
				})
				.where(
					and(
						eq(drillSession.id, sessionId),
						eq(drillSession.userId, userId),
						isNull(drillSession.completedAt)
					)
				);
		}
		return 'restored';
	});
}
