// Server-only tier helpers that require database access.
// Separated from tiers.ts because that file is imported by client components
// (ManageRepertoireModal) for TIER_LIMITS, and DB imports cannot be bundled
// for the browser.

import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { eq, asc, count } from 'drizzle-orm';
import { TIER_LIMITS, type Tier } from './tiers';

/**
 * Why the user can't create another repertoire on their plan, or null when
 * they can. Every way of creating one (the repertoire form, exporting a prep)
 * checks this, so a free user isn't handed a repertoire that is locked
 * straight away.
 */
export async function repertoireLimitMessage(userId: number, tier: Tier): Promise<string | null> {
	const maxRepertoires = TIER_LIMITS[tier].maxRepertoires;
	if (maxRepertoires === Infinity) return null;
	const [{ total }] = await db
		.select({ total: count() })
		.from(repertoire)
		.where(eq(repertoire.userId, userId));
	if (total < maxRepertoires) return null;
	return `Your plan allows up to ${maxRepertoires} repertoire${maxRepertoires === 1 ? '' : 's'}. Upgrade to create more.`;
}

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
