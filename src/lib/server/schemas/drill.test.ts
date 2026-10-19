import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { gradeCardSchema, startDrillSessionSchema, undoGradeSchema } from './drill';

const fail = (message: string) => ({ success: false, message });

describe('gradeCardSchema', () => {
	it.each([1, 3, 4])('accepts rating %d', (rating) => {
		expect(validate(gradeCardSchema, { cardId: 1, rating })).toEqual({
			success: true,
			data: { cardId: 1, rating, sessionId: null }
		});
	});

	it('takes an optional session id', () => {
		expect(validate(gradeCardSchema, { cardId: 1, rating: 3, sessionId: 9 })).toEqual({
			success: true,
			data: { cardId: 1, rating: 3, sessionId: 9 }
		});
	});

	it.each([
		[{ cardId: 1, rating: 2 }, 'rating must be 1 (Forgot), 3 (Unsure), or 4 (Easy)'],
		[{ cardId: 1 }, 'rating must be 1 (Forgot), 3 (Unsure), or 4 (Easy)'],
		[{ cardId: '1', rating: 3 }, 'cardId must be a number']
	])('rejects %j', (body, message) => {
		expect(validate(gradeCardSchema, body)).toEqual(fail(message));
	});
});

describe('startDrillSessionSchema', () => {
	it('requires a repertoire id', () => {
		expect(validate(startDrillSessionSchema, { repertoireId: 2 }).success).toBe(true);
		expect(validate(startDrillSessionSchema, {})).toEqual(fail('repertoireId is required'));
	});
});

describe('undoGradeSchema', () => {
	const snapshot = {
		due: '2026-10-03T12:00:00.000Z',
		stability: 3.2,
		difficulty: 5.1,
		elapsedDays: 2,
		scheduledDays: 4,
		reps: 3,
		lapses: 1,
		state: 2,
		lastReview: '2026-10-01T12:00:00.000Z',
		learningSteps: 0
	};

	const reviewedAt = '2026-10-05T09:30:00.123Z';

	it('converts dates and keeps the numbers', () => {
		const result = validate(undoGradeSchema, {
			cardId: 5,
			reviewedAt,
			sessionId: 3,
			previousState: snapshot
		});
		expect(result).toEqual({
			success: true,
			data: {
				cardId: 5,
				reviewedAt: new Date(reviewedAt),
				sessionId: 3,
				previousState: {
					...snapshot,
					due: new Date(snapshot.due),
					lastReview: new Date(snapshot.lastReview)
				}
			}
		});
	});

	it('turns missing fields of a never-reviewed card into null (learningSteps into 0)', () => {
		const result = validate(undoGradeSchema, {
			cardId: 5,
			reviewedAt,
			previousState: { state: 0 }
		});
		expect(result).toEqual({
			success: true,
			data: {
				cardId: 5,
				reviewedAt: new Date(reviewedAt),
				sessionId: null,
				previousState: {
					stability: null,
					difficulty: null,
					elapsedDays: null,
					scheduledDays: null,
					reps: null,
					lapses: null,
					state: 0,
					due: null,
					lastReview: null,
					learningSteps: 0
				}
			}
		});
	});

	it.each([
		[{ cardId: 5, reviewedAt }, 'previousState is required'],
		[{ cardId: 5, previousState: {} }, 'reviewedAt is required'],
		[{ cardId: 5, reviewedAt: 'later', previousState: {} }, 'reviewedAt must be a valid date'],
		[
			{ cardId: 5, reviewedAt, previousState: { difficulty: 11 } },
			'previousState.difficulty must be at most 10'
		],
		[
			{ cardId: 5, reviewedAt, previousState: { stability: -1 } },
			'previousState.stability must be at least 0'
		],
		[
			{ cardId: 5, reviewedAt, previousState: { state: 4 } },
			'previousState.state must be at most 3'
		],
		[
			{ cardId: 5, reviewedAt, previousState: { reps: 1.5 } },
			'previousState.reps must be an integer'
		],
		[
			{ cardId: 5, reviewedAt, previousState: { due: 'soon' } },
			'previousState.due must be a valid date'
		],
		[{ cardId: 5, reviewedAt, previousState: { due: 12 } }, 'previousState.due must be a string']
	])('rejects %j', (body, message) => {
		expect(validate(undoGradeSchema, body)).toEqual(fail(message));
	});
});
