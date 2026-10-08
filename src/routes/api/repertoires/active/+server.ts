// POST /api/repertoires/active  — record which repertoire the user is working in
//
// The active repertoire is stored in a browser cookie so the server knows
// which repertoire to scope build/drill data to on every page load.
// Calling this endpoint sets (or updates) that cookie.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { SECURE_COOKIE } from '$lib/auth';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { setActiveRepertoireSchema } from '$lib/server/schemas/repertoires';

export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	const user = requireAuth(locals);

	const { id } = await parseBody(request, setActiveRepertoireSchema);

	// Verify the requested repertoire actually belongs to this user.
	// Without this check, a user could set the cookie to any repertoire ID.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	// Free users cannot switch to a locked (non-first) repertoire.
	if (await isRepertoireLocked(user.id, id, user.tier ?? 'free')) {
		throw error(403, 'Upgrade your plan to use this repertoire.');
	}

	// Persist for 1 year so the active repertoire survives browser restarts.
	// httpOnly keeps it out of client-side JS — only the server needs to read it.
	cookies.set('active_repertoire_id', String(id), {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: SECURE_COOKIE,
		maxAge: 60 * 60 * 24 * 365 // persist for 1 year so it survives browser restarts
	});

	return json({ success: true });
};
