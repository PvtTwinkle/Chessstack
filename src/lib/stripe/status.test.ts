import { describe, expect, it } from 'vitest';
import { mapStripeStatus } from './status';

describe('mapStripeStatus', () => {
	it.each(['active', 'trialing'])('%s grants paid access', (s) => {
		expect(mapStripeStatus(s)).toEqual({ tier: 'paid', status: 'active' });
	});

	it('past_due keeps paid access during the grace period', () => {
		expect(mapStripeStatus('past_due')).toEqual({ tier: 'paid', status: 'past_due' });
	});

	it.each([
		'canceled',
		'unpaid',
		'incomplete',
		'incomplete_expired',
		'paused',
		'some_future_status'
	])('%s falls back to free', (s) => {
		expect(mapStripeStatus(s)).toEqual({ tier: 'free', status: 'canceled' });
	});
});
