// Server-side Sentry setup. Imported first in hooks.server.ts so it runs
// before the database module (which migrates on import), letting Sentry see
// errors from the rest of startup too.
//
// Off unless SENTRY_DSN is set, like the Loops and Stripe integrations: forks,
// self-hosted installs and local dev send nothing anywhere.

import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { DATA_COLLECTION, parseSampleRate, scrubEvent, scrubSpan } from '$lib/sentry';
import { log } from '$lib/server/log';

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
	Sentry.init({
		dsn: SENTRY_DSN,
		environment: dev ? 'development' : 'production',
		// A small share of requests is traced for performance data; errors are
		// always reported regardless of this rate.
		tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.05),
		// The health check is polled every 30s; tracing it would only use up quota.
		ignoreSpans: ['GET /api/health'],
		// No cookies, IP addresses or request bodies; scrubEvent removes the rest.
		dataCollection: DATA_COLLECTION,
		beforeSend: (event) => scrubEvent(event),
		beforeSendSpan: (span) => scrubSpan(span)
	});
}

// Say at startup whether reporting is on, so a missing or misnamed variable
// shows up in the deploy logs instead of as silence in Sentry.
log.info(
	SENTRY_DSN
		? 'Sentry server error reporting enabled.'
		: 'Sentry server error reporting off (SENTRY_DSN not set).'
);
log.info(
	process.env.PUBLIC_SENTRY_DSN
		? 'Sentry browser error reporting enabled.'
		: 'Sentry browser error reporting off (PUBLIC_SENTRY_DSN not set).'
);
