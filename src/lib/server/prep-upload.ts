// Staged uploads for opponent prep move data.
//
// A prep's moves arrive from the browser in batches, too many for one request.
// They go into a pending opponent_preps row first, and publishPrepUpload()
// makes them live in one transaction: a new prep appears complete or not at
// all, and a refresh replaces the old move data only once the new data is in.

import { and, eq, isNotNull, lt, or } from 'drizzle-orm';
import { db } from '$lib/db';
import { opponentMoves, opponentPreps } from '$lib/db/schema';

// An upload sends its batches back to back, so one this old was abandoned
// (closed tab, network error).
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/**
 * Deletes the user's abandoned uploads, and any unfinished upload that would
 * replace `replacing` (a new refresh of a prep supersedes an older one). The
 * pending rows' moves go with them by cascade.
 */
export async function deleteStaleUploads(userId: number, replacing?: number): Promise<void> {
	const abandoned = lt(opponentPreps.pendingSince, new Date(Date.now() - ABANDONED_AFTER_MS));
	await db
		.delete(opponentPreps)
		.where(
			and(
				eq(opponentPreps.userId, userId),
				isNotNull(opponentPreps.pendingSince),
				replacing === undefined
					? abandoned
					: or(abandoned, eq(opponentPreps.replacesPrepId, replacing))
			)
		);
}

/**
 * Publishes a pending upload. A refresh upload's moves replace those of the
 * prep it refreshes and the upload row is removed; a new prep's row simply
 * goes live. Returns the id of the live prep, or null when the upload or the
 * prep it replaces no longer exists.
 */
export async function publishPrepUpload(
	userId: number,
	uploadId: number,
	stats: { timeWindow?: string | null; gamesAsWhite: number; gamesAsBlack: number }
): Promise<number | null> {
	return db.transaction(async (tx) => {
		// Row locks make a second commit of the same upload, or two refreshes of
		// one prep committing at once, wait for this one and then see its result.
		const [upload] = await tx
			.select()
			.from(opponentPreps)
			.where(
				and(
					eq(opponentPreps.id, uploadId),
					eq(opponentPreps.userId, userId),
					isNotNull(opponentPreps.pendingSince)
				)
			)
			.for('update');
		if (!upload) return null;

		const now = new Date();
		const { timeWindow, gamesAsWhite, gamesAsBlack } = stats;
		const metadata = {
			lastFetchedAt: now,
			gamesAsWhite,
			gamesAsBlack,
			...(timeWindow ? { timeWindow } : {})
		};

		if (upload.replacesPrepId === null) {
			await tx
				.update(opponentPreps)
				.set({ ...metadata, pendingSince: null })
				.where(eq(opponentPreps.id, uploadId));
			return uploadId;
		}

		const targetId = upload.replacesPrepId;
		const [target] = await tx
			.select({ id: opponentPreps.id })
			.from(opponentPreps)
			.where(and(eq(opponentPreps.id, targetId), eq(opponentPreps.userId, userId)))
			.for('update');
		if (!target) return null;

		await tx.delete(opponentMoves).where(eq(opponentMoves.prepId, targetId));
		await tx
			.update(opponentMoves)
			.set({ prepId: targetId })
			.where(eq(opponentMoves.prepId, uploadId));
		await tx.update(opponentPreps).set(metadata).where(eq(opponentPreps.id, targetId));
		await tx.delete(opponentPreps).where(eq(opponentPreps.id, uploadId));
		return targetId;
	});
}
