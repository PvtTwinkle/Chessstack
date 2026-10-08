// Writes for grading a drill card: the card's new FSRS state and its
// review_log row always change together, in one transaction, so the log
// never records a grade the card doesn't reflect (or the other way round).

import { db } from '$lib/db';
import { reviewLog, userRepertoireMove } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { buildReviewLogEntry, gradeCard } from '$lib/fsrs';
import type { FSRSCardRow, FSRSUpdate, FSRSUserConfig, Rating, ReviewSource } from '$lib/fsrs';
import type { z } from 'zod';
import type { undoGradeSchema } from './schemas/drill';

/** Grade a card the caller has already checked belongs to userId. */
export async function applyGrade(
	userId: number,
	card: FSRSCardRow,
	rating: Rating,
	source: ReviewSource,
	config: FSRSUserConfig,
	now = new Date()
): Promise<FSRSUpdate> {
	const updated = gradeCard(card, rating, now, config);
	const entry = buildReviewLogEntry(card, rating, updated, source, config);

	await db.transaction(async (tx) => {
		await tx.update(userRepertoireMove).set(updated).where(eq(userRepertoireMove.id, card.id));
		await tx.insert(reviewLog).values({ userId, cardId: card.id, ...entry });
	});

	return updated;
}

/**
 * Restore a card's pre-grade FSRS state and drop the grade from review_log.
 * The grade being undone is the one that set the card's current lastReview;
 * if no row matches (the grade request never reached the server), nothing
 * is deleted.
 */
export async function undoGrade(
	card: { id: number; lastReview: Date | null },
	previousState: z.infer<typeof undoGradeSchema>['previousState']
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.update(userRepertoireMove)
			.set(previousState)
			.where(eq(userRepertoireMove.id, card.id));
		if (card.lastReview) {
			await tx
				.delete(reviewLog)
				.where(
					and(
						eq(reviewLog.cardId, card.id),
						eq(reviewLog.source, 'DRILL'),
						eq(reviewLog.reviewedAt, card.lastReview)
					)
				);
		}
	});
}
