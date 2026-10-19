import { describe, expect, it, vi } from 'vitest';
import { importInBatches, type BatchResponse } from './importBatches';

function batches(...responses: BatchResponse[]) {
	const fn = vi.fn<() => Promise<BatchResponse>>();
	for (const r of responses) fn.mockResolvedValueOnce(r);
	return fn;
}

const full = (imported: number, skipped = 0): BatchResponse => ({
	status: 200,
	body: { imported, skipped, more: true }
});

describe('importInBatches', () => {
	it('keeps fetching while the server says there are more games', async () => {
		const fetchBatch = batches(full(50), full(48, 2), {
			status: 200,
			body: { imported: 12, skipped: 0, more: false }
		});
		const progress: number[] = [];
		const totals = await importInBatches(fetchBatch, (n) => progress.push(n));
		expect(fetchBatch).toHaveBeenCalledTimes(3);
		expect(totals).toEqual({ imported: 110, skipped: 2, reason: undefined, more: false });
		expect(progress).toEqual([50, 98, 110]);
	});

	it('stops at the cap and says more games remain', async () => {
		const fetchBatch = batches(full(50), full(50), full(50));
		const totals = await importInBatches(fetchBatch, undefined, 2);
		expect(fetchBatch).toHaveBeenCalledTimes(2);
		expect(totals).toMatchObject({ imported: 100, more: true });
	});

	it("keeps the first batch's reason when nothing came in", async () => {
		const totals = await importInBatches(
			batches({ status: 200, body: { imported: 0, skipped: 0, reason: 'no_new_games' } })
		);
		expect(totals).toEqual({ imported: 0, skipped: 0, reason: 'no_new_games', more: false });
	});

	it('reports a failed batch with the totals so far', async () => {
		const totals = await importInBatches(
			batches(full(50), { status: 429, body: { rateLimited: true } })
		);
		expect(totals).toMatchObject({ imported: 50, error: { rateLimited: true } });

		const failed = await importInBatches(
			batches({ status: 502, body: { message: 'Failed to fetch games from LICHESS' } })
		);
		expect(failed.error).toEqual({
			rateLimited: false,
			message: 'Failed to fetch games from LICHESS'
		});
	});
});
