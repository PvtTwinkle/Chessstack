// Stripe SDK singleton.
//
// Reads the Stripe secret key from the environment and exports a configured
// Stripe instance. If the key is not set, `stripe` is null — this lets the
// app run without Stripe (billing endpoints return 503 in that case).
//
// This module is lazy-safe: Stripe is only instantiated when first accessed
// via getStripe(), not at import time, so `vite build` won't crash.

import Stripe from 'stripe';

export const STRIPE_PRICE_ID_MONTHLY = process.env.STRIPE_PRICE_ID_MONTHLY ?? '';
export const STRIPE_PRICE_ID_ANNUAL = process.env.STRIPE_PRICE_ID_ANNUAL ?? '';
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
export const STRIPE_REFERRAL_COUPON_ID = process.env.STRIPE_REFERRAL_COUPON_ID ?? '';

const STRIPE_TIMEOUT_MS = 15_000;

let _stripe: Stripe | null = null;
let _checked = false;

export function getStripe(): Stripe | null {
	if (!_checked) {
		_checked = true;
		const key = process.env.STRIPE_SECRET_KEY;
		if (key) {
			// The SDK's default is 80 s; a checkout click shouldn't hang that long.
			_stripe = new Stripe(key, { timeout: STRIPE_TIMEOUT_MS });
		}
	}
	return _stripe;
}

/**
 * Checkout needs the key and both prices. With only some of them set, the
 * plan cards would show and answer 503, so billing counts as off.
 */
export function isBillingEnabled(): boolean {
	return !!process.env.STRIPE_SECRET_KEY && !!STRIPE_PRICE_ID_MONTHLY && !!STRIPE_PRICE_ID_ANNUAL;
}
