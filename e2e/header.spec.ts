// The signed-in header: Sign out stays reachable at every width, from the
// header on wide screens and from the hamburger menu on narrow ones.

import { expect, test, type Page } from '@playwright/test';
import { createFirstRepertoire, registerUser, trackErrors } from './helpers';

/** The header is fixed, so anything past its right edge can't be scrolled to. */
async function headerFits(page: Page): Promise<boolean> {
	return page
		.locator('.app-header')
		.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollWidth <= window.innerWidth);
}

test('Sign out is reachable from the header on desktop and laptop widths', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'header');
	await createFirstRepertoire(page);

	for (const width of [1440, 1280, 1200]) {
		await page.setViewportSize({ width, height: 800 });
		await page.goto('/');
		expect(await headerFits(page), `header overflows at ${width}px`).toBe(true);
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
	}

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login$/);

	expect(errors).toEqual([]);
});

test('Sign out is in the menu on narrow widths, and Escape closes the menu', async ({ page }) => {
	const errors = trackErrors(page);
	await registerUser(page, 'menu');
	await createFirstRepertoire(page);

	for (const width of [1100, 390]) {
		await page.setViewportSize({ width, height: 800 });
		await page.goto('/');
		expect(await headerFits(page), `header overflows at ${width}px`).toBe(true);

		const toggle = page.getByRole('button', { name: 'Toggle navigation menu' });
		const menu = page.getByRole('navigation', { name: 'Main menu' });
		await toggle.click();
		await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		await expect(toggle).toBeFocused();
	}

	await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
	await page
		.getByRole('navigation', { name: 'Main menu' })
		.getByRole('button', { name: 'Sign out' })
		.click();
	await expect(page).toHaveURL(/\/login$/);

	expect(errors).toEqual([]);
});

test('the skip link moves focus past the header to the page', async ({ page }) => {
	await registerUser(page, 'skip');
	await createFirstRepertoire(page);
	await page.goto('/');

	await page.keyboard.press('Tab');
	const skip = page.getByRole('link', { name: 'Skip to content' });
	await expect(skip).toBeFocused();
	await expect(skip).toBeInViewport();
	await page.keyboard.press('Enter');
	await expect(page.locator('main')).toBeFocused();
});
