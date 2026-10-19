// PATCH  /api/repertoires/[id]  — update repertoire settings (name, startFen)
// DELETE /api/repertoires/[id]  — delete a repertoire and all its data

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { parseBody } from '$lib/server/validation';
import { updateRepertoireSchema } from '$lib/server/schemas/repertoires';

// ── PATCH ──────────────────────────────────────────────────────────────────────
// Expects JSON body: { name?: string, startFen?: string | null }
// At least one field must be provided.
// Verifies the repertoire belongs to the current user before updating.

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
	const user = requireAuth(locals);

	const id = parseIntParam(params.id, 'id');

	// Ownership check.
	const [existing] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, user.id)));

	if (!existing) throw error(404, 'Repertoire not found');

	// Renaming or moving the start position is an edit like any other; only
	// deleting a locked repertoire stays allowed.
	if (await isRepertoireLocked(user.id, id, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	const body = await parseBody(request, updateRepertoireSchema);

	const updates: Partial<typeof repertoire.$inferInsert> = {};
	if (body.name !== undefined) updates.name = body.name;
	// null resets to the standard start position.
	if (body.startFen !== undefined) {
		updates.startFen = body.startFen === null ? null : fenKey(body.startFen);
	}

	const [updated] = await db
		.update(repertoire)
		.set(updates)
		.where(eq(repertoire.id, id))
		.returning();

	return json(updated);
};

// ── DELETE ─────────────────────────────────────────────────────────────────────
// Deletes the repertoire and ALL associated data. Every table that references
// a repertoire (moves, drill cards, reviews, drill and trainer sessions)
// cascades on delete, so removing the repertoire row removes the rest in the
// same statement.

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);

	const id = parseIntParam(params.id, 'id');

	// Ownership check.
	const [existing] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, user.id)));

	if (!existing) throw error(404, 'Repertoire not found');

	await db.delete(repertoire).where(eq(repertoire.id, id));

	return json({ success: true });
};
