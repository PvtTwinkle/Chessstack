// Review mode: analyse a game against the repertoire, save the review, and use
// the import tab.

import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { buildLine, createFirstRepertoire, registerUser, trackErrors } from './helpers';

test('paste a game → deviation found → save → review another', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'review');
	await createFirstRepertoire(page);
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	await page.goto('/review');
	await expect(page.getByRole('heading', { name: 'Review a Game' })).toBeVisible();
	const analyse = page.getByRole('button', { name: 'Analyse Game' });
	await expect(analyse).toBeDisabled();

	// 2. Bc4 instead of the repertoire's 2. Nf3 is a deviation on move 2.
	await page
		.locator('textarea[name=pgn]')
		.fill('[White "Me"]\n[Black "Opponent"]\n\n1. e4 e5 2. Bc4 Nc6 *');
	await analyse.click();

	await expect(page.locator('.section-label', { hasText: 'ISSUES (1)' })).toBeVisible();
	const issue = page.locator('.issue-card').first();
	await expect(issue).toHaveClass(/issue-deviation/);
	await expect(issue.locator('.issue-move-num')).toHaveText('Move 2');
	await expect(issue.locator('.issue-san-played')).toHaveText('Bc4');

	// The in-browser engine scores every position; White's two moves show theirs.
	await expect(page.locator('.move-eval')).toHaveText([/\d/, /\d/], { timeout: 30_000 });

	await page.locator('.notes-input').fill('Forgot my prep');
	await page.getByRole('button', { name: 'Save Review' }).click();
	await expect(page.getByRole('heading', { name: 'Review saved' })).toBeVisible();
	await expect(page.getByText('0 of 1 issue resolved.')).toBeVisible();

	await page.getByRole('button', { name: 'Review another game' }).click();
	await expect(page.getByRole('heading', { name: 'Review a Game' })).toBeVisible();
	await expect(page.locator('textarea[name=pgn]')).toHaveValue('');
	await expect(page.locator('.history-item').first()).toContainText('Deviation found');

	expect(errors).toEqual([]);
});

test('a game that follows the repertoire has no issues', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'clean');
	await createFirstRepertoire(page);
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	await page.goto('/review');
	await page.locator('textarea[name=pgn]').fill('1. e4 e5 2. Nf3 *');
	await page.getByRole('button', { name: 'Analyse Game' }).click();
	await expect(page.getByText('No deviations found!')).toBeVisible();
	await page.getByRole('button', { name: 'Save Review' }).click();
	await expect(page.getByText('Your opening was perfectly on book.').last()).toBeVisible();

	expect(errors).toEqual([]);
});

test('invalid PGN shows an error and stays on the input screen', async ({ page }) => {
	await registerUser(page, 'badpgn');
	await createFirstRepertoire(page);
	await page.goto('/review');
	await page.locator('textarea[name=pgn]').fill('this is not a chess game');
	await page.getByRole('button', { name: 'Analyse Game' }).click();
	await expect(page.locator('.error-banner')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Review a Game' })).toBeVisible();
});

test('import tab without usernames', async ({ page }) => {
	await registerUser(page, 'importer');
	await createFirstRepertoire(page);
	await page.goto('/review');
	await page.getByRole('button', { name: 'Import Games' }).click();
	await expect(
		page.getByRole('button', { name: 'Lichess (set username in Settings)' })
	).toBeDisabled();
	await expect(
		page.getByRole('button', { name: 'Chess.com (set username in Settings)' })
	).toBeDisabled();
	await expect(page.getByText('No imported games yet.')).toBeVisible();
	await page.getByRole('button', { name: 'Skipped' }).click();
	await expect(page.getByText('No skipped games.')).toBeVisible();
	await page.getByRole('button', { name: 'Paste PGN' }).click();
	await expect(page.getByRole('heading', { name: 'Review a Game' })).toBeVisible();
});

test('imported games: filters, skip/un-skip, and review against a chosen repertoire', async ({
	page
}) => {
	const errors = trackErrors(page);
	const username = await registerUser(page, 'imports');
	await createFirstRepertoire(page, 'Main White');
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	const sql = postgres(process.env.DATABASE_URL!);
	try {
		const [{ id: userId }] = await sql`select id from "user" where username = ${username}`;
		// Paid users may have several repertoires; a second White one triggers the picker.
		await sql`insert into subscription (user_id, tier, status, created_at, updated_at)
			values (${userId}, 'paid', 'active', now(), now())`;
		const game = (pgn: string, status: string, opponent: string, ext: string) => ({
			user_id: userId,
			pgn,
			source: 'LICHESS',
			external_game_id: ext,
			player_color: 'WHITE',
			opponent_name: opponent,
			opponent_rating: 1500,
			result: '1-0',
			played_at: new Date('2026-09-01T12:00:00Z'),
			imported_at: new Date(),
			status
		});
		await sql`insert into imported_game ${sql([
			game('1. e4 e5 2. Bc4 Nc6 *', 'pending', 'PendingPal', 'g1'),
			game('1. e4 e5 2. Nf3 *', 'reviewed', 'ReviewedRival', 'g2'),
			game('1. e4 c5 *', 'skipped', 'SkippedSam', 'g3')
		])}`;
	} finally {
		await sql.end();
	}

	// A second White repertoire that also covers 1. e4, so both match the game.
	const created = await page.request.post('/api/repertoires', {
		data: { name: 'Second White', color: 'WHITE' }
	});
	expect(created.ok()).toBe(true);
	const second = (await created.json()) as { id: number };
	const activated = await page.request.post('/api/repertoires/active', {
		data: { id: second.id }
	});
	expect(activated.ok()).toBe(true);
	await page.goto('/build');
	await buildLine(page, [/^e4\b/]);

	await page.goto('/review');
	await page.getByRole('button', { name: 'Import Games' }).click();
	const items = page.locator('.import-item');
	await expect(items).toHaveCount(3);
	await page.getByRole('button', { name: 'Reviewed', exact: true }).click();
	await expect(items).toHaveCount(1);
	await expect(items.first()).toContainText('ReviewedRival');
	await page.getByRole('button', { name: 'All', exact: true }).click();

	// Un-skip and skip again.
	const skipped = items.filter({ hasText: 'SkippedSam' });
	await skipped.getByRole('button', { name: 'Un-skip' }).click();
	await expect(skipped.getByRole('button', { name: 'Review' })).toBeVisible();
	await skipped.getByRole('button', { name: 'Skip' }).click();
	await expect(skipped.getByText('Skipped', { exact: true })).toBeVisible();

	// Review the pending game: two White repertoires match, so the picker opens.
	await items
		.filter({ hasText: 'PendingPal' })
		.getByRole('button', { name: 'Review', exact: true })
		.click();
	await expect(page.getByRole('heading', { name: 'Choose Repertoire' })).toBeVisible();
	await page.locator('.rep-picker-item', { hasText: 'Main White' }).click();

	// The game is analysed against the chosen repertoire automatically.
	await expect(page.locator('.section-label', { hasText: 'ISSUES (1)' })).toBeVisible();
	await expect(page.locator('.issue-san-played').first()).toHaveText('Bc4');
	await page.getByRole('button', { name: 'Save Review' }).click();
	await expect(page.getByRole('heading', { name: 'Review saved' })).toBeVisible();

	// Saving marks the imported game as reviewed.
	await page.getByRole('button', { name: 'Review another game' }).click();
	await page.getByRole('button', { name: 'Import Games' }).click();
	await expect(
		items.filter({ hasText: 'PendingPal' }).locator('.import-badge--reviewed')
	).toBeVisible();

	expect(errors).toEqual([]);
});

test('a game sent from the opening trainer is analysed automatically', async ({ page }) => {
	await registerUser(page, 'trainer');
	await createFirstRepertoire(page);
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	// The trainer's "Review Game" button hands the game over via sessionStorage.
	await page.evaluate(() =>
		sessionStorage.setItem(
			'chessstack:trainer-review',
			JSON.stringify({ pgn: '1. e4 e5 2. d4 *', playerColor: 'WHITE' })
		)
	);
	await page.goto('/review');
	await expect(page.locator('.section-label', { hasText: 'ISSUES (1)' })).toBeVisible();
	await expect(page.locator('.issue-san-played').first()).toHaveText('d4');
	expect(await page.evaluate(() => sessionStorage.getItem('chessstack:trainer-review'))).toBeNull();
});
