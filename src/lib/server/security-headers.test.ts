import { describe, expect, it } from 'vitest';
import { securityHeaders, withKitScriptSrc } from './security-headers';

const SENTRY = 'https://o1.ingest.us.sentry.io';

describe('securityHeaders', () => {
	it('chessstack.app: HTTPS upgrades, HSTS with subdomains, analytics and Sentry allowed', () => {
		const h = securityHeaders({
			origin: 'https://chessstack.app',
			isCloud: true,
			sentryConnectSrc: SENTRY
		});
		expect(h['Content-Security-Policy']).toContain('upgrade-insecure-requests');
		expect(h['Content-Security-Policy']).toContain(
			"script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com;"
		);
		expect(h['Content-Security-Policy']).toContain(
			`connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com ${SENTRY};`
		);
		expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains');
		// The opponent-prep parser runs as a blob: worker.
		expect(h['Content-Security-Policy']).toContain("worker-src 'self' blob:;");
	});

	it('self-hosted over plain HTTP: no upgrade-insecure-requests and no HSTS', () => {
		// upgrade-insecure-requests stops the app loading at e.g. http://192.168.1.10:3000.
		const h = securityHeaders({
			origin: 'http://192.168.1.10:3000',
			isCloud: false,
			sentryConnectSrc: null
		});
		expect(h['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
		expect(h['Content-Security-Policy']).not.toContain('cloudflareinsights');
		expect(h['Content-Security-Policy']).toContain("connect-src 'self';");
		expect(h['Strict-Transport-Security']).toBeUndefined();
	});

	it('self-hosted over HTTPS: HSTS without includeSubDomains', () => {
		const h = securityHeaders({
			origin: 'https://chess.home.example',
			isCloud: false,
			sentryConnectSrc: null
		});
		expect(h['Content-Security-Policy']).toContain('upgrade-insecure-requests');
		expect(h['Strict-Transport-Security']).toBe('max-age=63072000');
	});

	it('forbids framing in both headers that control it', () => {
		const h = securityHeaders({
			origin: 'https://x.example',
			isCloud: true,
			sentryConnectSrc: null
		});
		expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
		expect(h['X-Frame-Options']).toBe('DENY');
	});
});

describe('withKitScriptSrc', () => {
	const ours = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; frame-ancestors 'none'";

	it("adds SvelteKit's page nonce to our script-src and keeps the rest", () => {
		expect(withKitScriptSrc(ours, "script-src 'self' 'nonce-abc123'")).toBe(
			"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'nonce-abc123'; frame-ancestors 'none'"
		);
	});

	it('leaves the policy alone without a SvelteKit header or nonce', () => {
		expect(withKitScriptSrc(ours, null)).toBe(ours);
		expect(withKitScriptSrc(ours, "script-src 'self'")).toBe(ours);
	});

	it('never allows inline scripts', () => {
		const h = securityHeaders({
			origin: 'https://x.example',
			isCloud: true,
			sentryConnectSrc: null
		});
		expect(h['Content-Security-Policy']).not.toMatch(/script-src[^;]*'unsafe-inline'/);
	});
});
