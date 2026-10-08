// The self-hosted edition: the default admin can sign in, sign-up works
// without an email or referral code, there are no plan limits or billing,
// and the marketing site is not served.

import { expect, test } from '@playwright/test';
import { IS_CLOUD, PASSWORD, signIn, trackErrors } from './helpers';

test.skip(IS_CLOUD, 'self-hosted edition only');

test('the default admin created on first run can sign in and manage users', async ({ page }) => {
	const errors = trackErrors(page);
	await signIn(page, 'admin', 'changeme');
	await expect(page).not.toHaveURL(/\/login$/);
	await page.goto('/admin');
	await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
	// No subscription badges or gift buttons without plans.
	await expect(page.getByRole('button', { name: /gift/i })).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('sign-up without an email, no referral field, no plan limits, no billing', async ({
	page
}) => {
	const errors = trackErrors(page);
	const username = `selfhost${Date.now()}`;
	await page.goto('/register');
	await expect(page.locator('input[name=referralCode]')).toHaveCount(0);
	await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
	await page.fill('input[name=username]', username);
	await page.fill('input[name=password]', PASSWORD);
	await page.fill('input[name=confirmPassword]', PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Welcome to Chessstack' })).toBeVisible();

	for (const [name, color] of [
		['First', 'WHITE'],
		['Second', 'BLACK'],
		['Third', 'WHITE']
	]) {
		const res = await page.request.post('/api/repertoires', { data: { name, color } });
		expect(res.status(), name).toBe(201);
	}

	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Board Appearance' })).toBeVisible();
	await expect(page.locator('#subscription')).toHaveCount(0);
	await expect(page.getByText(/referral/i)).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('the marketing site is not served and visitors go to the login form', async ({
	page,
	request
}) => {
	for (const path of [
		'/landing',
		'/openings',
		'/openings/sicilian-defense',
		'/blog',
		'/terms',
		'/privacy',
		'/sitemap.xml',
		'/llms.txt'
	]) {
		expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
	}

	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);

	const csp = (await request.get('/login')).headers()['content-security-policy'];
	expect(csp).not.toContain('cloudflareinsights');
});
