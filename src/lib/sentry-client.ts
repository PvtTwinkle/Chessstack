// Browser Sentry setup, loaded on demand by hooks.client.ts when
// PUBLIC_SENTRY_DSN is set. Kept in its own module with named imports so the
// bundler can drop the parts of the SDK we don't use (tracing, replay…).

import { captureException, init } from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from '$lib/sentry';

export function initSentry(dsn: string): void {
	init({
		dsn,
		environment: dev ? 'development' : 'production',
		// Errors only: no performance tracing or session replay in the browser,
		// and no page content is sent.
		dataCollection: DATA_COLLECTION,
		beforeSend: (event) => scrubEvent(event),
		beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb)
	});
}

export function reportError(error: unknown): void {
	captureException(error, {
		mechanism: { type: 'auto.function.sveltekit.handle_error', handled: false }
	});
}
