import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { checkoutSchema } from './billing';

describe('checkoutSchema', () => {
	it.each(['monthly', 'annual'])('accepts the %s plan', (plan) => {
		expect(validate(checkoutSchema, { plan })).toEqual({ success: true, data: { plan } });
	});

	it.each([{}, { plan: 'weekly' }])('rejects %j', (body) => {
		expect(validate(checkoutSchema, body)).toEqual({
			success: false,
			message: 'Invalid plan — must be "monthly" or "annual"'
		});
	});
});
