// Critical-path smoke test: a new user registers, creates a repertoire, builds
// a short line and drills it. Also checks that the main pages render without
// client-side errors, that anonymous requests are turned away, and the
// sign-out / sign-in / delete-account round trip.

import { expect, test } from '@playwright/test';
import {
	ANON_HOME,
	AT_ANON_HOME,
	PASSWORD,
	clickSquare,
	registerUser,
	signIn,
	skipTutorial,
	trackErrors
} from './helpers';

test.describe('public pages', () => {
	test('landing page and health check are reachable without logging in', async ({
		page,
		request
	}) => {
		const errors = trackErrors(page);
		await page.goto('/');
		await expect(page).toHaveTitle(/Chessstack/i);
		expect((await request.get('/api/health')).ok()).toBe(true);
		const ready = await request.get('/api/health/ready');
		expect(ready.status()).toBe(200);
		expect(await ready.json()).toEqual({ status: 'ok', db: 'ok' });
		expect(errors).toEqual([]);
	});

	test('protected pages redirect anonymous visitors to the landing page', async ({ page }) => {
		await page.goto('/build');
		await expect(page).toHaveURL(AT_ANON_HOME);
	});

	test('API and admin routes turn away anonymous requests', async ({ request }) => {
		const routes: [string, string][] = [
			['GET', '/api/repertoires'],
			['POST', '/api/moves'],
			['GET', '/api/settings'],
			['GET', '/api/admin/users'],
			['GET', '/admin']
		];
		for (const [method, path] of routes) {
			const res = await request.fetch(path, { method, maxRedirects: 0 });
			expect(res.status(), `${method} ${path}`).toBe(302);
			expect(res.headers()['location'], `${method} ${path}`).toBe(ANON_HOME);
		}

		// Form posts from another site are refused (SvelteKit's CSRF check).
		const crossSite = await request.post('/login', {
			form: { username: 'someone', password: PASSWORD },
			headers: { origin: 'https://evil.example' }
		});
		expect(crossSite.status()).toBe(403);
	});

	test('pages carry the security headers', async ({ request }) => {
		const headers = (await request.get('/')).headers();
		expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
		expect(headers['strict-transport-security']).toContain('max-age=');
		expect(headers['x-frame-options']).toBe('SAMEORIGIN');
		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	});

	test('the in-browser engine files load without a session', async ({ request }) => {
		// Engine workers fetch these themselves, so they must not depend on the
		// session cookie, and the worker script needs COEP to run multi-threaded.
		const script = await request.get('/engine/stockfish-19-lite.js', { maxRedirects: 0 });
		expect(script.status()).toBe(200);
		expect(script.headers()['content-type']).toContain('javascript');
		expect(script.headers()['cross-origin-embedder-policy']).toBe('credentialless');
		const wasm = await request.get('/engine/stockfish-19-lite-single.wasm', { maxRedirects: 0 });
		expect(wasm.status()).toBe(200);
		expect(wasm.headers()['content-type']).toBe('application/wasm');
	});
});

test('register → create repertoire → build a line → drill it', async ({ page }) => {
	const errors = trackErrors(page);
	const username = `smoke${Date.now()}`;

	// ── Register ───────────────────────────────────────────────────────────
	await page.goto('/register');
	await page.fill('input[name=username]', username);
	await page.fill('input[name=email]', `${username}@example.com`);
	await page.fill('input[name=password]', PASSWORD);
	await page.fill('input[name=confirmPassword]', PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Welcome to Chessstack' })).toBeVisible();

	// ── Create a repertoire ────────────────────────────────────────────────
	await page.getByPlaceholder('e.g. White — e4 lines').fill('Smoke White');
	await page.getByRole('button', { name: 'Create Repertoire' }).click();
	await expect(page).toHaveURL(/\/build$/);
	await skipTutorial(page);

	// ── Build 1. e4 e5 2. Nf3 from the book-move suggestions ───────────────
	for (const move of [/^e4\b/, /^e5\b/, /^Nf3\b/]) {
		const saved = page.waitForResponse(
			(r) => r.url().endsWith('/api/moves') && r.request().method() === 'POST'
		);
		await page.getByRole('button', { name: move }).first().click();
		expect((await saved).ok()).toBe(true);
	}
	await expect(page.getByText('Current line')).toBeVisible();

	// ── Drill the line ─────────────────────────────────────────────────────
	await page.getByRole('link', { name: 'Drill', exact: true }).click();
	await expect(page).toHaveURL(/\/drill$/);
	await page.getByRole('button', { name: /Start Drilling/ }).click();
	await expect(page.getByText('Card 1 of 1')).toBeVisible();

	// The board auto-plays 1. e4 e5; the user must answer 2. Nf3.
	await page.waitForTimeout(1500); // let the auto-play animation finish
	await clickSquare(page, 'g1');
	await clickSquare(page, 'f3');
	await expect(page.getByText('Correct!')).toBeVisible();

	const graded = page.waitForResponse(
		(r) => r.request().method() !== 'GET' && /\/api\/(review|drill)/.test(r.url())
	);
	await page.getByRole('button', { name: /Easy/ }).first().click();
	expect((await graded).ok()).toBe(true);

	// ── Other main pages render ────────────────────────────────────────────
	for (const path of ['/', '/train', '/puzzles', '/review', '/prep', '/settings']) {
		const res = await page.goto(path);
		expect(res?.status(), path).toBeLessThan(400);
	}

	expect(errors).toEqual([]);
});

test('sign out, sign back in, then delete the account', async ({ page }) => {
	const errors = trackErrors(page);
	const username = await registerUser(page, 'delete');

	// ── Sign out and back in ───────────────────────────────────────────────
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login$/);
	await page.goto('/build');
	await expect(page).toHaveURL(AT_ANON_HOME);

	await signIn(page, username);
	await expect(page.getByRole('heading', { name: 'Welcome to Chessstack' })).toBeVisible();

	// ── Delete the account: wrong password first ───────────────────────────

	await page.goto('/settings');
	await page.getByRole('button', { name: 'Delete My Account' }).click();
	const modal = page.locator('.modal-content');
	await expect(modal.getByRole('heading', { name: 'Delete Account' })).toBeVisible();

	await modal.locator('#delete-password').fill('Wrong-Password-123');
	await modal.getByRole('button', { name: 'Delete Account' }).click();
	await expect(modal.locator('.error-msg')).toBeVisible();

	await modal.locator('#delete-password').fill(PASSWORD);
	await modal.getByRole('button', { name: 'Delete Account' }).click();
	await expect(page).toHaveURL(AT_ANON_HOME);

	// The deleted credentials no longer work.
	await signIn(page, username);
	await expect(page.getByText('Invalid username or password.')).toBeVisible();

	expect(errors).toEqual([]);
});
