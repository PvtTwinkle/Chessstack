// Public plan prices, shown on the landing page and published as structured data.
//
// Keep in sync with the Stripe prices (STRIPE_PRICE_ID_MONTHLY / _ANNUAL) and the
// plan cards in SubscriptionSection.svelte. Google expects the prices in
// structured data to match what the page shows, so the landing page reads its
// pricing text from here too.

import { TIER_LIMITS } from '$lib/stripe/tiers';

export const PRICE_CURRENCY = 'USD';

/** Number of repertoires included in the free plan. */
export const FREE_REPERTOIRES = TIER_LIMITS.free.maxRepertoires;

export const FREE_PLAN_SUMMARY = `${FREE_REPERTOIRES} opening repertoire${FREE_REPERTOIRES === 1 ? '' : 's'}, full-depth engine analysis`;
export const PAID_PLAN_SUMMARY = 'Unlimited opening repertoires, full-depth engine analysis';

export interface PaidPlan {
	name: string;
	/** Price per billing period, in PRICE_CURRENCY. */
	price: number;
	/** Billing period as an ISO 8601 duration. */
	billingDuration: 'P1M' | 'P1Y';
	/** UN/CEFACT unit code for the billing period. */
	unitCode: 'MON' | 'ANN';
	period: 'month' | 'year';
}

export const MONTHLY_PLAN: PaidPlan = {
	name: 'Monthly',
	price: 1,
	billingDuration: 'P1M',
	unitCode: 'MON',
	period: 'month'
};

export const ANNUAL_PLAN: PaidPlan = {
	name: 'Annual',
	price: 10,
	billingDuration: 'P1Y',
	unitCode: 'ANN',
	period: 'year'
};

export const PAID_PLANS: PaidPlan[] = [MONTHLY_PLAN, ANNUAL_PLAN];

/** "$1" for 1, "$0.83" for 0.83. */
export function formatPrice(price: number): string {
	return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}
