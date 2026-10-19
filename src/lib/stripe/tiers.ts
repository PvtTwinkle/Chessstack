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

// An admin gift grants paid access until giftExpiry. Gifts are kept separate
// from `subscription.tier`, which only ever reflects Stripe, so a gift ends by
// itself when its date passes and leaves whatever the person pays for.
export function isGiftActive(
	giftExpiry: Date | string | null | undefined,
	now: Date = new Date()
): boolean {
	return giftExpiry != null && new Date(giftExpiry) > now;
}

// The tier a user actually gets: paid while they pay through Stripe or hold an
// unexpired gift. `sub` is their subscription row, if any.
export function effectiveTier(
	sub: { tier: string; giftExpiry: Date | string | null } | null | undefined,
	now: Date = new Date()
): Tier {
	return sub?.tier === 'paid' || isGiftActive(sub?.giftExpiry, now) ? 'paid' : 'free';
}
