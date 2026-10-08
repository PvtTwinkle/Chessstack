// PATCH /api/import/:id — update an imported game's status.
//
// Used to skip or un-skip games in the import queue.
// Body: { status: 'skipped' | 'pending' }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { importedGame } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { updateImportedGameSchema } from '$lib/server/schemas/import';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);

	const id = parseIntParam(params.id, 'game ID');

	const { status } = await parseBody(request, updateImportedGameSchema);

	// Verify the game belongs to this user.
	const [game] = await db
		.select()
		.from(importedGame)
		.where(and(eq(importedGame.id, id), eq(importedGame.userId, user.id)));

	if (!game) throw error(404, 'Game not found');

	await db.update(importedGame).set({ status }).where(eq(importedGame.id, id));

	return json({ updated: true });
};
