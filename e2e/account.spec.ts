// Account flows: settings that persist, changing the password, and an admin
// disabling another account.

import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import {
	AT_ANON_HOME,
	PASSWORD,
	createFirstRepertoire,
	registerUser,
	signIn,
	trackErrors
} from './helpers';

test('settings are saved, and a changed password is the one that works', async ({ page }) => {
	const errors = trackErrors(page);
	const username = await registerUser(page, 'settings');
	await createFirstRepertoire(page);

	// ── A saved Lichess username survives a reload and enables game import ─
	await page.goto('/settings');
	await page.locator('#lichess-username').fill('smoke_lichess');
	const saved = page.waitForResponse(
		(r) => r.url().endsWith('/api/settings') && r.request().method() !== 'GET'
	);
	await page
		.locator('.setting-row', { has: page.locator('#lichess-username') })
		.getByRole('button', { name: 'Save' })
		.click();
	expect((await saved).ok()).toBe(true);
	await page.reload();
	await expect(page.locator('#lichess-username')).toHaveValue('smoke_lichess');

	await page.goto('/review');
	await page.getByRole('button', { name: 'Import Games' }).click();
	await expect(page.getByRole('button', { name: 'Import from Lichess' })).toBeEnabled();

	// ── Change the email: only with the current password ──────────────────
	await page.goto('/settings');
	const emailForm = page.locator('.email-form');
	await emailForm.locator('input[type=email]').fill(`${username}-new@example.com`);
	await emailForm.getByPlaceholder('Current password').fill('Wrong-Password-1');
	await emailForm.getByRole('button', { name: 'Save Email' }).click();
	await expect(page.getByText('Password is incorrect')).toBeVisible();
	await emailForm.getByPlaceholder('Current password').fill(PASSWORD);
	await emailForm.getByRole('button', { name: 'Save Email' }).click();
	await expect(page.getByText('Email updated')).toBeVisible();
	await page.reload();
	await expect(emailForm.locator('input[type=email]')).toHaveValue(`${username}-new@example.com`);

	// ── Change the password ────────────────────────────────────────────────
	// A second browser signed in to the same account is signed out by the
	// change, and this browser keeps working on a new session token.
	const other = await page.context().browser()!.newContext();
	const otherPage = await other.newPage();
	await signIn(otherPage, username);
	await expect(otherPage.getByRole('button', { name: 'Sign out' })).toBeVisible();
	const sessionToken = async () =>
		(await page.context().cookies()).find((c) => c.name === 'chessstack_session')?.value;
	const tokenBefore = await sessionToken();

	const newPassword = 'Changed-Smoke-Pass-2';
	const passwordForm = page.locator('.password-form');
	await passwordForm.getByPlaceholder('Current password').fill(PASSWORD);
	await passwordForm.getByPlaceholder('New password (min 12 characters)').fill(newPassword);
	await passwordForm.getByPlaceholder('Confirm new password').fill(newPassword);
	await passwordForm.getByRole('button', { name: 'Change Password' }).click();
	await expect(page.getByText('Password changed successfully')).toBeVisible();

	expect(await sessionToken()).not.toBe(tokenBefore);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	await otherPage.goto('/settings');
	await expect(otherPage).toHaveURL(AT_ANON_HOME);
	await other.close();

	// The old password no longer signs in; the new one does.
	await page.getByRole('button', { name: 'Sign out' }).click();
	await signIn(page, username);
	await expect(page.getByText('Invalid username or password.')).toBeVisible();
	await signIn(page, username, newPassword);
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

	expect(errors).toEqual([]);
});

test('admin: non-admins are kept out, and disabling a user signs them out', async ({
	page,
	browser
}) => {
	const errors = trackErrors(page);

	// The user who will be disabled, signed in in a browser of their own.
	const victimContext = await browser.newContext();
	const victimPage = await victimContext.newPage();
	const victim = await registerUser(victimPage, 'victim');

	const admin = await registerUser(page, 'admin');
	await page.goto('/admin');
	await expect(page).toHaveURL(/\/$/);

	const sql = postgres(process.env.DATABASE_URL!);
	try {
		await sql`update "user" set role = 'admin' where username = ${admin}`;
	} finally {
		await sql.end();
	}

	await page.goto('/admin');
	await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
	await page.getByPlaceholder('Search by username or email...').fill(victim);
	const card = page.locator('.user-card', { hasText: victim });
	await expect(page.locator('.user-card')).toHaveCount(1);
	await card.getByRole('button', { name: 'Disable' }).click();
	await expect(card.locator('.disabled-badge')).toBeVisible();

	// The disabled user's session ends on their next request, and they can't sign back in.
	await victimPage.goto('/settings');
	await expect(victimPage).toHaveURL(AT_ANON_HOME);
	await signIn(victimPage, victim);
	await expect(victimPage.getByText('This account has been disabled.')).toBeVisible();
	await victimContext.close();

	expect(errors).toEqual([]);
});
