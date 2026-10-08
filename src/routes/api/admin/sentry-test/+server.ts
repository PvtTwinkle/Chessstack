// GET /api/admin/sentry-test — throws on purpose so an admin can check that
// server errors reach Sentry after setting SENTRY_DSN (admin only).
//
// The response is the usual 500 error with a request id; the Sentry event
// carries the same id as its request_id tag.

import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/api-helpers';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	throw new Error('Sentry test error, triggered from /api/admin/sentry-test');
};
