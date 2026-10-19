import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '$lib/db';
import { importedGame } from '$lib/db/schema';
import { resetDb, createUser } from '$lib/test/db-helpers';
import { IMPORT_HISTORY_PAGE_SIZE, loadImportHistory, loadPendingImports } from './imported-games';

async function addGames(userId: number, count: number, status: string, offset = 0) {
	await db.insert(importedGame).values(
		Array.from({ length: count }, (_, i) => ({
			userId,
			pgn: '1. e4 *',
			source: 'LICHESS',
			externalGameId: `${status}-${offset + i}`,
			playerColor: 'WHITE',
			playedAt: new Date(Date.UTC(2026, 0, 1) + (offset + i) * 60_000),
			importedAt: new Date(),
			status
		}))
	);
}

describe('Review import list', () => {
	beforeEach(resetDb);

	it('loads every pending game however old', async () => {
		const u = await createUser();
		await addGames(u, 150, 'pending');
		await addGames(u, 10, 'reviewed', 1000);
		const pending = await loadPendingImports(u);
		expect(pending).toHaveLength(150);
		expect(pending.every((g) => g.status === 'pending')).toBe(true);
	});

	it('pages reviewed and skipped games newest first', async () => {
		const u = await createUser();
		await addGames(u, IMPORT_HISTORY_PAGE_SIZE + 5, 'reviewed');
		await addGames(u, 3, 'pending', 500);

		const first = await loadImportHistory(u, 0);
		expect(first.games).toHaveLength(IMPORT_HISTORY_PAGE_SIZE);
		expect(first.hasMore).toBe(true);
		expect(first.games[0].externalGameId).toBe(`reviewed-${IMPORT_HISTORY_PAGE_SIZE + 4}`);

		const second = await loadImportHistory(u, IMPORT_HISTORY_PAGE_SIZE);
		expect(second.games).toHaveLength(5);
		expect(second.hasMore).toBe(false);
	});
});
