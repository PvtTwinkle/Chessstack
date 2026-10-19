// Prep list page — loads all opponent preps for the authenticated user.

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { opponentPreps } from '$lib/db/schema';
import { and, eq, desc, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { preps: [] };

	const preps = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.userId, locals.user.id), isNull(opponentPreps.pendingSince)))
		.orderBy(desc(opponentPreps.createdAt));

	return { preps };
};
