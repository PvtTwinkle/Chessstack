// Opening trainer: play against the computer, which picks its replies from
// the players database (seeded here with one reply, since the e2e database
// has no dump), then the browser's Stockfish evaluates the final position and
// the game is handed to Review.

import { expect, test } from '@playwright/test';
import { Chess } from 'chess.js';
import postgres from 'postgres';
import {
	buildLine,
	clickSquare,
	createFirstRepertoire,
	registerUser,
	trackErrors
} from './helpers';

const fenKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

test('play a rated trainer game, get an evaluation, then review it', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'trainer');
	await createFirstRepertoire(page);
	await buildLine(page, [/^e4\b/, /^e5\b/, /^Nf3\b/]);

	// The computer's only known reply: 1... e5, in every rating bracket.
	const chess = new Chess();
	chess.move('e4');
	const afterE4 = fenKey(chess.fen());
	chess.move('e5');
	const afterE5 = fenKey(chess.fen());
	const sql = postgres(process.env.DATABASE_URL!);
	try {
		const rows = Array.from({ length: 8 }, (_, bracket) => ({
			position_fen: afterE4,
			move_san: 'e5',
			rating_bracket: bracket,
			resulting_fen: afterE5,
			games_played: 100
		}));
		await sql`insert into lichess_moves ${sql(rows)} on conflict do nothing`;
	} finally {
		await sql.end();
	}

	await page.goto('/train');
	await page.getByRole('button', { name: 'Set Rating' }).click();
	await page.getByRole('button', { name: 'Start Training' }).click();

	const yourMove = page.locator('.turn-indicator.user-turn');
	await expect(yourMove).toBeVisible();
	await clickSquare(page, 'e2');
	await clickSquare(page, 'e4');
	await expect(page.locator('.move-list')).toContainText('e5');
	await expect(yourMove).toBeVisible();
	await clickSquare(page, 'g1');
	await clickSquare(page, 'f3');

	// No reply is known after 2. Nf3, so the session ends and the browser's Stockfish evaluates.
	await expect(page.locator('.end-reason')).toHaveText(
		'The database has no more moves for this position.'
	);
	const evalRow = page.locator('.eval-row', { hasText: 'Position Eval' });
	await expect(evalRow.locator('.eval-value')).not.toHaveText('N/A', { timeout: 15_000 });
	await expect(page.locator('.eval-row', { hasText: 'Rating' })).toBeVisible();

	// The game goes to Review, where it matches the repertoire.
	await page.getByRole('button', { name: 'Review Game' }).click();
	await expect(page).toHaveURL(/\/review$/);
	await expect(page.getByText('No deviations found!')).toBeVisible();

	expect(errors).toEqual([]);
});
