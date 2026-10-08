import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import {
	gradeCardSchema,
	startDrillSessionSchema,
	finishDrillSessionSchema,
	undoGradeSchema
} from './drill';

const fail = (message: string) => ({ success: false, message });

describe('gradeCardSchema', () => {
	it.each([1, 3, 4])('accepts rating %d', (rating) => {
		expect(validate(gradeCardSchema, { cardId: 1, rating })).toEqual({
			success: true,
			data: { cardId: 1, rating }
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

describe('finishDrillSessionSchema', () => {
	it('accepts consistent counts', () => {
		expect(validate(finishDrillSessionSchema, { cardsReviewed: 10, cardsCorrect: 7 })).toEqual({
			success: true,
			data: { cardsReviewed: 10, cardsCorrect: 7 }
		});
		expect(validate(finishDrillSessionSchema, { cardsReviewed: 0, cardsCorrect: 0 }).success).toBe(
			true
		);
	});

	it.each([
		[{ cardsReviewed: -1, cardsCorrect: 0 }, 'cardsReviewed must be at least 0'],
		[{ cardsReviewed: 10_001, cardsCorrect: 0 }, 'cardsReviewed must be at most 10000'],
		[{ cardsReviewed: 2.5, cardsCorrect: 0 }, 'cardsReviewed must be an integer'],
		[{ cardsReviewed: 3, cardsCorrect: 4 }, 'cardsCorrect must be <= cardsReviewed']
	])('rejects %j', (body, message) => {
		expect(validate(finishDrillSessionSchema, body)).toEqual(fail(message));
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

	it('converts dates and keeps the numbers', () => {
		const result = validate(undoGradeSchema, { cardId: 5, previousState: snapshot });
		expect(result).toEqual({
			success: true,
			data: {
				cardId: 5,
				previousState: {
					...snapshot,
					due: new Date(snapshot.due),
					lastReview: new Date(snapshot.lastReview)
				}
			}
		});
	});

	it('turns missing fields of a never-reviewed card into null (learningSteps into 0)', () => {
		const result = validate(undoGradeSchema, { cardId: 5, previousState: { state: 0 } });
		expect(result).toEqual({
			success: true,
			data: {
				cardId: 5,
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
		[{ cardId: 5 }, 'previousState is required'],
		[
			{ cardId: 5, previousState: { difficulty: 11 } },
			'previousState.difficulty must be at most 10'
		],
		[{ cardId: 5, previousState: { stability: -1 } }, 'previousState.stability must be at least 0'],
		[{ cardId: 5, previousState: { state: 4 } }, 'previousState.state must be at most 3'],
		[{ cardId: 5, previousState: { reps: 1.5 } }, 'previousState.reps must be an integer'],
		[{ cardId: 5, previousState: { due: 'soon' } }, 'previousState.due must be a valid date'],
		[{ cardId: 5, previousState: { due: 12 } }, 'previousState.due must be a string']
	])('rejects %j', (body, message) => {
		expect(validate(undoGradeSchema, body)).toEqual(fail(message));
	});
});
