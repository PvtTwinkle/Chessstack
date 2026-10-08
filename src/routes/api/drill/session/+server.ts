// POST /api/drill/session — create a new drill session record when the user
// starts grading their first card.
//
// We record start time here and leave completed_at null. The client will PATCH
// the session via /api/drill/session/[id] when the session finishes.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { drillSession, repertoire } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { startDrillSessionSchema } from '$lib/server/schemas/drill';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const { repertoireId } = await parseBody(request, startDrillSessionSchema);

	// Verify the repertoire belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	if (await isRepertoireLocked(user.id, repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	const [result] = await db
		.insert(drillSession)
		.values({
			userId: user.id,
			repertoireId,
			cardsReviewed: 0,
			cardsCorrect: 0,
			startedAt: new Date()
		})
		.returning({ id: drillSession.id });

	return json({ sessionId: result.id });
};
