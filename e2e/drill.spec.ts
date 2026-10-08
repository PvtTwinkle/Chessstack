// Drill mode: card drilling (correct, wrong, hint, undo, keyboard grading,
// session summary), depth-section filters, and line drilling.

import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import {
	buildLine,
	clickSquare,
	createFirstRepertoire,
	registerUser,
	trackErrors
} from './helpers';

// 1. e4 e5 2. Nf3 Nc6 3. Bb5 — White repertoire. Cards are the user's moves
// after the first: 2. Nf3 and 3. Bb5.
const LINE = [/^e4\b/, /^e5\b/, /^Nf3\b/, /^Nc6\b/, /^Bb5\b/];

async function setUp(page: Page, prefix: string) {
	await registerUser(page, prefix);
	await createFirstRepertoire(page);
	await buildLine(page, LINE);
	await page.goto('/drill');
	// The due cards reach the page through an effect, which only runs in the
	// browser: the server-rendered page shows none. Seeing the count means the
	// page has hydrated, so its buttons and keyboard shortcuts respond. Pressing
	// Space before then was silently ignored whenever hydration finished after
	// the load event.
	await expect(page.locator('.start-count')).toHaveText('2');
}

const yourTurn = (page: Page) => page.locator('.turn-indicator.user-turn');

/** The correct move for the card on screen, derived from the line played so far. */
async function expectedMove(page: Page): Promise<[string, string]> {
	const played = (await page.locator('.move-list').first().innerText()).replace(/\s+/g, ' ');
	return played.includes('Nc6') ? ['f1', 'b5'] : ['g1', 'f3'];
}

async function play(page: Page, [from, to]: [string, string]) {
	await clickSquare(page, from);
	await clickSquare(page, to);
}

test('card drill: wrong answer, correct answer, and the session summary', async ({ page }) => {
	const errors = trackErrors(page);
	await setUp(page, 'drillcards');
	await expect(page.locator('.start-count')).toHaveText('2');
	await page.getByRole('button', { name: /Start Drilling/ }).click();

	// Card 1: play a wrong (legal) move.
	await expect(yourTurn(page)).toBeVisible();
	const first = await expectedMove(page);
	await play(page, ['d2', 'd4']);
	await expect(page.locator('.feedback--incorrect')).toBeVisible();
	await expect(page.locator('.revealed-move')).toHaveText(first[1] === 'f3' ? 'Nf3' : 'Bb5');
	await page.getByRole('button', { name: /^Next/ }).click();

	// Card 2: play the right move and grade it.
	await expect(yourTurn(page)).toBeVisible();
	await play(page, await expectedMove(page));
	await expect(page.locator('.feedback--correct')).toHaveText(/Correct!/);
	await expect(page.locator('.grade-btn')).toHaveCount(3);
	await page.locator('.grade-btn--unsure').click();
	await page.getByRole('button', { name: /^Next/ }).click();

	await expect(page.locator('.complete-title')).toHaveText('Session complete');
	const stats = page.locator('.complete-stats');
	await expect(stats.locator('.stat-row', { hasText: 'Cards reviewed' })).toContainText('2');
	await expect(stats.locator('.stat-row', { hasText: 'Correct first try' })).toContainText(
		'1 (50%)'
	);
	await expect(stats.locator('.stat-row', { hasText: 'Next session' })).not.toContainText('—');

	expect(errors).toEqual([]);
});

test('card drill: hint, undo, and keyboard grading', async ({ page }) => {
	const errors = trackErrors(page);
	await setUp(page, 'drillkeys');
	await page.keyboard.press('Space'); // start
	await expect(yourTurn(page)).toBeVisible();

	// Hint highlights the piece and forces a Forgot grade.
	await page.getByRole('button', { name: /Hint/ }).click();
	await expect(page.locator('.hint-active')).toContainText('Move will be graded Forgot');
	await play(page, await expectedMove(page));
	await expect(page.locator('.feedback--correct')).toHaveText(/Correct! \(hint used\)/);
	await expect(page.locator('.grade-btn')).toHaveCount(0);
	await page.keyboard.press('Space'); // next

	// Grade with a key, then undo the grade.
	await expect(yourTurn(page)).toBeVisible();
	await play(page, await expectedMove(page));
	await expect(page.locator('.grade-btn')).toHaveCount(3);
	await page.keyboard.press('3'); // Easy
	const undo = page.getByRole('button', { name: /^Undo/ });
	await expect(undo).toBeVisible();
	await page.keyboard.press('z');
	await expect(page.locator('.grade-btn')).toHaveCount(3);
	await page.keyboard.press('2'); // Unsure
	// Space only advances once the grade is saved and Next is shown.
	await expect(page.getByRole('button', { name: /^Next/ })).toBeVisible();
	await page.keyboard.press('Space'); // next

	await expect(page.locator('.complete-title')).toHaveText('Session complete');
	await expect(page.locator('.stat-row', { hasText: 'Cards reviewed' })).toContainText('2');
	await page.getByRole('button', { name: 'Drill again' }).click();
	expect(errors).toEqual([]);
});

test('depth-section filters', async ({ page }) => {
	await setUp(page, 'drillsections');
	const tab = (name: RegExp) => page.locator('.section-tab', { hasText: name });
	await expect(tab(/^All Moves/)).toContainText('2');
	await expect(tab(/^Foundation/)).toContainText('2');
	await tab(/^Mainlines/).click();
	await expect(page.locator('.start-count')).toHaveText('0');
	await expect(page.getByRole('button', { name: /Start Drilling/ })).toBeDisabled();
	await tab(/^Foundation/).click();
	await expect(page.locator('.start-count')).toHaveText('2');
});

test('line drill: play a whole line', async ({ page }) => {
	const errors = trackErrors(page);
	await setUp(page, 'drilllines');
	await page.locator('.drill-type-btn', { hasText: 'Lines' }).click();
	await page.getByRole('button', { name: /Start Drilling/ }).click();

	// Each user move waits until the opponent's previous reply is on the board.
	const steps: [string, [string, string]][] = [
		['', ['e2', 'e4']],
		['e5', ['g1', 'f3']],
		['Nc6', ['f1', 'b5']]
	];
	for (const [afterReply, move] of steps) {
		// The reply shows up in the line while auto-play is still running, so wait
		// for it first and only then for the board to hand the turn back.
		if (afterReply) await expect(page.locator('.move-list').first()).toContainText(afterReply);
		await expect(yourTurn(page)).toBeVisible();
		await play(page, move);
	}

	await expect(page.locator('.line-complete-screen')).toContainText('Line complete');
	await expect(page.locator('.stat-row', { hasText: 'Moves correct' })).toContainText(
		'3 / 3 (100%)'
	);
	expect(errors).toEqual([]);
});

test('depth sections count cards by how deep they are in the line', async ({ page }) => {
	await registerUser(page, 'drilldepth');
	await createFirstRepertoire(page);
	const reps = (await (await page.request.get('/api/repertoires')).json()) as { id: number }[];
	const repertoireId = reps[0].id;

	// A 17-move Ruy Lopez line. White's cards are moves 2–17 (the first move
	// starts the repertoire): 4 in moves 1–5, 10 in 6–15 and 2 in 16+.
	const line =
		'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 Nbd2 Bb7 ' +
		'Bc2 Re8 Nf1 Bf8 Ng3 g6 a4 c5 d5 c4 Bg5 h6';
	const chess = new Chess();
	for (const san of line.split(' ')) {
		const res = await page.request.post('/api/moves', {
			data: { repertoireId, fromFen: chess.fen(), san }
		});
		expect(res.ok(), `saving ${san}`).toBe(true);
		chess.move(san);
	}

	await page.goto('/drill');
	const tab = (name: RegExp) => page.locator('.section-tab', { hasText: name });
	await expect(tab(/^All Moves/)).toContainText('16');
	await expect(tab(/^Foundation/)).toContainText('4');
	await expect(tab(/^Mainlines/)).toContainText('10');
	await expect(tab(/^Deep/)).toContainText('2');

	await tab(/^Deep/).click();
	await expect(page.locator('.start-count')).toHaveText('2');
	await page.getByRole('button', { name: /Start Drilling/ }).click();
	// Auto-play replays ~30 moves at 0.5 s each before the user's turn.
	await expect(yourTurn(page)).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.move-list').first()).toContainText('15.');
});
