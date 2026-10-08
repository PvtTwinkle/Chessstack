// Puzzles: the e2e database has no puzzle dump, so the test seeds one puzzle
// for the user's opening, solves it and checks the attempt is recorded.

import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import {
	buildLine,
	clickSquare,
	createFirstRepertoire,
	registerUser,
	trackErrors
} from './helpers';

test('a puzzle from the repertoire opening can be solved', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'puzzles');
	await createFirstRepertoire(page);
	// 1. e4 e5 2. Nf3 Nc6 3. Bb5 is the Ruy Lopez.
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/, /^Nc6\b/, /^Bb5\b/]);

	// Black blunders with 3... Nf6 and White mates with Qxf7#. The position
	// isn't a Ruy Lopez; only the opening family is used for matching.
	const sql = postgres(process.env.DATABASE_URL!);
	try {
		await sql`insert into puzzle ${sql({
			puzzle_id: 'e2eRuy',
			fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
			moves: 'g8f6 h5f7',
			rating: 600,
			rating_deviation: 75,
			popularity: 90,
			nb_plays: 1000,
			themes: 'mateIn1 opening short',
			game_url: null,
			opening_tags: 'Ruy_Lopez',
			opening_family: 'ruy lopez'
		})} on conflict do nothing`;
	} finally {
		await sql.end();
	}

	await page.goto('/puzzles');
	await page.getByRole('button', { name: 'Next Puzzle' }).click();
	await expect(page.locator('.puzzle-id')).toHaveText('Puzzle #e2eRuy');
	// The board plays Black's setup move, then it's White's turn.
	await expect(page.getByText('Your turn — find the best move')).toBeVisible();
	await expect(page.locator('.autoplay-badge')).toBeHidden();

	const recorded = page.waitForResponse(
		(r) => r.url().endsWith('/api/puzzles/attempt') && r.request().method() === 'POST'
	);
	await clickSquare(page, 'h5');
	await clickSquare(page, 'f7');
	await expect(page.locator('.result-banner.solved')).toHaveText('Puzzle solved!');
	expect((await recorded).ok()).toBe(true);
	await expect(page.locator('.stat-value.correct')).toHaveText('1');

	expect(errors).toEqual([]);
});
