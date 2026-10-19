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
import { watermarkResets } from '$lib/server/game-import';

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

	// A new platform username starts its import from scratch: the old
	// account's watermark would skip the new one's earlier games.
	if (body.lichessUsername !== undefined || body.chesscomUsername !== undefined) {
		const [current] = await db
			.select({
				lichessUsername: userSettings.lichessUsername,
				chesscomUsername: userSettings.chesscomUsername
			})
			.from(userSettings)
			.where(eq(userSettings.userId, user.id));
		Object.assign(updates, watermarkResets(current, body));
	}

	updates.updatedAt = new Date();

	// One row per user (unique index), so two first saves arriving together
	// can't create a second row.
	await db
		.insert(userSettings)
		.values({ userId: user.id, updatedAt: new Date(), ...updates })
		.onConflictDoUpdate({ target: userSettings.userId, set: updates });

	const [updated] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id));

	return json({ updated: true, settings: updated });
};
