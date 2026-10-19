import { beforeEach, describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { drillSession, reviewLog, userRepertoireMove } from '$lib/db/schema';
import { Rating, State } from '$lib/fsrs';
import { applyGrade, undoGrade, REVIEW_FAIL_REPEAT_WINDOW_MS } from './grading';
import { resetDb, createUser, createRepertoire } from '$lib/test/db-helpers';
import { POST as grade } from '../../routes/api/drill/grade/+server';
import { POST as undo } from '../../routes/api/drill/undo/+server';
import { PATCH as finishSession } from '../../routes/api/drill/session/[id]/+server';

async function createCard(userId: number) {
	const repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
	const [card] = await db
		.insert(userRepertoireMove)
		.values({ userId, repertoireId, fromFen: 'start', san: 'e4', state: 0, learningSteps: 0 })
		.returning();
	return card;
}

async function storedCard(id: number) {
	const [row] = await db.select().from(userRepertoireMove).where(eq(userRepertoireMove.id, id));
	return row;
}

async function createSession(userId: number, repertoireId: number) {
	const [row] = await db
		.insert(drillSession)
		.values({ userId, repertoireId, startedAt: new Date() })
		.returning();
	return row.id;
}

async function sessionRow(id: number) {
	const [row] = await db.select().from(drillSession).where(eq(drillSession.id, id));
	return row;
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

/** Calls a route handler; a thrown error(status) comes back as a Response. */
async function call(
	handler: (event: never) => Response | Promise<Response>,
	userId: number,
	body: unknown,
	params: Record<string, string> = {}
): Promise<Response> {
	try {
		return await handler({
			locals: { user: { id: userId, tier: 'paid' } },
			params,
			request: new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) })
		} as never);
	} catch (e) {
		if (isHttpError(e)) return new Response(JSON.stringify(e.body), { status: e.status });
		throw e;
	}
}

describe('review log', () => {
	beforeEach(resetDb);

	it('writes one row per grade alongside the card update', async () => {
		const u = await createUser();
		const card = await createCard(u);
		const now = new Date('2026-03-01T10:00:00.123Z');

		const result = await applyGrade(u, card.id, Rating.Good, 'DRILL', {}, { now });
		if (result.status !== 'graded') throw new Error('not graded');
		expect(result.reviewedAt).toEqual(now);

		const stored = await storedCard(card.id);
		expect(stored.state).toBe(result.updated.state);

		const rows = await db.select().from(reviewLog);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: u,
			cardId: card.id,
			rating: Rating.Good,
			reviewedAt: now,
			source: 'DRILL',
			stateBefore: State.New,
			stateAfter: result.updated.state,
			requestRetention: 0.9
		});
	});

	it("doesn't grade another user's card", async () => {
		const u = await createUser();
		const other = await createUser();
		const card = await createCard(u);
		expect(await applyGrade(other, card.id, Rating.Good, 'DRILL', {})).toEqual({
			status: 'not_found'
		});
	});

	it('removes the undone grade and keeps earlier ones', async () => {
		const u = await createUser();
		const card = await createCard(u);
		await applyGrade(u, card.id, Rating.Good, 'DRILL', {}, { now: new Date('2026-03-01') });
		const graded = await storedCard(card.id);
		await applyGrade(u, card.id, Rating.Again, 'DRILL', {}, { now: new Date('2026-03-05') });
		// The value the server stored, as the grade route returns it.
		const { lastReview } = await storedCard(card.id);

		expect(await undoGrade(u, card.id, lastReview!, snapshotOf(graded))).toBe('restored');

		const rows = await db.select().from(reviewLog);
		expect(rows.map((r) => r.rating)).toEqual([Rating.Good]);
		expect((await storedCard(card.id)).lastReview).toEqual(graded.lastReview);
	});

	it('changes nothing when the undone grade never reached the server', async () => {
		const u = await createUser();
		const card = await createCard(u);
		await applyGrade(u, card.id, Rating.Good, 'DRILL', {}, { now: new Date('2026-03-01') });
		const before = await storedCard(card.id);

		// The client's grade at 03-09 failed: the card's latest grade is still 03-01.
		const result = await undoGrade(u, card.id, new Date('2026-03-09'), snapshotOf(card));

		expect(result).toBe('stale');
		expect(await db.select().from(reviewLog)).toHaveLength(1);
		expect(await storedCard(card.id)).toEqual(before);
	});

	it('is deleted with the card', async () => {
		const u = await createUser();
		const card = await createCard(u);
		await applyGrade(u, card.id, Rating.Good, 'DRILL', {});

		await db.delete(userRepertoireMove).where(eq(userRepertoireMove.id, card.id));

		expect(await db.select().from(reviewLog)).toHaveLength(0);
	});
});

describe('grading the same card twice at once', () => {
	beforeEach(resetDb);

	it('applies both grades, one after the other', async () => {
		const u = await createUser();
		const card = await createCard(u);
		const now = new Date('2026-03-01T10:00:00Z');

		await Promise.all([
			applyGrade(u, card.id, Rating.Good, 'DRILL', {}, { now }),
			applyGrade(u, card.id, Rating.Again, 'REVIEW_DEVIATION', {}, { now })
		]);

		const rows = await db.select().from(reviewLog).orderBy(reviewLog.id);
		expect(rows).toHaveLength(2);
		// The second grade started from the state the first one left.
		expect(rows[1].stateBefore).toBe(rows[0].stateAfter);
		expect((await storedCard(card.id)).reps).toBe(2);
	});
});

describe('failing a card from Review', () => {
	beforeEach(resetDb);

	const skipIfRecent = {
		source: 'REVIEW_DEVIATION' as const,
		withinMs: REVIEW_FAIL_REPEAT_WINDOW_MS
	};

	it('skips a card already failed from Review within the window', async () => {
		const u = await createUser();
		const card = await createCard(u);
		const t0 = new Date('2026-03-01T10:00:00Z');
		const fail = (now: Date) =>
			applyGrade(u, card.id, Rating.Again, 'REVIEW_DEVIATION', {}, { now, skipIfRecent });

		expect((await fail(t0)).status).toBe('graded');
		expect((await fail(new Date(t0.getTime() + 60_000))).status).toBe('skipped');
		expect((await fail(new Date(t0.getTime() + REVIEW_FAIL_REPEAT_WINDOW_MS + 1))).status).toBe(
			'graded'
		);
		expect(await db.select().from(reviewLog)).toHaveLength(2);
	});

	it('still fails a card that was only drilled', async () => {
		const u = await createUser();
		const card = await createCard(u);
		await applyGrade(u, card.id, Rating.Good, 'DRILL', {});
		const result = await applyGrade(
			u,
			card.id,
			Rating.Again,
			'REVIEW_DEVIATION',
			{},
			{
				skipIfRecent
			}
		);
		expect(result.status).toBe('graded');
	});
});

describe('drill routes', () => {
	beforeEach(resetDb);

	it('counts grades into the session and finalizes it once', async () => {
		const u = await createUser();
		const card = await createCard(u);
		const sessionId = await createSession(u, card.repertoireId);

		const res = await call(grade, u, { cardId: card.id, rating: Rating.Good, sessionId });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reviewedAt).toBe((await storedCard(card.id)).lastReview!.toISOString());
		await call(grade, u, { cardId: card.id, rating: Rating.Again, sessionId });

		expect(await sessionRow(sessionId)).toMatchObject({ cardsReviewed: 2, cardsCorrect: 1 });

		const [a, b] = await Promise.all([
			call(finishSession, u, {}, { id: String(sessionId) }),
			call(finishSession, u, {}, { id: String(sessionId) })
		]);
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		const finished = await sessionRow(sessionId);
		expect(finished.completedAt).not.toBeNull();

		// A finished session takes no more counts.
		await call(grade, u, { cardId: card.id, rating: Rating.Good, sessionId });
		expect(await sessionRow(sessionId)).toMatchObject({ cardsReviewed: 2, cardsCorrect: 1 });
		expect((await sessionRow(sessionId)).completedAt).toEqual(finished.completedAt);
	});

	it('undoes with the returned reviewedAt and refuses a stale one with 409', async () => {
		const u = await createUser();
		const card = await createCard(u);
		const sessionId = await createSession(u, card.repertoireId);
		const previousState = snapshotOf(card);

		const graded = await (
			await call(grade, u, { cardId: card.id, rating: Rating.Easy, sessionId })
		).json();

		const stale = await call(undo, u, {
			cardId: card.id,
			reviewedAt: new Date(Date.parse(graded.reviewedAt) - 1000).toISOString(),
			sessionId,
			previousState
		});
		expect(stale.status).toBe(409);
		expect(await db.select().from(reviewLog)).toHaveLength(1);

		const ok = await call(undo, u, {
			cardId: card.id,
			reviewedAt: graded.reviewedAt,
			sessionId,
			previousState
		});
		expect(ok.status).toBe(200);
		expect(await db.select().from(reviewLog)).toHaveLength(0);
		expect((await storedCard(card.id)).state).toBe(State.New);
		expect(await sessionRow(sessionId)).toMatchObject({ cardsReviewed: 0, cardsCorrect: 0 });
	});
});
