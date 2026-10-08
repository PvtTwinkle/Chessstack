// FSRS spaced repetition helpers.
//
// This module wraps the ts-fsrs library with the conversions needed to move
// data between our PostgreSQL schema and the ts-fsrs Card type.
//
// Only three ratings are exposed: Again, Good, Easy. Hard is skipped because
// for chess openings the user either knows the move or they don't — there's
// rarely a meaningful "partial credit" state.

import { fsrs, generatorParameters, Rating, State, createEmptyCard } from 'ts-fsrs';
import type { Card, Grade, FSRS } from 'ts-fsrs';

// Re-export so callers never need to import ts-fsrs directly.
export { Rating, State };

// ─── Per-User Config ─────────────────────────────────────────────────────────

// User-configurable FSRS parameters. All fields are optional — omitted fields
// fall back to sensible defaults for chess opening training.
export interface FSRSUserConfig {
	requestRetention?: number; // 0.70–0.97, default 0.9
	maximumInterval?: number; // 30–3650 days, default 365
	relearningMinutes?: number; // 1–60 minutes, default 10
}

export const DEFAULT_RETENTION = 0.9;
export const DEFAULT_MAX_INTERVAL = 365;
export const DEFAULT_RELEARNING_MINUTES = 10;

// Default FSRS instance — reused when no per-user config is provided.
const defaultInstance = fsrs(
	generatorParameters({
		enable_fuzz: true,
		request_retention: DEFAULT_RETENTION,
		maximum_interval: DEFAULT_MAX_INTERVAL,
		relearning_steps: [`${DEFAULT_RELEARNING_MINUTES}m` as const]
	})
);

// Cache for non-default FSRS instances, keyed by "retention|maxInterval|relearningMin".
const instanceCache = new Map<string, FSRS>();

// Build an FSRS instance from per-user config. Reuses the default instance
// when all values match defaults (the common case), and caches non-default
// instances so repeated calls with the same config don't re-instantiate.
function getFsrsInstance(config?: FSRSUserConfig): FSRS {
	const retention = config?.requestRetention ?? DEFAULT_RETENTION;
	const maxInterval = config?.maximumInterval ?? DEFAULT_MAX_INTERVAL;
	const relearningMin = config?.relearningMinutes ?? DEFAULT_RELEARNING_MINUTES;

	if (
		retention === DEFAULT_RETENTION &&
		maxInterval === DEFAULT_MAX_INTERVAL &&
		relearningMin === DEFAULT_RELEARNING_MINUTES
	) {
		return defaultInstance;
	}

	const key = `${retention}|${maxInterval}|${relearningMin}`;
	let instance = instanceCache.get(key);
	if (instance) return instance;

	instance = fsrs(
		generatorParameters({
			enable_fuzz: true,
			request_retention: retention,
			maximum_interval: maxInterval,
			relearning_steps: [`${relearningMin}m`]
		})
	);
	instanceCache.set(key, instance);
	return instance;
}

// ─── Types ────────────────────────────────────────────────────────────────────

// The subset of user_repertoire_move fields that FSRS reads and writes.
// This matches the Drizzle inferred type for that table.
export interface FSRSCardRow {
	id: number;
	due: Date | null;
	stability: number | null;
	difficulty: number | null;
	elapsedDays: number | null;
	scheduledDays: number | null;
	reps: number | null;
	lapses: number | null;
	state: number | null;
	lastReview: Date | null;
	learningSteps: number;
}

// The updated FSRS fields returned after grading — ready to write back to DB.
export interface FSRSUpdate {
	due: Date;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	reps: number;
	lapses: number;
	state: number;
	lastReview: Date;
	learningSteps: number;
}

// ─── Conversions ──────────────────────────────────────────────────────────────

// Convert a DB row into a ts-fsrs Card object.
// For new cards (state=null or 0, no prior reviews), createEmptyCard() is used
// as the base and only the due date is overridden to avoid resetting it.
function dbRowToCard(row: FSRSCardRow): Card {
	if (row.state === null || row.state === State.New) {
		// Brand new card — use ts-fsrs defaults for all fields.
		const empty = createEmptyCard();
		return { ...empty, due: row.due ?? new Date() };
	}

	// Reviewed card — reconstruct from stored fields.
	return {
		due: row.due ?? new Date(),
		stability: row.stability ?? 0,
		difficulty: row.difficulty ?? 0,
		elapsed_days: row.elapsedDays ?? 0,
		scheduled_days: row.scheduledDays ?? 0,
		learning_steps: row.learningSteps ?? 0,
		reps: row.reps ?? 0,
		lapses: row.lapses ?? 0,
		state: (row.state ?? State.New) as State,
		last_review: row.lastReview ?? undefined
	};
}

// Convert a ts-fsrs Card result back into DB-ready fields.
function cardToUpdate(card: Card, now: Date): FSRSUpdate {
	return {
		due: card.due,
		stability: card.stability,
		difficulty: card.difficulty,
		elapsedDays: card.elapsed_days,
		scheduledDays: card.scheduled_days,
		reps: card.reps,
		lapses: card.lapses,
		state: card.state,
		lastReview: card.last_review ?? now,
		learningSteps: card.learning_steps
	};
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply a rating to a card and return the updated fields to write back to DB.
 *
 * @param row     The current user_repertoire_move row for this card.
 * @param rating  Again (1), Good (3), or Easy (4).
 * @param now     The time of review (caller provides so tests can freeze time).
 * @param config  Optional per-user FSRS config (retention, max interval, relearning delay).
 */
export function gradeCard(
	row: FSRSCardRow,
	rating: Rating,
	now: Date,
	config?: FSRSUserConfig
): FSRSUpdate {
	const card = dbRowToCard(row);
	const f = getFsrsInstance(config);
	const scheduling = f.repeat(card, now);
	const result = scheduling[rating as Grade];
	return cardToUpdate(result.card, now);
}

export type ReviewSource = 'DRILL' | 'REVIEW_DEVIATION';

// A review_log row without userId and cardId, which the caller already has.
export interface ReviewLogEntry {
	rating: Rating;
	reviewedAt: Date;
	source: ReviewSource;
	stateBefore: number;
	stabilityBefore: number | null;
	difficultyBefore: number | null;
	elapsedDaysBefore: number | null;
	scheduledDaysBefore: number | null;
	learningStepsBefore: number;
	stateAfter: number;
	stabilityAfter: number;
	difficultyAfter: number;
	elapsedDaysAfter: number;
	scheduledDaysAfter: number;
	learningStepsAfter: number;
	requestRetention: number;
}

/**
 * Describe one grade for review_log, from the card as it was before grading
 * and the update gradeCard() returned for it.
 */
export function buildReviewLogEntry(
	before: FSRSCardRow,
	rating: Rating,
	after: FSRSUpdate,
	source: ReviewSource,
	config?: FSRSUserConfig
): ReviewLogEntry {
	return {
		rating,
		reviewedAt: after.lastReview,
		source,
		stateBefore: before.state ?? State.New,
		stabilityBefore: before.stability,
		difficultyBefore: before.difficulty,
		elapsedDaysBefore: before.elapsedDays,
		scheduledDaysBefore: before.scheduledDays,
		learningStepsBefore: before.learningSteps,
		stateAfter: after.state,
		stabilityAfter: after.stability,
		difficultyAfter: after.difficulty,
		elapsedDaysAfter: after.elapsedDays,
		scheduledDaysAfter: after.scheduledDays,
		learningStepsAfter: after.learningSteps,
		requestRetention: config?.requestRetention ?? DEFAULT_RETENTION
	};
}

// Human-readable label for a time difference, e.g. "10 min", "1 day", "4 days".
function formatInterval(dueDate: Date, now: Date): string {
	const diffMin = Math.round((dueDate.getTime() - now.getTime()) / 60000);
	if (diffMin < 60) return `${diffMin} min`;
	const diffHr = Math.round(diffMin / 60);
	if (diffHr < 24) return `${diffHr} hr`;
	const diffDay = Math.round(diffHr / 24);
	return `${diffDay} day${diffDay !== 1 ? 's' : ''}`;
}

/**
 * Returns interval labels for all three ratings in one pass.
 * Calls `f.repeat()` once (it returns all ratings), avoiding 3x redundant work.
 */
export function intervalLabels(
	row: FSRSCardRow,
	now: Date,
	config?: FSRSUserConfig
): { forgot: string; unsure: string; easy: string } {
	const card = dbRowToCard(row);
	const f = getFsrsInstance(config);
	const scheduling = f.repeat(card, now);
	return {
		forgot: formatInterval(scheduling[Rating.Again as Grade].card.due, now),
		unsure: formatInterval(scheduling[Rating.Good as Grade].card.due, now),
		easy: formatInterval(scheduling[Rating.Easy as Grade].card.due, now)
	};
}
