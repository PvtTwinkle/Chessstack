// SvelteKit client hooks — runs in the browser.
//
// Reports unexpected errors in the browser (failed hydration, crashes in a
// component or a load function) to Sentry. Off unless PUBLIC_SENTRY_DSN is
// set; it is read at runtime, so one Docker image works with or without it.
//
// The SDK is loaded with a dynamic import so it is its own chunk: pages only
// download it when Sentry is configured.

import type { HandleClientError } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { updated } from '$app/state';
import { isChunkLoadError } from '$lib/sentry';

const DSN = env.PUBLIC_SENTRY_DSN;

const sentry = DSN
	? import('$lib/sentry-client').then((module) => {
			module.initSentry(DSN);
			return module;
		})
	: null;

export const handleError: HandleClientError = async ({ error, status }) => {
	// A 404 is a mistyped or stale link, not a bug.
	if (!sentry || status === 404) return;
	// A tab opened before a deploy asks for chunks the new build no longer has,
	// most often when hovering a link preloads it. SvelteKit already reloads the
	// page when that link is clicked, so skip it when a newer version is live or
	// the visitor is offline. With no new version it is a broken deploy: report it.
	if (isChunkLoadError(error) && (!navigator.onLine || (await updated.check()))) return;
	try {
		(await sentry).reportError(error);
	} catch {
		// The SDK failed to load (e.g. blocked by an ad blocker); nothing to report to.
	}
};
