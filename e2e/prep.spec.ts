// Opponent prep: create a prep from fetched games, then refresh it. Lichess
// and Chess.com can't be reached from the test, so the game fetch is answered
// in the browser; parsing, the batched upload and the commit run for real.

import { expect, test, type Page } from '@playwright/test';
import { registerUser, trackErrors } from './helpers';

/** Two games of each line, so every move passes the two-game minimum. */
function games(moves: string): string[] {
	const pgn = `[White "someone"]\n[Black "rival"]\n[Result "1-0"]\n\n${moves} 1-0`;
	return [pgn, pgn];
}

const fetched = (pgns: string[]) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify({ pgns, gameCount: pgns.length, hasMore: false })
});

async function opponentSans(page: Page, prepId: string): Promise<string[]> {
	const res = await page.request.get(`/api/prep/${prepId}`);
	const { opponentMoves } = (await res.json()) as { opponentMoves: { moveSan: string }[] };
	return opponentMoves.map((m) => m.moveSan).sort();
}

test('create and refresh a prep; a failed refresh keeps the old data', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'prep');

	// ── Create ──────────────────────────────────────────────────────────────
	await page.route('**/api/prep/fetch', (route) => route.fulfill(fetched(games('1. e4 e5'))));
	await page.goto('/prep');
	await page.getByRole('button', { name: 'New Prep' }).click();
	await page.fill('#opponentUsername', 'rival');
	await page.getByRole('button', { name: 'Fetch & Analyze' }).click();
	await page.waitForURL(/\/prep\/\d+$/);
	const prepId = page.url().split('/').pop()!;
	expect(await opponentSans(page, prepId)).toEqual(['e4', 'e5']);

	// ── A refresh that fails partway ────────────────────────────────────────
	let failBatches = true;
	await page.route('**/api/prep/*/refresh', async (route) => {
		const body = route.request().postDataJSON() as { mode: string };
		if (body.mode === 'fetch') return route.fulfill(fetched(games('1. d4 d5')));
		if (body.mode === 'merge-batch' && failBatches) {
			return route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Upload interrupted' })
			});
		}
		return route.continue();
	});

	const refresh = async () => {
		await page.getByRole('button', { name: 'Refresh Games' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Refresh', exact: true }).click();
	};

	await refresh();
	await expect(page.getByText('Error: Upload interrupted')).toBeVisible();
	expect(await opponentSans(page, prepId)).toEqual(['e4', 'e5']);

	// ── A refresh that completes ────────────────────────────────────────────
	failBatches = false;
	await expect(page.getByRole('button', { name: 'Refresh Games' })).toBeEnabled();
	await refresh();
	await expect(page.getByText('Refreshed with 2 games.')).toBeVisible();
	expect(await opponentSans(page, prepId)).toEqual(['d4', 'd5']);

	// Only the one prep is listed: the refresh's upload is gone.
	await page.goto('/prep');
	await expect(page.locator('.prep-card')).toHaveCount(1);

	expect(errors).toEqual([]);
});
