import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { db } from '$lib/db';
import { puzzle, puzzleAttempt } from '$lib/db/schema';
import { createUser, resetDb } from '$lib/test/db-helpers';
import {
	clearPuzzleCache,
	familiesMatching,
	pickPuzzle,
	puzzleFamilyCounts,
	themesForFamilies
} from './puzzles';

// Test puzzles share an id prefix so they can be removed without touching a
// seeded puzzle table.
const PREFIX = 'zzT';
const USER_WHITE = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 2';
const USER_BLACK = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1';

function row(id: string, family: string, extra: Partial<typeof puzzle.$inferInsert> = {}) {
	return {
		puzzleId: PREFIX + id,
		fen: USER_WHITE,
		moves: 'g8f6 f3e5',
		rating: 1500,
		ratingDeviation: 75,
		popularity: 90,
		nbPlays: 100,
		themes: 'fork opening',
		gameUrl: null,
		openingTags: family,
		openingFamily: family,
		...extra
	};
}

async function removeTestPuzzles() {
	await db.delete(puzzle).where(like(puzzle.puzzleId, `${PREFIX}%`));
}

beforeAll(async () => {
	await removeTestPuzzles();
	await db
		.insert(puzzle)
		.values([
			row('01', 'ruy lopez'),
			row('02', 'ruy lopez berlin defense', { themes: 'endgame pin' }),
			row('03', 'ruy lopez', { rating: 2400 }),
			row('04', 'ruy lopezish gambit'),
			row('05', 'sicilian defense', { fen: USER_BLACK, themes: 'mateIn2' }),
			row('06', 'king_s gambit', { themes: 'sacrifice' }),
			row('07', 'kings gambit', { themes: 'sacrifice' })
		]);
});

afterAll(removeTestPuzzles);

beforeEach(async () => {
	await resetDb();
	clearPuzzleCache();
});

describe('puzzle families and themes', () => {
	it('counts puzzles per family and matches prefixes', async () => {
		const counts = await puzzleFamilyCounts();
		expect(counts.get('ruy lopez')).toBe(2);
		expect(familiesMatching(counts, ['ruy lopez'])).toEqual(
			expect.arrayContaining(['ruy lopez', 'ruy lopez berlin defense', 'ruy lopezish gambit'])
		);
	});

	it('lists the themes of exact families', async () => {
		expect(await themesForFamilies(['ruy lopez berlin defense'])).toEqual(['endgame', 'pin']);
		expect(await themesForFamilies(['ruy lopez', 'sicilian defense'])).toEqual(
			expect.arrayContaining(['fork', 'mateIn2', 'opening'])
		);
	});
});

describe('pickPuzzle', () => {
	it('prefers a puzzle the user has not tried', async () => {
		const userId = await createUser();
		await db.insert(puzzleAttempt).values({
			userId,
			puzzleId: `${PREFIX}01`,
			solved: true,
			attemptedAt: new Date()
		});
		for (let i = 0; i < 10; i++) {
			const p = await pickPuzzle(userId, { families: ['ruy lopez'], maxRating: 2000 });
			expect(p?.puzzleId).not.toBe(`${PREFIX}01`);
		}
	});

	it('falls back to a tried puzzle once every match has been tried', async () => {
		const userId = await createUser();
		await db.insert(puzzleAttempt).values({
			userId,
			puzzleId: `${PREFIX}05`,
			solved: false,
			attemptedAt: new Date()
		});
		const p = await pickPuzzle(userId, { families: ['sicilian defense'] });
		expect(p?.puzzleId).toBe(`${PREFIX}05`);
	});

	it('filters by rating, colour and theme', async () => {
		const userId = await createUser();
		const high = await pickPuzzle(userId, { families: ['ruy lopez'], minRating: 2000 });
		expect(high?.puzzleId).toBe(`${PREFIX}03`);

		// The side to move in the FEN plays the setup move; the user has the other.
		expect(
			(await pickPuzzle(userId, { families: ['sicilian defense'], color: 'BLACK' }))?.puzzleId
		).toBe(`${PREFIX}05`);
		expect(
			await pickPuzzle(userId, { families: ['sicilian defense'], color: 'WHITE' })
		).toBeUndefined();

		const pin = await pickPuzzle(userId, { families: ['ruy lopez'], themes: ['pin'] });
		expect(pin?.puzzleId).toBe(`${PREFIX}02`);
	});

	it('ignores themes that are not plain words', async () => {
		const userId = await createUser();
		// A regex would match every puzzle; dropped, the filter is just the family.
		const p = await pickPuzzle(userId, { families: ['sicilian defense'], themes: ['.*'] });
		expect(p?.puzzleId).toBe(`${PREFIX}05`);
	});

	it('matches LIKE wildcards in a family literally', async () => {
		const userId = await createUser();
		expect((await pickPuzzle(userId, { families: ['king_s'] }))?.puzzleId).toBe(`${PREFIX}06`);
		expect(await pickPuzzle(userId, { families: ['%gambit'] })).toBeUndefined();
	});
});
