import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Source maps are uploaded to Sentry only when SENTRY_AUTH_TOKEN is set at
// build time (with SENTRY_ORG and SENTRY_PROJECT), so stack traces point at the
// original source. They are deleted from the build output after upload. Without
// the token the build is unchanged and nothing is sent.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);
// The config is loaded several times per build; only print once.
if (process.env.npm_lifecycle_event === 'build' && !process.env.CHESSSTACK_SENTRY_LOGGED) {
	process.env.CHESSSTACK_SENTRY_LOGGED = '1';
	// One line in the build log saying whether the token reached the build.
	console.log(
		uploadSourceMaps
			? '[sentry] SENTRY_AUTH_TOKEN is set: source maps will be uploaded.'
			: '[sentry] SENTRY_AUTH_TOKEN is not set: source maps will not be uploaded.'
	);
}

export default defineConfig({
	plugins: [
		sentrySvelteKit({
			autoUploadSourceMaps: uploadSourceMaps,
			// Wrap server load functions only: wrapping universal (+page.ts) loads
			// would pull the SDK into every page's bundle, while hooks.client.ts
			// loads it on demand.
			autoInstrument: { load: false, serverLoad: true },
			org: process.env.SENTRY_ORG,
			project: process.env.SENTRY_PROJECT,
			authToken: process.env.SENTRY_AUTH_TOKEN,
			// Tags events with the commit that built them. Railway passes this to the
			// Docker build (see the ARG in the Dockerfile); elsewhere the plugin falls
			// back to SENTRY_RELEASE or the git commit.
			...(process.env.RAILWAY_GIT_COMMIT_SHA && {
				release: { name: process.env.RAILWAY_GIT_COMMIT_SHA }
			}),
			telemetry: false
		}),
		sveltekit()
	],
	build: {
		// Never inline fonts as data: URLs (Vite inlines files under 4 KB by default):
		// the Content-Security-Policy only allows fonts from our own origin.
		assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? false : undefined)
	},
	test: {
		// Unit-test coverage, written to coverage/ by `npm run test:coverage` (CI shows
		// the totals in the job summary and uploads the HTML report). Every source file
		// is listed, tested or not, so gaps show up. Code covered only by the database
		// tests counts as uncovered here. No threshold yet: this shows where unit tests
		// are thin rather than gating merges.
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/lib/test/**', 'src/**/*.d.ts'],
			reporter: [
				'text-summary',
				'html',
				['text-summary', { file: 'summary.txt' }],
				['text', { file: 'files.txt', maxCols: 120 }]
			]
		},
		projects: [
			{
				// Pure logic — no database or network. Run with `npm test`.
				extends: true,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.db.test.ts', 'src/**/*.svelte.test.ts']
				}
			},
			{
				// Svelte 5 runes modules (*.svelte.test.ts), compiled for the browser so
				// $state/$effect behave as they do in the app. Runs with `npm test`.
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'unit-svelte',
					environment: './src/lib/test/svelte-client-environment.ts',
					include: ['src/**/*.svelte.test.ts']
				}
			},
			{
				// Integration tests against a real PostgreSQL database (migrations are
				// applied automatically). Requires DATABASE_URL pointing at a disposable
				// database — tables are truncated between tests. Run with `npm run test:db`.
				extends: true,
				test: {
					name: 'db',
					environment: 'node',
					include: ['src/**/*.db.test.ts'],
					globalSetup: ['src/lib/test/db-global-setup.ts'],
					setupFiles: ['src/lib/test/db-setup.ts'],
					// Test files share one database, so run them one at a time.
					fileParallelism: false,
					env: { SEED_DATA_DIR: '/nonexistent', EDITION: 'cloud' }
				}
			}
		]
	}
});
