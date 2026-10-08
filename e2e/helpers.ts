// Shared steps for the end-to-end tests.

import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Smoke-Test-Pass-1';

// The edition the server under test runs as (see playwright.config.ts). The
// marketing site exists only on the cloud edition; self-hosted instances send
// anonymous visitors to the login form instead of the landing page.
export const IS_CLOUD = (process.env.EDITION ?? 'cloud') === 'cloud';
export const ANON_HOME = IS_CLOUD ? '/' : '/login';
export const AT_ANON_HOME = IS_CLOUD ? /\/$/ : /\/login$/;

/** Collects uncaught page errors and 5xx responses so tests can assert none happened. */
export function trackErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('response', (r) => {
		if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
	});
	return errors;
}

/** Registers a fresh account and waits for the new-user welcome screen. Returns the username. */
export async function registerUser(page: Page, prefix = 'user'): Promise<string> {
	const username = `${prefix}${Date.now()}`;
	await page.goto('/register');
	await page.fill('input[name=username]', username);
	await page.fill('input[name=email]', `${username}@example.com`);
	await page.fill('input[name=password]', PASSWORD);
	await page.fill('input[name=confirmPassword]', PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Welcome to Chessstack' })).toBeVisible();
	return username;
}

/** Signs in through the login form. Callers check where it lands. */
export async function signIn(page: Page, username: string, password = PASSWORD): Promise<void> {
	await page.goto('/login');
	await page.fill('input[name=username]', username);
	await page.fill('input[name=password]', password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

/** From the welcome screen: creates a White repertoire and lands in Build mode. */
export async function createFirstRepertoire(page: Page, name = 'Smoke White'): Promise<void> {
	await page.getByPlaceholder('e.g. White — e4 lines').fill(name);
	await page.getByRole('button', { name: 'Create Repertoire' }).click();
	await expect(page).toHaveURL(/\/build$/);
	await skipTutorial(page);
}

/**
 * Dismisses the tutorial overlay and waits for the page data to reload.
 * Skipping saves the setting and then reloads the page data; the overlay
 * closes once that reload lands.
 */
export async function skipTutorial(page: Page): Promise<void> {
	const skip = page.getByRole('button', { name: 'Skip Tutorial' });
	await skip.click();
	await expect(skip).toBeHidden();
}

/** In Build mode: plays moves by clicking the book-move suggestions (one regex per move). */
export async function buildLine(page: Page, moves: RegExp[]): Promise<void> {
	for (const move of moves) {
		const saved = page.waitForResponse(
			(r) => r.url().endsWith('/api/moves') && r.request().method() === 'POST'
		);
		await page.getByRole('button', { name: move }).first().click();
		expect((await saved).ok()).toBe(true);
	}
}

/** The PGN export of the user's first repertoire, fetched through the API. */
export async function exportedPgn(page: Page): Promise<string> {
	const reps = (await (await page.request.get('/api/repertoires')).json()) as { id: number }[];
	const res = await page.request.get(`/api/repertoires/${reps[0].id}/export`);
	expect(res.ok()).toBe(true);
	return ((await res.json()) as { pgn: string }).pgn;
}

/** Clicks a square on a white-oriented chessground board, e.g. clickSquare(page, 'g1'). */
export async function clickSquare(page: Page, square: string): Promise<void> {
	const box = (await page.locator('cg-board').boundingBox())!;
	const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
	const rank = Number(square[1]);
	await page.mouse.click(
		box.x + ((file + 0.5) * box.width) / 8,
		box.y + ((8 - rank + 0.5) * box.height) / 8
	);
}
