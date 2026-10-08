// Server-only tier helpers that require database access.
// Separated from tiers.ts because that file is imported by client components
// (ManageRepertoireModal) for TIER_LIMITS, and DB imports cannot be bundled
// for the browser.

import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

// Checks whether a specific repertoire is locked for a user by querying the DB.
// Used in API endpoints as defense-in-depth where the full repertoire list isn't available.
// For paid users, no repertoires are locked. For free users, all except the first
// (oldest by createdAt, with id as tiebreaker) are locked.
export async function isRepertoireLocked(
	userId: number,
	repertoireId: number,
	tier: string
): Promise<boolean> {
	if (tier === 'paid') return false;

	const [first] = await db
		.select({ id: repertoire.id })
		.from(repertoire)
		.where(eq(repertoire.userId, userId))
		.orderBy(asc(repertoire.createdAt), asc(repertoire.id))
		.limit(1);

	// If no repertoires exist, nothing is locked.
	if (!first) return false;

	return repertoireId !== first.id;
}
