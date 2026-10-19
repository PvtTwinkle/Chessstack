import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { importedGame, userSettings } from '$lib/db/schema';
import { resetDb, createUser } from '$lib/test/db-helpers';
import {
	FIRST_IMPORT_DAYS,
	fetchNewGames,
	saveImportedGames,
	watermarkResets,
	type Game
} from './game-import';

function game(id: string, playedAt: Date, overrides: Partial<Game> = {}): Game {
	return {
		id,
		pgn: '1. e4 e5 *',
		playerColor: 'WHITE',
		opponentName: 'bob',
		opponentRating: 1500,
		playerRating: 1500,
		timeControl: '600+0',
		result: '1-0',
		playedAt,
		...overrides
	};
}

async function settingsFor(userId: number) {
	const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
	return row;
}

describe('saveImportedGames', () => {
	beforeEach(resetDb);

	it('saves games, skips duplicates and moves the watermark', async () => {
		const u = await createUser();
		await db
			.insert(userSettings)
			.values({ userId: u, updatedAt: new Date(), lichessUsername: 'alice' });
		const t1 = new Date('2026-09-01T10:00:00Z');
		const t2 = new Date('2026-09-02T10:00:00Z');

		const first = await saveImportedGames(u, 'LICHESS', 'alice', null, [game('a', t1)]);
		expect(first).toEqual({ imported: 1, skipped: 0, total: 1 });

		const second = await saveImportedGames(u, 'LICHESS', 'alice', t1, [
			game('a', t1),
			game('b', t2)
		]);
		expect(second).toEqual({ imported: 1, skipped: 1, total: 2 });
		expect((await settingsFor(u)).lastLichessImport).toEqual(t2);
	});

	it('strips NUL bytes and keeps going past a game that fails to save', async () => {
		const u = await createUser();
		await db
			.insert(userSettings)
			.values({ userId: u, updatedAt: new Date(), chesscomUsername: 'alice' });
		const t = (h: number) => new Date(`2026-09-01T${String(h).padStart(2, '0')}:00:00Z`);

		const result = await saveImportedGames(u, 'CHESSCOM', 'alice', null, [
			game('nul', t(1), { pgn: '1. e4\u0000 e5 *', opponentName: 'b\u0000ob' }),
			// Out of range for an integer column: this insert fails.
			game('bad', t(2), { opponentRating: 3_000_000_000 }),
			game('after', t(3))
		]);

		expect(result).toEqual({ imported: 2, skipped: 1, total: 3 });
		const rows = await db.select().from(importedGame).where(eq(importedGame.userId, u));
		expect(rows.map((r) => r.externalGameId).sort()).toEqual(['after', 'nul']);
		const nul = rows.find((r) => r.externalGameId === 'nul')!;
		expect(nul.pgn).toBe('1. e4 e5 *');
		expect(nul.opponentName).toBe('bob');
		// The watermark passes the failed game so it isn't retried forever.
		expect((await settingsFor(u)).lastChesscomImport).toEqual(t(3));
	});

	it('leaves the watermark alone when the username changed mid-import', async () => {
		const u = await createUser();
		await db
			.insert(userSettings)
			.values({ userId: u, updatedAt: new Date(), lichessUsername: 'carol' });
		await saveImportedGames(u, 'LICHESS', 'alice', null, [game('a', new Date())]);
		expect((await settingsFor(u)).lastLichessImport).toBeNull();
	});
});

describe('fetchNewGames', () => {
	const fetchMock = vi.fn();
	beforeEach(() => vi.stubGlobal('fetch', fetchMock));
	afterEach(() => {
		vi.unstubAllGlobals();
		fetchMock.mockReset();
	});

	it('starts a first Lichess import 90 days back, oldest first', async () => {
		fetchMock.mockResolvedValueOnce(new Response(''));
		const now = Date.UTC(2026, 9, 13);
		await fetchNewGames('LICHESS', 'alice', null, now);
		const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
		expect(Number(params.get('since'))).toBe(now - FIRST_IMPORT_DAYS * 24 * 60 * 60 * 1000);
		expect(params.get('sort')).toBe('dateAsc');
	});

	it('continues from just after the watermark', async () => {
		fetchMock.mockResolvedValueOnce(new Response(''));
		const watermark = new Date('2026-09-01T00:00:00Z');
		await fetchNewGames('LICHESS', 'alice', watermark);
		const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
		expect(Number(params.get('since'))).toBe(watermark.getTime() + 1);
	});
});

describe('watermarkResets', () => {
	const current = { lichessUsername: 'Alice', chesscomUsername: 'alice_cc' };

	it('clears the watermark only for a username that changed', () => {
		expect(watermarkResets(current, { lichessUsername: 'carol' })).toEqual({
			lastLichessImport: null
		});
		expect(watermarkResets(current, { chesscomUsername: null })).toEqual({
			lastChesscomImport: null
		});
	});

	it('ignores a change of case and fields that were not sent', () => {
		expect(watermarkResets(current, { lichessUsername: 'alice' })).toEqual({});
		expect(watermarkResets(current, {})).toEqual({});
	});

	it('treats a first username as a change', () => {
		expect(watermarkResets(undefined, { lichessUsername: 'alice' })).toEqual({
			lastLichessImport: null
		});
	});
});
