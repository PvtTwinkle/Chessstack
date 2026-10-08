// Request bodies for /api/billing routes.

import { z } from 'zod';

/** POST /api/billing/checkout */
export const checkoutSchema = z.object({
	plan: z.enum(['monthly', 'annual'], { error: 'Invalid plan — must be "monthly" or "annual"' })
});
