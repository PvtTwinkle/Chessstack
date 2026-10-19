// PATCH /api/drill/session/[id] — finalize a drill session at the end screen.
// Sets completed_at and returns the time of the next due card so the end
// screen can show "Next session: tomorrow at 2pm". The counts are not sent:
// each grade added to them as it was saved (POST /api/drill/grade).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { drillSession, userRepertoireMove } from '$lib/db/schema';
import { eq, and, gt, isNull, min } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';

export const PATCH: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);
	const userId = user.id;

	const sessionId = parseIntParam(params.id, 'session id');

	const now = new Date();

	// Verify the session exists and check if the repertoire is locked.
	const [sess] = await db
		.select({ repertoireId: drillSession.repertoireId })
		.from(drillSession)
		.where(and(eq(drillSession.id, sessionId), eq(drillSession.userId, userId)));

	if (!sess) throw error(404, 'Session not found');

	if (await isRepertoireLocked(userId, sess.repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// One conditional UPDATE, so a double submit can't finalize twice: the
	// second finds completed_at already set and changes nothing.
	await db
		.update(drillSession)
		.set({ completedAt: now })
		.where(
			and(
				eq(drillSession.id, sessionId),
				eq(drillSession.userId, userId),
				isNull(drillSession.completedAt)
			)
		);

	// The next due card for this repertoire, for the end screen.
	const [nextResult] = await db
		.select({ nextDue: min(userRepertoireMove.due) })
		.from(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, userId),
				eq(userRepertoireMove.repertoireId, sess.repertoireId),
				gt(userRepertoireMove.due, now)
			)
		);

	return json({ nextDueAt: nextResult?.nextDue ? nextResult.nextDue.toISOString() : null });
};
