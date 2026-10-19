// Opening Report: imported games are scored against the repertoire, with the
// positions where they left book and links into Build and Review.

import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { buildLine, createFirstRepertoire, registerUser, trackErrors } from './helpers';

test('without games the report says how to bring them in', async ({ page }) => {
	await registerUser(page, 'emptyreport');
	await createFirstRepertoire(page);
	await page.goto('/report');
	await expect(page.getByRole('heading', { name: 'Opening Report' })).toBeVisible();
	await expect(page.getByText('Bring in your games')).toBeVisible();
	await expect(page.locator('.fix')).toHaveCount(0);
	await expect(page.getByText('No drills in the last 13 weeks.')).toBeVisible();

	await page.goto('/');
	await expect(page.locator('.report-tile')).toContainText(
		'Import your games to see how your repertoire holds up'
	);
});

test('imported games are scored and their exits listed', async ({ page }) => {
	const errors = trackErrors(page);
	const username = await registerUser(page, 'report');
	await createFirstRepertoire(page);
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
	const sql = postgres(process.env.DATABASE_URL!);
	try {
		const [{ id: userId }] = await sql`select id from "user" where username = ${username}`;
		const game = (pgn: string, result: string, opponent: string, playedAt: Date) => ({
			user_id: userId,
			pgn: `[Event "Rated Blitz game"]\n[Result "${result}"]\n\n${pgn} ${result}`,
			source: 'LICHESS',
			external_game_id: `${opponent}-${playedAt.getTime()}`,
			player_color: 'WHITE',
			opponent_name: opponent,
			opponent_rating: 1500,
			time_control: '180+2',
			result,
			played_at: playedAt,
			imported_at: new Date(),
			status: 'pending'
		});
		await sql`insert into imported_game ${sql([
			// 2. Bc4 instead of the repertoire's 2. Nf3, twice.
			game('1. e4 e5 2. Bc4 Nc6', '0-1', 'BishopFan', daysAgo(3)),
			game('1. e4 e5 2. Bc4 Bc5', '1/2-1/2', 'BishopToo', daysAgo(5)),
			// 1...c5 has no reply prepared.
			game('1. e4 c5 2. Nf3', '1-0', 'Sicilianist', daysAgo(7)),
			// A different first move belongs to another opening, not this report.
			game('1. d4 d5', '1-0', 'QueenPawn', daysAgo(8)),
			// Older than the default 90 days.
			game('1. e4 e5 2. Nf3 Nc6', '1-0', 'OldTimer', daysAgo(200))
		])}`;

		// Drill history for the 1. e4 card: missed twice, remembered once.
		const [{ id: cardId }] = await sql`select id from user_repertoire_move
			where user_id = ${userId} and san = 'e4'`;
		const grade = (rating: number, reviewedAt: Date) => ({
			user_id: userId,
			card_id: cardId,
			rating,
			reviewed_at: reviewedAt,
			source: 'DRILL',
			state_before: 2,
			learning_steps_before: 0,
			state_after: 2,
			stability_after: 3,
			difficulty_after: 5,
			elapsed_days_after: 1,
			scheduled_days_after: 3,
			learning_steps_after: 0,
			request_retention: 0.9
		});
		await sql`insert into review_log ${sql([
			grade(1, daysAgo(2)),
			grade(1, daysAgo(4)),
			grade(3, daysAgo(6))
		])}`;
	} finally {
		await sql.end();
	}

	await page.goto('/report');
	const gamesStat = page.locator('.stat', { hasText: 'Games' });
	await expect(gamesStat.locator('.stat-value')).toHaveText('3');
	await expect(page.locator('.stat', { hasText: 'Score' }).locator('.stat-value')).toHaveText(
		'50%'
	);

	// The costliest exit is the 2. Bc4 habit (1.5 points lost in two games).
	const fix = page.locator('.fix');
	await expect(fix).toContainText('You played 2.Bc4 instead of 2.Nf3 in 2 games and scored 25%');
	await expect(fix.getByRole('link', { name: 'Drill this move' })).toHaveAttribute(
		'href',
		/^\/drill\?mode=all&fromFen=/
	);

	const memory = page.locator('.panel', { hasText: 'Your memory' });
	await expect(memory).toContainText('33%');
	await expect(memory).toContainText('of 3 reviews remembered in the last 13 weeks');
	await expect(memory.locator('.forgotten li')).toHaveCount(1);
	await expect(memory.locator('.forgotten li')).toContainText('1.e4');
	await expect(memory.locator('.forgotten li')).toContainText('Missed 2 of 3 reviews');

	const youLeft = page.locator('.exit-section', { hasText: 'You left book' });
	await expect(youLeft.locator('.exit')).toHaveCount(1);
	await expect(youLeft.locator('.what')).toContainText('You played 2.Bc4 here in 2 games');
	await expect(youLeft.locator('.what')).toContainText('your repertoire says 2.Nf3');
	await expect(youLeft.getByRole('link', { name: 'Lost vs BishopFan' })).toHaveAttribute(
		'href',
		/\/review\?importedGameId=\d+$/
	);

	const theyLeft = page.locator('.exit-section', { hasText: 'They left book' });
	await expect(theyLeft.locator('.what')).toContainText('Opponents played 1...c5 in 1 game');
	await expect(theyLeft.getByRole('link', { name: 'Prepare a reply' })).toHaveAttribute(
		'href',
		'/build?line=e4%2Cc5'
	);

	// All time brings in the old game, which left book at 2...Nc6.
	await page.getByLabel('Period').selectOption('all');
	await expect(page).toHaveURL(/period=all/);
	await expect(gamesStat.locator('.stat-value')).toHaveText('4');
	await expect(
		page.locator('.exit-section', { hasText: 'They left book' }).locator('.exit')
	).toHaveCount(2);

	// The nav links to the report.
	await expect(page.getByRole('link', { name: 'Report', exact: true }).first()).toBeVisible();

	// The dashboard tile shows the same pick and retention, and opens the report.
	await page.goto('/');
	const tile = page.locator('.report-tile');
	await expect(tile).toContainText('You played 2.Bc4 instead of 2.Nf3 in 2 games');
	await expect(tile).toContainText('33%');
	await expect(tile).toContainText('remembered in the last 13 weeks');
	await tile.click();
	await expect(page).toHaveURL(/\/report$/);

	expect(errors).toEqual([]);
});
