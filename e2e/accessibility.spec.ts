// Accessibility scan with axe-core over the public pages and every app page,
// signed in, in both themes.
//
// Violations are listed in the job summary (and attached to the test as JSON).
// With AXE_ENFORCE=1, as CI sets it, serious and critical ones fail the run;
// without it the scan only reports, which is handy when running it locally.

import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { IS_CLOUD, createFirstRepertoire, registerUser } from './helpers';

const ENFORCE = process.env.AXE_ENFORCE === '1';
const BLOCKING = new Set(['serious', 'critical']);

const PUBLIC_PAGES = ['/', '/openings', '/blog', '/login', '/register'];
const APP_PAGES = [
	'/',
	'/build',
	'/drill',
	'/review',
	'/report',
	'/train',
	'/puzzles',
	'/prep',
	'/settings'
];

type Row = { page: string; impact: string; rule: string; nodes: number; help: string };
const rows: Row[] = [];

async function scan(page: Page, label: string, testInfo: TestInfo): Promise<void> {
	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	for (const v of results.violations) {
		rows.push({
			page: label,
			impact: v.impact ?? 'unknown',
			rule: v.id,
			nodes: v.nodes.length,
			help: v.help
		});
	}
	await testInfo.attach(`axe ${label}`, {
		body: JSON.stringify(results.violations, null, 2),
		contentType: 'application/json'
	});
	if (ENFORCE) {
		const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
		expect(
			blocking.map((v) => `${v.id} (${v.nodes.length})`),
			`serious or critical violations on ${label}`
		).toEqual([]);
	}
}

test.describe('accessibility (axe)', () => {
	// The app's content fades in on every navigation, and a scan taken during
	// the fade measures half-transparent text. Reduced motion skips the fade.
	test.beforeEach(async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
	});

	test.afterAll(() => {
		const summary = process.env.GITHUB_STEP_SUMMARY;
		const edition = IS_CLOUD ? 'cloud' : 'self-hosted';
		const lines = [
			`### Accessibility (axe, ${edition} edition${ENFORCE ? '' : ', report only'})`,
			''
		];
		if (rows.length === 0) {
			lines.push('No violations found.');
		} else {
			lines.push(
				'| Page | Impact | Rule | Elements | What it means |',
				'| --- | --- | --- | --- | --- |'
			);
			for (const r of rows) {
				lines.push(`| ${r.page} | ${r.impact} | ${r.rule} | ${r.nodes} | ${r.help} |`);
			}
		}
		const text = lines.join('\n') + '\n';
		// The path comes from the Actions runner, not from page content.
		if (summary) appendFileSync(summary, text);
		else console.log(text);
	});

	test('public pages', async ({ page }, testInfo) => {
		test.skip(!IS_CLOUD, 'the marketing site is cloud edition only');
		const paths = [...PUBLIC_PAGES];

		// One opening family page and one blog post, whichever come first.
		await page.goto('/openings');
		const family = await page.locator('.opening-list a').first().getAttribute('href');
		if (family) paths.push(new URL(family, page.url()).pathname);
		await page.goto('/blog');
		const post = await page.locator('a[href*="/blog/"]').first().getAttribute('href');
		if (post) paths.push(new URL(post, page.url()).pathname);

		for (const path of paths) {
			const response = await page.goto(path);
			expect(response?.status(), path).toBe(200);
			await scan(page, path, testInfo);
		}
	});

	test('app pages in both themes', async ({ page }, testInfo) => {
		test.setTimeout(120_000);
		await registerUser(page, 'axe');
		await createFirstRepertoire(page, 'Axe White');

		for (const theme of ['dark', 'light'] as const) {
			const saved = await page.request.patch('/api/settings', { data: { appTheme: theme } });
			expect(saved.ok()).toBe(true);
			for (const path of APP_PAGES) {
				await page.goto(path);
				await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
				await scan(page, `${path} (${theme})`, testInfo);
			}
		}
	});
});
