// PATCH /api/import/:id — update an imported game's status.
//
// Used to skip or un-skip games in the import queue.
// Body: { status: 'skipped' | 'pending' }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { importedGame } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
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
	// Skip and un-skip only: a reviewed game points at its saved review, and
	// putting it back in the queue would let it be reviewed a second time.
	if (game.status === 'reviewed') {
		throw error(409, 'This game has already been reviewed');
	}

	await db
		.update(importedGame)
		.set({ status })
		.where(and(eq(importedGame.id, id), inArray(importedGame.status, ['pending', 'skipped'])));

	return json({ updated: true });
};
