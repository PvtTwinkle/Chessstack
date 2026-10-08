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

let _stripe: Stripe | null = null;
let _checked = false;

export function getStripe(): Stripe | null {
	if (!_checked) {
		_checked = true;
		const key = process.env.STRIPE_SECRET_KEY;
		if (key) {
			_stripe = new Stripe(key);
		}
	}
	return _stripe;
}
