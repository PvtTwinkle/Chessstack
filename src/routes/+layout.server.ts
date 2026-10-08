// Layout server load function.
//
// Runs on every request before the layout renders. Returns data that is
// available to +layout.svelte and (via inheritance) to every child page.
//
// We use this to pass these things into every page:
//   user              — who is logged in (or null on /login)
//   edition           — 'cloud' (chessstack.app) or 'selfhosted', see $lib/server/edition
//   repertoires       — the full list of this user's repertoires
//   activeRepertoireId — which repertoire is currently selected (from cookie)
//   settings          — user preferences (board theme, sound, engine depth, etc.)
//
// The repertoires list powers the RepertoireSelector in the nav bar.
// The activeRepertoireId will be used by build/drill to scope data.
// Settings are loaded once here instead of per-page so every ChessBoard
// consumer can access the board theme without duplicating the query.

import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import { repertoire, userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getLockedRepertoireIds } from '$lib/stripe/tiers';
import { STRIPE_PRICE_ID_MONTHLY, STRIPE_PRICE_ID_ANNUAL } from '$lib/stripe/client';
import { isEmailVerificationEnabled } from '$lib/loops';
import { EDITION } from '$lib/server/edition';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';
const BILLING_ENABLED = !!process.env.STRIPE_SECRET_KEY;

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	// When the user is not logged in (e.g. the /login page), return early
	// with empty values so the nav doesn't try to render repertoire data.
	if (!locals.user) {
		return {
			user: null,
			edition: EDITION,
			repertoires: [],
			activeRepertoireId: null,
			settings: null,
			registrationMode: REGISTRATION_MODE,
			billingEnabled: BILLING_ENABLED,
			emailVerificationEnabled: isEmailVerificationEnabled()
		};
	}

	// Fetch all repertoires for this user, oldest first.
	const repertoires = await db
		.select()
		.from(repertoire)
		.where(eq(repertoire.userId, locals.user.id))
		.orderBy(repertoire.createdAt);

	// The active repertoire ID is persisted in a cookie so it survives
	// navigation between pages without any extra server-side state.
	let activeRepertoireId: number | null = null;

	const cookieValue = cookies.get('active_repertoire_id');
	if (cookieValue) {
		const parsed = parseInt(cookieValue);
		// Only accept the cookie value if it points to a repertoire that still
		// exists and belongs to this user (handles the "deleted while cookie
		// was set" case).
		if (!isNaN(parsed) && repertoires.some((r) => r.id === parsed)) {
			activeRepertoireId = parsed;
		}
	}

	// If no valid active repertoire is set (first visit, or the previously
	// active one was deleted), default to the first in the list.
	if (activeRepertoireId === null && repertoires.length > 0) {
		activeRepertoireId = repertoires[0].id;
	}

	// Compute which repertoires are locked (read-only) based on the user's tier.
	// Free users can only use their first (oldest) repertoire as active.
	const tier = locals.user?.tier ?? 'free';
	const lockedSet = getLockedRepertoireIds(repertoires, tier);

	// If the active repertoire is locked, force it back to the first (free) one.
	if (activeRepertoireId !== null && lockedSet.has(activeRepertoireId) && repertoires.length > 0) {
		activeRepertoireId = repertoires[0].id;
		cookies.set('active_repertoire_id', String(activeRepertoireId), {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	// User settings (board theme, sound, engine depth, etc.).
	// Returns null if the user has never changed any setting — consumers
	// fall back to defaults in that case.
	const [settings] = await db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	return {
		user: locals.user,
		edition: EDITION,
		tier: locals.user?.tier ?? 'free',
		repertoires,
		activeRepertoireId,
		lockedRepertoireIds: [...lockedSet],
		settings: settings ?? null,
		registrationMode: REGISTRATION_MODE,
		billingEnabled: BILLING_ENABLED,
		emailVerificationEnabled: isEmailVerificationEnabled(),
		stripePriceIdMonthly: STRIPE_PRICE_ID_MONTHLY,
		stripePriceIdAnnual: STRIPE_PRICE_ID_ANNUAL
	};
};
