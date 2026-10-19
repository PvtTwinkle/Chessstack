// GET /api/import?offset=N — the next page of reviewed and skipped imported
// games for the Review page's "Load more". Pending games all come with the
// page load.
//
// Returns: { games, hasMore }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { loadImportHistory } from '$lib/server/imported-games';

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = requireAuth(locals);
	const offset = parseIntParam(url.searchParams.get('offset') ?? '0', 'offset');
	if (offset < 0) throw error(400, 'Invalid offset');
	return json(await loadImportHistory(user.id, offset));
};
