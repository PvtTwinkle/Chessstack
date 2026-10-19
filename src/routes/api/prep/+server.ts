// POST /api/prep — create a new prep as a pending upload
//
// The new prep stays hidden until its moves, aggregated by the client-side Web
// Worker, have been sent in batches and committed through
// POST /api/prep/:id/refresh ('merge-batch', then 'merge-commit').

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { opponentPreps } from '$lib/db/schema';
import { parseBody } from '$lib/server/validation';
import { createPrepSchema } from '$lib/server/schemas/prep';
import { deleteStaleUploads } from '$lib/server/prep-upload';
import { requireAuth } from '$lib/server/api-helpers';

// ── POST ─────────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const { opponentName, platform, platformUsername, timeWindow, gamesAsWhite, gamesAsBlack } =
		await parseBody(request, createPrepSchema);

	await deleteStaleUploads(user.id);

	const now = new Date();
	const [prep] = await db
		.insert(opponentPreps)
		.values({
			userId: user.id,
			opponentName,
			platform,
			platformUsername,
			timeWindow: timeWindow || null,
			gamesAsWhite: gamesAsWhite || 0,
			gamesAsBlack: gamesAsBlack || 0,
			lastFetchedAt: now,
			createdAt: now,
			pendingSince: now
		})
		.returning();

	return json(prep, { status: 201 });
};
