// PATCH  /api/repertoires/[id]  — update repertoire settings (name, startFen)
// DELETE /api/repertoires/[id]  — delete a repertoire and all its data

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
	repertoire,
	userMove,
	userRepertoireMove,
	reviewedGame,
	drillSession
} from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
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
// Deletes the repertoire and ALL associated data in a single transaction.
//
// A transaction is an "all or nothing" operation — if any deletion fails,
// the database rolls back to its state before the transaction started.
// This prevents half-deleted repertoires with orphaned rows in other tables.
//
// Deletion order matters because of foreign key constraints:
// child rows (moves, sessions) must be deleted before the parent (repertoire).

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);

	const id = parseIntParam(params.id, 'id');

	// Ownership check.
	const [existing] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, user.id)));

	if (!existing) throw error(404, 'Repertoire not found');

	await db.transaction(async (tx) => {
		// Delete child rows first (foreign key references the repertoire row).
		await tx.delete(userMove).where(eq(userMove.repertoireId, id));
		await tx.delete(userRepertoireMove).where(eq(userRepertoireMove.repertoireId, id));
		await tx.delete(reviewedGame).where(eq(reviewedGame.repertoireId, id));
		await tx.delete(drillSession).where(eq(drillSession.repertoireId, id));
		// Delete the repertoire itself last.
		await tx.delete(repertoire).where(eq(repertoire.id, id));
	});

	return json({ success: true });
};
