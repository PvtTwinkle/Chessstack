// Fetches games in batches until the platform has no more or the cap is hit.
// The server brings in at most IMPORT_MAX_GAMES per request, oldest first, so
// a busy three months takes several requests; looping here saves the user from
// clicking Import again and again before the Opening Report has their games.

/** What POST /api/import/fetch answers for one batch. */
export interface BatchResponse {
	status: number;
	body: {
		imported?: number;
		skipped?: number;
		reason?: string;
		more?: boolean;
		rateLimited?: boolean;
		message?: string;
	};
}

export interface ImportTotals {
	imported: number;
	skipped: number;
	// Why the first batch brought nothing in (no_games, no_new_games, all_skipped).
	reason?: string;
	// True when the cap stopped the loop with games still to fetch.
	more: boolean;
	// Set when a batch failed; the totals cover the batches before it.
	error?: { rateLimited: boolean; message: string };
}

// Six batches of 50 games stay well inside the site's limit of 10 fetches per
// 5 minutes (RATE_LIMIT_IMPORT_FETCH), so an import followed by a retry still fits.
export const MAX_IMPORT_BATCHES = 6;

export async function importInBatches(
	fetchBatch: () => Promise<BatchResponse>,
	onProgress: (imported: number) => void = () => {},
	maxBatches = MAX_IMPORT_BATCHES
): Promise<ImportTotals> {
	const totals: ImportTotals = { imported: 0, skipped: 0, more: false };
	for (let batch = 0; batch < maxBatches; batch++) {
		const { status, body } = await fetchBatch();
		if (status < 200 || status >= 300) {
			totals.error = {
				rateLimited: status === 429 && body.rateLimited === true,
				message: body.message ?? `Import failed (${status})`
			};
			return totals;
		}
		totals.imported += body.imported ?? 0;
		totals.skipped += body.skipped ?? 0;
		if (batch === 0) totals.reason = body.reason;
		onProgress(totals.imported);
		if (!body.more) return totals;
	}
	totals.more = true;
	return totals;
}
