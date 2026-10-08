// GET  /api/repertoires  — list all repertoires for the logged-in user
// POST /api/repertoires  — create a new repertoire

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { TIER_LIMITS } from '$lib/stripe/tiers';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { createRepertoireSchema } from '$lib/server/schemas/repertoires';

// ── GET ────────────────────────────────────────────────────────────────────────
// Returns an array of all repertoires belonging to the current user,
// ordered by creation date (oldest first).

export const GET: RequestHandler = async ({ locals }) => {
	const user = requireAuth(locals);

	const rows = await db
		.select()
		.from(repertoire)
		.where(eq(repertoire.userId, user.id))
		.orderBy(repertoire.createdAt);

	return json(rows);
};

// ── POST ───────────────────────────────────────────────────────────────────────
// Expects JSON body: { name: string, color: "WHITE" | "BLACK" }
// Returns the newly created repertoire row with HTTP 201.

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const { name, color } = await parseBody(request, createRepertoireSchema);

	// Enforce tier-based repertoire limit.
	const tier = user.tier ?? 'free';
	const maxRepertoires = TIER_LIMITS[tier].maxRepertoires;
	if (maxRepertoires !== Infinity) {
		const [{ total }] = await db
			.select({ total: count() })
			.from(repertoire)
			.where(eq(repertoire.userId, user.id));
		if (total >= maxRepertoires) {
			throw error(
				403,
				`Your plan allows up to ${maxRepertoires} repertoire${maxRepertoires === 1 ? '' : 's'}. Upgrade to create more.`
			);
		}
	}

	const [created] = await db
		.insert(repertoire)
		.values({
			userId: user.id,
			name,
			color,
			createdAt: new Date()
		})
		.returning();

	return json(created, { status: 201 });
};
