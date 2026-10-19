// The dashboard load: streak days in the player's zone, the puzzle goal
// counting distinct puzzles, and trouble spots linking back to their line.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { drillSession, puzzle, puzzleAttempt } from '$lib/db/schema';
import { resetDb, createUser, createRepertoire } from '$lib/test/db-helpers';
import { load } from '../../routes/+page.server';
import { computeStreak, dayInZone } from './stats';

const PUZZLE_IDS = ['dashtest1', 'dashtest2'];
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
	await resetDb();
	await db
		.insert(puzzle)
		.values(
			PUZZLE_IDS.map((puzzleId) => ({
				puzzleId,
				fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
				moves: 'e7e5',
				rating: 1500,
				ratingDeviation: 80,
				popularity: 90,
				nbPlays: 100,
				openingTags: '',
				openingFamily: ''
			}))
		)
		.onConflictDoNothing();
});

afterAll(async () => {
	await db.delete(puzzle).where(inArray(puzzle.puzzleId, PUZZLE_IDS));
});

type LoadEvent = Parameters<typeof load>[0];
type DashboardResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

async function runLoad(
	userId: number,
	repertoireId: number,
	settings: Record<string, unknown>,
	timeZone?: string
): Promise<DashboardResult> {
	const event = {
		parent: async () => ({
			repertoires: [{ id: repertoireId, name: 'rep', color: 'WHITE', startFen: null }],
			activeRepertoireId: repertoireId,
			lockedRepertoireIds: [],
			settings
		}),
		// The Sentry wrapper around load() reads these.
		route: { id: '/' },
		url: new URL('http://localhost/'),
		request: new Request('http://localhost/'),
		locals: { user: { id: userId } },
		cookies: { get: (name: string) => (name === 'tz' ? timeZone : undefined) }
	} as unknown as LoadEvent;
	return (await load(event)) as DashboardResult;
}

describe('dashboard load', () => {
	it('counts the streak in the player zone, one entry per day', async () => {
		const userId = await createUser();
		const repertoireId = await createRepertoire(userId, new Date());
		const now = Date.now();
		const completed = [now - 60_000, now - 120_000, now - DAY_MS, now - 3 * DAY_MS];
		await db.insert(drillSession).values(
			completed.map((t) => ({
				userId,
				repertoireId,
				cardsReviewed: 4,
				cardsCorrect: 3,
				startedAt: new Date(t - 60_000),
				completedAt: new Date(t)
			}))
		);

		for (const zone of ['UTC', 'America/New_York', 'Asia/Kolkata']) {
			const expected = computeStreak(
				completed.map((t) => dayInZone(new Date(t), zone)),
				dayInZone(new Date(), zone)
			);
			const result = await runLoad(userId, repertoireId, {}, zone);
			expect(result.streak, zone).toBe(expected);
		}
		// An unknown zone falls back to UTC instead of failing.
		const fallback = await runLoad(userId, repertoireId, {}, 'Not/AZone');
		expect(fallback.streak).toBe((await runLoad(userId, repertoireId, {}, 'UTC')).streak);
		expect(fallback.recentSessions).toHaveLength(4);
	});

	it('counts each solved puzzle once toward the goal', async () => {
		const userId = await createUser();
		const repertoireId = await createRepertoire(userId, new Date());
		const attemptedAt = new Date();
		await db.insert(puzzleAttempt).values([
			{ userId, puzzleId: 'dashtest1', solved: true, attemptedAt },
			{ userId, puzzleId: 'dashtest1', solved: true, attemptedAt },
			{ userId, puzzleId: 'dashtest2', solved: false, attemptedAt }
		]);
		const result = await runLoad(userId, repertoireId, {
			puzzleGoalCount: 5,
			puzzleGoalFrequency: 'weekly'
		});
		expect(result.puzzleGoal).toEqual({ count: 5, frequency: 'weekly', solved: 1 });
	});

	it('reports an empty repertoire as having no moves', async () => {
		const userId = await createUser();
		const repertoireId = await createRepertoire(userId, new Date());
		const result = await runLoad(userId, repertoireId, {});
		expect(result.moveCount).toBe(0);
		expect(result.gaps).toEqual([]);
		expect(result.puzzleGoal).toBeNull();
	});
});
