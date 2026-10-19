// Build mode: the board keeps the user's position when the page data reloads,
// and deleting a move removes it with everything after it.

import { expect, test, type Page } from '@playwright/test';
import {
	buildLine,
	createFirstRepertoire,
	exportedPgn,
	registerUser,
	trackErrors
} from './helpers';

test('a page data reload keeps the current line', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'reload');
	await createFirstRepertoire(page, 'Reload White');
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	// Finishing a PGN import reloads the page data (invalidateAll). The PGN adds
	// Black's reply to the line the user is on, so the reply showing up at the
	// current position means the reload has landed.
	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Import PGN' }).click();
	await page.getByPlaceholder('1. d4 Nf6 2. Nc3 d5 3. Bf4 ...').fill('1. e4 e5 2. Nf3 Nc6 *');
	await page.getByRole('button', { name: 'Parse & Preview' }).click();
	await page.getByRole('button', { name: /^Import \d+ moves?$/ }).click();
	await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
	await page.getByRole('button', { name: 'Done' }).click();
	await expect(page.locator('.position-move-item', { hasText: 'Nc6' })).toBeVisible();

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
	const dialog = page.getByRole('dialog', { name: 'Delete Nf3?' });
	await expect(dialog).toBeVisible();

	const deleted = page.waitForResponse(
		(r) => /\/api\/moves\/\d+$/.test(r.url()) && r.request().method() === 'DELETE'
	);
	await dialog.locator('.modal-btn--danger').click();
	expect((await deleted).ok()).toBe(true);
	await expect(nf3).toHaveCount(0);

	// The saved repertoire now ends at 1... e5.
	const pgn = await exportedPgn(page);
	expect(pgn).toContain('1. e4 e5');
	expect(pgn).not.toContain('Nf3');
	expect(pgn).not.toContain('Nc6');
	expect(errors).toEqual([]);
});

// The threaded build is skipped when it would get only one search thread, which
// it would on a two-core CI runner.
async function pretendManyCores(page: Page) {
	await page.addInitScript(() =>
		Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
	);
}

test('the Engine tab runs Stockfish in the browser', async ({ page }) => {
	const errors = trackErrors(page);
	const workers: string[] = [];
	page.on('worker', (worker) => workers.push(worker.url()));
	await pretendManyCores(page);

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
	await pretendManyCores(page);
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
	expect(await page.evaluate(() => localStorage.getItem('engine-threads-failed'))).toBe(
		'/engine/stockfish-19-lite.js'
	);

	expect(errors).toEqual([]);
});
