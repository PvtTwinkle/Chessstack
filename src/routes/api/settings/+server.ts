// PATCH /api/settings — update one or more user settings fields.
//
// Accepts any subset of the fields in updateSettingsSchema.
// Returns the updated settings row.
//
// The user must be authenticated; settings are scoped to locals.user.id.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { updateSettingsSchema } from '$lib/server/schemas/settings';

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	// The schema rejects bad types and unknown choices and clamps numeric
	// settings to their ranges; see src/lib/server/schemas/settings.ts.
	const body = await parseBody(request, updateSettingsSchema);
	const updates: Partial<typeof userSettings.$inferInsert> = { ...body };

	// Clearing the puzzle goal also clears its frequency.
	if (body.puzzleGoalCount === null) {
		updates.puzzleGoalFrequency = null;
	}

	updates.updatedAt = new Date();

	// Upsert: update if a row exists, insert a defaults row first if not.
	const [existing] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id));

	if (existing) {
		await db.update(userSettings).set(updates).where(eq(userSettings.userId, user.id));
	} else {
		// updatedAt is required on insert but lives in the partial `updates` object.
		// Provide it explicitly so Drizzle's types are satisfied.
		await db.insert(userSettings).values({ userId: user.id, updatedAt: new Date(), ...updates });
	}

	const [updated] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id));

	return json({ updated: true, settings: updated });
};
