// The Review page's import list. Every pending game is loaded, however many
// fetches ago it arrived, since those are the games waiting for a review;
// reviewed and skipped games are history and come a page at a time.

import { db } from '$lib/db';
import { importedGame } from '$lib/db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';

export type ImportedGameRow = typeof importedGame.$inferSelect;

/** Reviewed and skipped games per page of the import list. */
export const IMPORT_HISTORY_PAGE_SIZE = 50;

const newestFirst = [sql`${importedGame.playedAt} DESC NULLS LAST`, desc(importedGame.id)];

export async function loadPendingImports(userId: number): Promise<ImportedGameRow[]> {
	return db
		.select()
		.from(importedGame)
		.where(and(eq(importedGame.userId, userId), eq(importedGame.status, 'pending')))
		.orderBy(...newestFirst);
}

/** One page of reviewed and skipped games, newest first. */
export async function loadImportHistory(
	userId: number,
	offset: number
): Promise<{ games: ImportedGameRow[]; hasMore: boolean }> {
	const rows = await db
		.select()
		.from(importedGame)
		.where(and(eq(importedGame.userId, userId), ne(importedGame.status, 'pending')))
		.orderBy(...newestFirst)
		.offset(offset)
		.limit(IMPORT_HISTORY_PAGE_SIZE + 1);
	return {
		games: rows.slice(0, IMPORT_HISTORY_PAGE_SIZE),
		hasMore: rows.length > IMPORT_HISTORY_PAGE_SIZE
	};
}
