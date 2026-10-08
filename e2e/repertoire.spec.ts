// Repertoire management: import a PGN with a variation into Build mode, then
// export, rename and the free plan's one-repertoire limit in the Manage
// repertoires dialog (no limit on self-hosted instances).

import { expect, test } from '@playwright/test';
import { IS_CLOUD, createFirstRepertoire, registerUser, trackErrors } from './helpers';

test('import a PGN, export it, rename the repertoire, and hit the free plan limit', async ({
	page
}) => {
	const errors = trackErrors(page);
	await registerUser(page, 'manage');
	await createFirstRepertoire(page);

	// ── Import a PGN with a Black alternative on move 1 ────────────────────
	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Import PGN' }).click();
	await page
		.getByPlaceholder('1. d4 Nf6 2. Nc3 d5 3. Bf4 ...')
		.fill('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 *');
	await page.getByRole('button', { name: 'Parse & Preview' }).click();
	await page.getByRole('button', { name: /^Import 7 moves$/ }).click();
	await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
	await expect(page.getByText('7 moves added')).toBeVisible();
	await page.getByRole('button', { name: 'Done' }).click();

	// ── Export from the Manage repertoires dialog ──────────────────────────
	await page.locator('[aria-haspopup=listbox]').click();
	await page.getByRole('button', { name: /Manage repertoires/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Manage repertoires' });
	const download = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export' }).click();
	let pgn = '';
	for await (const chunk of await (await download).createReadStream()) pgn += chunk;
	expect(pgn).toContain('3. Bb5');
	expect(pgn).toContain('c5');

	// ── Rename ─────────────────────────────────────────────────────────────
	await dialog.getByRole('button', { name: 'Rename' }).click();
	await dialog.locator('.rename-input').fill('Renamed White');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog.locator('.row-name')).toHaveText('Renamed White');
	await expect(page.locator('[aria-haspopup=listbox]')).toContainText('Renamed White');

	// ── Free plan: one repertoire only (self-hosted: no plans) ─────────────
	const upgradeHint = dialog.getByText('to create additional repertoires.');
	if (IS_CLOUD) await expect(upgradeHint).toBeVisible();
	else await expect(upgradeHint).toBeHidden();
	const second = await page.request.post('/api/repertoires', {
		data: { name: 'Second', color: 'BLACK' }
	});
	expect(second.status()).toBe(IS_CLOUD ? 403 : 201);

	expect(errors).toEqual([]);
});
