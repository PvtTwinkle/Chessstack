import { describe, expect, it } from 'vitest';
import {
	isChunkLoadError,
	parseSampleRate,
	scrubBreadcrumb,
	scrubEvent,
	scrubSpan,
	sentryIngestOrigin,
	stripQuery
} from './sentry';

describe('sentryIngestOrigin', () => {
	it('returns the origin of a DSN for the CSP', () => {
		expect(sentryIngestOrigin('https://abc123@o456.ingest.us.sentry.io/789')).toBe(
			'https://o456.ingest.us.sentry.io'
		);
	});

	it('returns null when unset or malformed', () => {
		expect(sentryIngestOrigin(undefined)).toBeNull();
		expect(sentryIngestOrigin('')).toBeNull();
		expect(sentryIngestOrigin('not a dsn')).toBeNull();
		expect(sentryIngestOrigin("javascript:alert('x')")).toBeNull();
	});
});

describe('parseSampleRate', () => {
	it('falls back when unset, blank or out of range', () => {
		expect(parseSampleRate(undefined, 0.05)).toBe(0.05);
		expect(parseSampleRate(' ', 0.05)).toBe(0.05);
		expect(parseSampleRate('2', 0.05)).toBe(0.05);
		expect(parseSampleRate('abc', 0.05)).toBe(0.05);
	});

	it('accepts values from 0 to 1', () => {
		expect(parseSampleRate('0', 0.05)).toBe(0);
		expect(parseSampleRate('0.2', 0.05)).toBe(0.2);
		expect(parseSampleRate('1', 0.05)).toBe(1);
	});
});

describe('stripQuery', () => {
	it('removes the query string and fragment', () => {
		expect(stripQuery('https://chessstack.app/reset-password?token=secret')).toBe(
			'https://chessstack.app/reset-password'
		);
		expect(stripQuery('/drill#top')).toBe('/drill');
		expect(stripQuery('/drill')).toBe('/drill');
	});
});

describe('scrubEvent', () => {
	it('removes tokens, cookies, IPs and identifying user fields', () => {
		const event = scrubEvent({
			type: undefined,
			request: {
				url: 'https://chessstack.app/api/auth/verify-email?token=secret',
				query_string: 'token=secret',
				cookies: { session: 'abc' },
				data: { password: 'hunter2' },
				headers: {
					Cookie: 'session=abc',
					Authorization: 'Bearer x',
					Referer: 'https://chessstack.app/reset-password?token=secret',
					'X-Forwarded-For': '1.2.3.4',
					'CF-Connecting-IP': '1.2.3.4',
					'User-Agent': 'Firefox'
				}
			},
			user: { id: 42, email: 'a@example.com', username: 'alice', ip_address: '1.2.3.4' },
			breadcrumbs: [
				{ category: 'navigation', data: { from: '/a?x=1', to: '/reset-password?token=s' } }
			]
		});

		expect(event.request).toEqual({
			url: 'https://chessstack.app/api/auth/verify-email',
			headers: { 'User-Agent': 'Firefox' }
		});
		expect(event.user).toEqual({ id: 42 });
		expect(event.breadcrumbs?.[0].data).toEqual({ from: '/a', to: '/reset-password' });
	});

	it('drops the user entirely when there is no id', () => {
		expect(scrubEvent({ type: undefined, user: { ip_address: '1.2.3.4' } }).user).toEqual({});
	});
});

describe('scrubBreadcrumb', () => {
	it('strips query strings from fetch URLs', () => {
		expect(
			scrubBreadcrumb({ category: 'fetch', data: { url: '/api/x?token=1', method: 'GET' } })
		).toEqual({
			category: 'fetch',
			data: { url: '/api/x', method: 'GET' }
		});
	});
});

describe('scrubSpan', () => {
	it('strips query strings and client details from span attributes', () => {
		const span = scrubSpan({
			trace_id: 't',
			span_id: 's',
			name: 'GET /reset-password?token=secret',
			start_timestamp: 0,
			status: 'ok',
			is_segment: true,
			attributes: {
				'url.full': 'https://chessstack.app/reset-password?token=secret',
				'url.query': 'token=secret',
				'http.target': '/reset-password?token=secret',
				'client.address': '1.2.3.4',
				'user.email': 'a@example.com',
				'user.id': 42,
				'http.route': '/reset-password'
			}
		});
		expect(span.name).toBe('GET /reset-password');
		expect(span.attributes).toEqual({
			'url.full': 'https://chessstack.app/reset-password',
			'http.target': '/reset-password',
			'user.id': 42,
			'http.route': '/reset-password'
		});
	});
});

describe('isChunkLoadError', () => {
	it('matches the chunk load errors of each browser', () => {
		expect(
			isChunkLoadError(
				new TypeError(
					'Failed to fetch dynamically imported module: https://chessstack.app/_app/immutable/nodes/14.Bb2Ba39P.js'
				)
			)
		).toBe(true);
		expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
		expect(
			isChunkLoadError(
				new TypeError('error loading dynamically imported module: https://chessstack.app/x.js')
			)
		).toBe(true);
	});

	it('ignores other errors', () => {
		expect(
			isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))
		).toBe(false);
		expect(isChunkLoadError(undefined)).toBe(false);
	});
});
