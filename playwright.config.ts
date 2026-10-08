// End-to-end smoke tests: drive the production build in a real browser.
//
// Requires a built app (`npm run build`) and DATABASE_URL pointing at a
// PostgreSQL database the tests may write to (migrations run on startup).
// Run with `npm run test:e2e`.
//
// PW_CHROMIUM_PATH optionally points at an existing Chromium binary instead of
// one downloaded by `npx playwright install chromium`.
//
// Every test registers its own accounts from one IP, so the e2e server raises
// the registration rate limit (RATE_LIMIT_REGISTER). Use a fresh database for
// every run anyway: the first account registered becomes the admin.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: BASE_URL,
		viewport: { width: 1400, height: 900 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		launchOptions: process.env.PW_CHROMIUM_PATH
			? { executablePath: process.env.PW_CHROMIUM_PATH }
			: {}
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } }
		}
	],
	webServer: {
		command: 'node build/index.js',
		url: `${BASE_URL}/api/health`,
		timeout: 120_000,
		reuseExistingServer: !process.env.CI,
		env: {
			DATABASE_URL: process.env.DATABASE_URL ?? '',
			ORIGIN: BASE_URL,
			PORT: String(PORT),
			// CI runs the suite once per edition; locally it defaults to cloud.
			EDITION: process.env.EDITION ?? 'cloud',
			REGISTRATION_MODE: 'open',
			RATE_LIMIT_REGISTER: '1000',
			SEED_DATA_DIR: '/nonexistent'
		}
	}
});
