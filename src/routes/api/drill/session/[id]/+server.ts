// PATCH /api/drill/session/[id] — finalize a drill session when all cards have
// been reviewed. Sets completed_at, writes final stats, and returns the time
// of the next due card so the end screen can show "Next session: tomorrow at 2pm".

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { drillSession, userRepertoireMove } from '$lib/db/schema';
import { eq, and, gt, min } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { finishDrillSessionSchema } from '$lib/server/schemas/drill';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);
	const userId = user.id;

	const sessionId = parseIntParam(params.id, 'session id');

	const { cardsReviewed, cardsCorrect } = await parseBody(request, finishDrillSessionSchema);

	const now = new Date();

	// Verify the session exists and check if the repertoire is locked.
	const [sessCheck] = await db
		.select({ repertoireId: drillSession.repertoireId })
		.from(drillSession)
		.where(and(eq(drillSession.id, sessionId), eq(drillSession.userId, userId)));

	if (!sessCheck) throw error(404, 'Session not found');

	if (await isRepertoireLocked(userId, sessCheck.repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// Wrap in a transaction to prevent double-finalization from rapid duplicate
	// submissions (e.g. user double-clicks "Finish"). The guard on completedAt
	// ensures only the first request writes stats.
	const result = await db.transaction(async (tx) => {
		const [sess] = await tx
			.select()
			.from(drillSession)
			.where(and(eq(drillSession.id, sessionId), eq(drillSession.userId, userId)));

		if (!sess) throw error(404, 'Session not found');

		// Already finalized — return existing result without re-writing.
		if (sess.completedAt) {
			const [nextResult] = await tx
				.select({ nextDue: min(userRepertoireMove.due) })
				.from(userRepertoireMove)
				.where(
					and(
						eq(userRepertoireMove.userId, userId),
						eq(userRepertoireMove.repertoireId, sess.repertoireId),
						gt(userRepertoireMove.due, now)
					)
				);
			return { nextDueAt: nextResult?.nextDue ? nextResult.nextDue.toISOString() : null };
		}

		// Finalize the session.
		await tx
			.update(drillSession)
			.set({ completedAt: now, cardsReviewed, cardsCorrect })
			.where(eq(drillSession.id, sessionId));

		// Find the next due card for this repertoire so the end screen can say
		// "Next session: tomorrow at 2pm" or similar.
		const [nextResult] = await tx
			.select({ nextDue: min(userRepertoireMove.due) })
			.from(userRepertoireMove)
			.where(
				and(
					eq(userRepertoireMove.userId, userId),
					eq(userRepertoireMove.repertoireId, sess.repertoireId),
					gt(userRepertoireMove.due, now)
				)
			);

		return { nextDueAt: nextResult?.nextDue ? nextResult.nextDue.toISOString() : null };
	});

	return json(result);
};
