// Build mode: the board keeps the user's position when the page data reloads,
// and deleting a move removes it with everything after it.

import { expect, test, type Request } from '@playwright/test';
import {
	buildLine,
	createFirstRepertoire,
	exportedPgn,
	registerUser,
	trackErrors
} from './helpers';

test('a page data reload right after a move keeps the current line', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'reload');
	await page.getByPlaceholder('e.g. White — e4 lines').fill('Reload White');
	await page.getByRole('button', { name: 'Create Repertoire' }).click();
	await expect(page).toHaveURL(/\/build$/);

	// Skipping the tutorial saves the setting and then reloads the page data
	// (invalidateAll). Delay that reload so it lands after the moves below, as
	// it can on a slow connection. Hold it until the first move is saved rather
	// than for a fixed time: on a slow CI runner the save could otherwise reach
	// the server after the reload, which then has no move to keep.
	const firstMoveSaved = page.waitForResponse(
		(r) => r.url().endsWith('/api/moves') && r.request().method() === 'POST'
	);
	const reloadUrl = /\/build\/__data\.json\?x-sveltekit-invalidated=11/;
	await page.route(reloadUrl, async (route) => {
		await firstMoveSaved;
		await new Promise((resolve) => setTimeout(resolve, 300));
		await route.continue();
	});
	// The reload can also be cancelled by the page (the request then fails),
	// so wait for it to settle either way rather than for a response.
	const reloaded = new Promise<void>((resolve) => {
		const settled = (request: Request) => {
			if (reloadUrl.test(request.url())) resolve();
		};
		page.on('requestfinished', settled);
		page.on('requestfailed', settled);
	});

	// Don't wait for the overlay to close: it closes only once the reload lands.
	await page.getByRole('button', { name: 'Skip Tutorial' }).click();
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	await reloaded;
	// Give the page a moment to apply the reloaded data before checking it.
	await page.waitForTimeout(500);

	const line = page.locator('.move-list .move-san');
	await expect(line).toHaveText(['e4', 'e5', 'Nf3']);
	await expect(line.last()).toHaveClass(/is-current/);
	expect(errors).toEqual([]);
});

test('deleting a move removes it and everything after it', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'deletemove');
	await createFirstRepertoire(page);
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/, /^Nc6\b/]);

	// Step back to the position after 1... e5, where 2. Nf3 is listed.
	await page.getByRole('button', { name: /Undo/ }).click();
	await page.getByRole('button', { name: /Undo/ }).click();
	const nf3 = page.locator('.position-move-item', { hasText: 'Nf3' });
	await nf3.getByTitle('Remove this move and all moves after it').click();
	await expect(page.locator('.modal-title')).toContainText('Delete Nf3?');

	const deleted = page.waitForResponse(
		(r) => /\/api\/moves\/\d+$/.test(r.url()) && r.request().method() === 'DELETE'
	);
	await page.locator('.modal-btn--danger').click();
	expect((await deleted).ok()).toBe(true);
	await expect(nf3).toHaveCount(0);

	// The saved repertoire now ends at 1... e5.
	const pgn = await exportedPgn(page);
	expect(pgn).toContain('1. e4 e5');
	expect(pgn).not.toContain('Nf3');
	expect(pgn).not.toContain('Nc6');
	expect(errors).toEqual([]);
});

test('the Engine tab runs Stockfish in the browser', async ({ page }) => {
	const errors = trackErrors(page);
	const workers: string[] = [];
	page.on('worker', (worker) => workers.push(worker.url()));

	await registerUser(page, 'engine');
	await createFirstRepertoire(page, 'Analysis White');

	// The page is cross-origin isolated, so the multi-threaded build is used.
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
	await page.locator('button.tab', { hasText: 'Engine' }).click();
	const rows = page.locator('.candidate-row');
	await expect(rows).toHaveCount(3, { timeout: 30_000 });
	await expect(rows.first().locator('.eval')).toHaveText(/^[+-]?(\d|#)/);
	expect(workers.some((url) => url.endsWith('/engine/stockfish-19-lite.js'))).toBe(true);

	expect(errors).toEqual([]);
});

test('the Engine tab falls back to one thread when the threaded build fails', async ({ page }) => {
	const errors = trackErrors(page);
	const workers: string[] = [];
	page.on('worker', (worker) => workers.push(worker.url()));
	// Stand-in for a browser (Firefox) that is cross-origin isolated but can't
	// start the threaded build: its worker dies on startup.
	await page.route('**/engine/stockfish-19-lite.js', (route) =>
		route.fulfill({
			contentType: 'text/javascript',
			headers: { 'Cross-Origin-Embedder-Policy': 'credentialless' },
			body: "throw new Error('threaded build unavailable');"
		})
	);

	await registerUser(page, 'engine1t');
	await createFirstRepertoire(page, 'Fallback White');

	await page.locator('button.tab', { hasText: 'Engine' }).click();
	await expect(page.locator('.candidate-row')).toHaveCount(3, { timeout: 30_000 });
	expect(workers.some((url) => url.endsWith('/engine/stockfish-19-lite-single.js'))).toBe(true);
	expect(await page.evaluate(() => localStorage.getItem('engine-threads-failed'))).toBe('1');

	expect(errors).toEqual([]);
});
