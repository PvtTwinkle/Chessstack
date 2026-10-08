export const TIER_LIMITS = {
	free: { maxRepertoires: 1 },
	paid: { maxRepertoires: Infinity }
} as const;

export type Tier = keyof typeof TIER_LIMITS;

// Returns the set of repertoire IDs that are locked (read-only) for the given tier.
// The repertoires array must already be sorted by createdAt (as the layout query does).
// For paid users, no repertoires are locked. For free users, all except the first are locked.
export function getLockedRepertoireIds(repertoires: { id: number }[], tier: string): Set<number> {
	if (tier === 'paid' || repertoires.length <= 1) return new Set();
	return new Set(repertoires.slice(1).map((r) => r.id));
}
