import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { reviewLog, userRepertoireMove } from '$lib/db/schema';
import { Rating, State } from '$lib/fsrs';
import { applyGrade, undoGrade } from './grading';
import { resetDb, createUser, createRepertoire } from '$lib/test/db-helpers';

async function createCard(userId: number) {
	const repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
	const [card] = await db
		.insert(userRepertoireMove)
		.values({ userId, repertoireId, fromFen: 'start', san: 'e4', state: 0, learningSteps: 0 })
		.returning();
	return card;
}

const snapshotOf = (card: typeof userRepertoireMove.$inferSelect) => ({
	stability: card.stability,
	difficulty: card.difficulty,
	elapsedDays: card.elapsedDays,
	scheduledDays: card.scheduledDays,
	reps: card.reps,
	lapses: card.lapses,
	state: card.state,
	due: card.due,
	lastReview: card.lastReview,
	learningSteps: card.learningSteps
});

describe('review log', () => {
	beforeEach(resetDb);

	it('writes one row per grade alongside the card update', async () => {
		const u = await createUser();
		const card = await createCard(u);
		const now = new Date('2026-03-01T10:00:00.123Z');

		const updated = await applyGrade(u, card, Rating.Good, 'DRILL', {}, now);

		const [stored] = await db
			.select()
			.from(userRepertoireMove)
			.where(eq(userRepertoireMove.id, card.id));
		expect(stored.state).toBe(updated.state);

		const rows = await db.select().from(reviewLog);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: u,
			cardId: card.id,
			rating: Rating.Good,
			reviewedAt: now,
			source: 'DRILL',
			stateBefore: State.New,
			stateAfter: updated.state,
			requestRetention: 0.9
		});
	});

	it('removes the undone grade and keeps earlier ones', async () => {
		const u = await createUser();
		const card = await createCard(u);
		const first = await applyGrade(u, card, Rating.Good, 'DRILL', {}, new Date('2026-03-01'));
		const graded = { ...card, ...first };
		const second = await applyGrade(u, graded, Rating.Again, 'DRILL', {}, new Date('2026-03-05'));

		await undoGrade({ id: card.id, lastReview: second.lastReview }, snapshotOf(graded));

		const rows = await db.select().from(reviewLog);
		expect(rows.map((r) => r.rating)).toEqual([Rating.Good]);
	});

	it('deletes nothing when the undone grade never reached the server', async () => {
		const u = await createUser();
		const card = await createCard(u);
		await applyGrade(u, card, Rating.Good, 'DRILL', {}, new Date('2026-03-01'));

		await undoGrade({ id: card.id, lastReview: new Date('2026-03-09') }, snapshotOf(card));

		expect(await db.select().from(reviewLog)).toHaveLength(1);
	});

	it('is deleted with the card', async () => {
		const u = await createUser();
		const card = await createCard(u);
		await applyGrade(u, card, Rating.Good, 'DRILL', {});

		await db.delete(userRepertoireMove).where(eq(userRepertoireMove.id, card.id));

		expect(await db.select().from(reviewLog)).toHaveLength(0);
	});
});
