// POST /api/eco
//
// Given a list of FEN strings (current position first, then move history
// going backwards), returns the most specific ECO opening name match.
//
// Request body: { fens: string[] }
// Response:     { code: string; name: string } | null
//
// Why POST instead of GET?
//   FEN strings contain spaces and special characters that make URL-encoding
//   awkward, especially when passing a whole list of them. A POST body is
//   cleaner and less fragile.
//
// Why a list of FENs instead of just one?
//   The current position may be past the last named ECO position (e.g. the
//   user is on move 10 in the Najdorf). Passing the full history lets the
//   server walk backwards and find the most specific recognised name.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lookupEco } from '$lib/eco';
import { isRateLimited } from '$lib/auth/rate-limit';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { ecoLookupSchema } from '$lib/server/schemas/engine';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireAuth(locals);

	if (await isRateLimited(String(user.id), RATE_LIMITS.eco)) {
		return json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
	}

	// The schema drops entries that don't look like FENs and keeps at most 50.
	const { fens } = await parseBody(request, ecoLookupSchema);

	const result = await lookupEco(db, fens);

	return json(result);
};
