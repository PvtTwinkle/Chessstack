// Shared Sentry helpers, used by both hooks.server.ts and hooks.client.ts.
//
// Sentry is optional: with no DSN set nothing is initialised and nothing is
// sent anywhere. These helpers keep personal data out of the events that are
// sent when it is configured.

import type { init } from '@sentry/sveltekit';

type Options = NonNullable<Parameters<typeof init>[0]>;
type ErrorEvent = Parameters<NonNullable<Options['beforeSend']>>[0];
type Span = Parameters<NonNullable<Options['beforeSendSpan']>>[0];
type Breadcrumb = Parameters<NonNullable<Options['beforeBreadcrumb']>>[0];

/**
 * What the SDK may collect, shared by the server and browser setups. Sentry
 * collects most request data by default; this turns off everything that can
 * carry personal data or secrets (cookies, IPs, request bodies, query strings,
 * local variables in stack frames — which could hold a password).
 */
export const DATA_COLLECTION: Options['dataCollection'] = {
	userInfo: false,
	cookies: false,
	httpHeaders: { request: { allow: ['user-agent', 'content-type', 'accept'] }, response: false },
	httpBodies: [],
	urlQueryParams: false,
	databaseQueryData: false,
	queues: false,
	stackFrameVariables: false
};

/** Parses a sample rate env var, falling back when it is unset or invalid. */
export function parseSampleRate(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === '') return fallback;
	const rate = Number(value);
	return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
}

/**
 * The origin events are posted to, for the Content-Security-Policy connect-src
 * directive (e.g. https://o123.ingest.us.sentry.io). Null when the DSN is
 * unset or malformed.
 */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
	if (!dsn) return null;
	try {
		const url = new URL(dsn);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
	} catch {
		return null;
	}
}

/**
 * Drops the query string and fragment from a URL. Query strings can carry
 * secrets: the password-reset and email-verification links put their token
 * there.
 */
export function stripQuery(url: string): string {
	const cut = url.search(/[?#]/);
	return cut === -1 ? url : url.slice(0, cut);
}

/** Removes personal data from an event before it leaves the server or browser. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
	if (event.request) {
		if (event.request.url) event.request.url = stripQuery(event.request.url);
		delete event.request.query_string;
		delete event.request.cookies;
		delete event.request.data;
		if (event.request.headers) {
			for (const name of Object.keys(event.request.headers)) {
				const lower = name.toLowerCase();
				if (
					lower === 'cookie' ||
					lower === 'authorization' ||
					lower === 'referer' ||
					lower.includes('forwarded') ||
					lower.endsWith('-ip')
				) {
					delete event.request.headers[name];
				}
			}
		}
	}
	// Only the numeric user id is attached (see hooks.server.ts); never an
	// email, username or IP address.
	if (event.user) {
		event.user = event.user.id !== undefined ? { id: event.user.id } : {};
	}
	event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb);
	return event;
}

/** Strips query strings from the URLs recorded in navigation and fetch breadcrumbs. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
	const data = breadcrumb.data;
	if (data) {
		for (const key of ['url', 'from', 'to']) {
			if (typeof data[key] === 'string') data[key] = stripQuery(data[key]);
		}
	}
	return breadcrumb;
}

/**
 * Removes query strings and client details from performance spans (sent when
 * SENTRY_TRACES_SAMPLE_RATE is above 0).
 */
export function scrubSpan(span: Span): Span {
	span.name = stripQuery(span.name);
	for (const [key, value] of Object.entries(span.attributes)) {
		if (
			key.includes('query') ||
			key.startsWith('client.') ||
			key.includes('client_ip') ||
			(key.startsWith('user.') && key !== 'user.id')
		) {
			delete span.attributes[key];
		} else if (typeof value === 'string' && (key.includes('url') || key.includes('target'))) {
			span.attributes[key] = stripQuery(value);
		}
	}
	return span;
}

/**
 * True for the browser's "couldn't load a code chunk" errors (Chrome, Safari
 * and Firefox word them differently). These usually mean the tab was opened
 * before a deploy and is asking for a chunk the new build no longer has.
 */
export function isChunkLoadError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
		message
	);
}
