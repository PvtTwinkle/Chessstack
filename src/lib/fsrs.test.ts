import { describe, expect, it } from 'vitest';
import {
	buildReviewLogEntry,
	gradeCard,
	intervalLabels,
	Rating,
	State,
	type FSRSCardRow
} from './fsrs';

const NOW = new Date('2026-01-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function newCard(): FSRSCardRow {
	return {
		id: 1,
		due: null,
		stability: null,
		difficulty: null,
		elapsedDays: null,
		scheduledDays: null,
		reps: null,
		lapses: null,
		state: null,
		lastReview: null,
		learningSteps: 0
	};
}

/** Grade a card repeatedly, each review happening exactly when the card is due. */
function reviewChain(ratings: Rating[]): FSRSCardRow {
	let row = newCard();
	let at = NOW;
	for (const r of ratings) {
		const u = gradeCard(row, r, at);
		row = { id: 1, ...u };
		at = u.due > at ? u.due : at;
	}
	return row;
}

describe('gradeCard', () => {
	it('schedules a new card answered Again for a short relearn, not days away', () => {
		const u = gradeCard(newCard(), Rating.Again, NOW);
		expect(u.reps).toBe(1);
		expect(u.state).toBe(State.Learning);
		expect(u.due.getTime() - NOW.getTime()).toBeLessThan(DAY);
		expect(u.lastReview).toEqual(NOW);
	});

	it('orders intervals Again < Good < Easy for a new card', () => {
		const again = gradeCard(newCard(), Rating.Again, NOW).due.getTime();
		const good = gradeCard(newCard(), Rating.Good, NOW).due.getTime();
		const easy = gradeCard(newCard(), Rating.Easy, NOW).due.getTime();
		expect(again).toBeLessThanOrEqual(good);
		expect(good).toBeLessThan(easy);
	});

	it('graduates to Review and grows the interval with successive Good answers', () => {
		const row = reviewChain([Rating.Good, Rating.Good, Rating.Good, Rating.Good]);
		expect(row.state).toBe(State.Review);
		expect(row.scheduledDays).toBeGreaterThan(1);
		const next = gradeCard(row, Rating.Good, row.due!);
		expect(next.scheduledDays).toBeGreaterThan(row.scheduledDays!);
	});

	it('counts a lapse and enters Relearning when a review card is forgotten', () => {
		const row = reviewChain([Rating.Easy, Rating.Good]);
		expect(row.state).toBe(State.Review);
		const u = gradeCard(row, Rating.Again, row.due!);
		expect(u.lapses).toBe((row.lapses ?? 0) + 1);
		expect(u.state).toBe(State.Relearning);
	});

	it('respects a per-user maximum interval', () => {
		const run = (maximumInterval?: number) => {
			let row = newCard();
			let at = NOW;
			for (let i = 0; i < 15; i++) {
				const u = gradeCard(row, Rating.Easy, at, { maximumInterval });
				row = { id: 1, ...u };
				at = u.due;
			}
			return row.scheduledDays!;
		};
		// ts-fsrs enforces "Easy > Good" after clamping to the maximum, so an Easy
		// answer can land 1–2 days past the cap. Allow that, but make sure the cap
		// is clearly in effect compared with the default 365-day maximum.
		expect(run(30)).toBeLessThanOrEqual(32);
		expect(run()).toBeGreaterThan(100);
	});

	it('uses the per-user relearning delay for a lapsed card', () => {
		const row = reviewChain([Rating.Easy, Rating.Good]);
		const u = gradeCard(row, Rating.Again, row.due!, { relearningMinutes: 45 });
		const minutes = (u.due.getTime() - row.due!.getTime()) / 60000;
		expect(minutes).toBeCloseTo(45, 0);
	});
});

describe('intervalLabels', () => {
	it('returns human-readable labels for all three buttons', () => {
		const labels = intervalLabels(newCard(), NOW);
		for (const l of Object.values(labels)) {
			expect(l).toMatch(/^\d+ (min|hr|days?)$/);
		}
	});
});

describe('buildReviewLogEntry', () => {
	it('records the card state from before and after the grade', () => {
		const before = reviewChain([Rating.Good, Rating.Good]);
		const at = new Date(before.due!.getTime() + DAY);
		const after = gradeCard(before, Rating.Again, at, { requestRetention: 0.85 });
		const entry = buildReviewLogEntry(before, Rating.Again, after, 'REVIEW_DEVIATION', {
			requestRetention: 0.85
		});

		expect(entry).toMatchObject({
			rating: Rating.Again,
			reviewedAt: at,
			source: 'REVIEW_DEVIATION',
			stateBefore: before.state,
			stabilityBefore: before.stability,
			scheduledDaysBefore: before.scheduledDays,
			stateAfter: after.state,
			stabilityAfter: after.stability,
			scheduledDaysAfter: after.scheduledDays,
			requestRetention: 0.85
		});
		expect(entry.stabilityAfter).toBeLessThan(entry.stabilityBefore!);
	});

	it('logs a never-reviewed card as New with the default retention', () => {
		const after = gradeCard(newCard(), Rating.Good, NOW);
		const entry = buildReviewLogEntry(newCard(), Rating.Good, after, 'DRILL');
		expect(entry.stateBefore).toBe(State.New);
		expect(entry.stabilityBefore).toBeNull();
		expect(entry.requestRetention).toBe(0.9);
	});
});
