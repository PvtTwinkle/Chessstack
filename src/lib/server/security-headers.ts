// Security headers sent with every response (see hooks.server.ts).
//
// Pure so it can be unit-tested: what a self-hosted instance served over plain
// HTTP gets differs from what chessstack.app gets, and getting that wrong
// breaks the app (see upgrade-insecure-requests below).

interface SecurityHeaderOptions {
	/** The ORIGIN the instance is served from, e.g. https://chessstack.app. */
	origin: string;
	isCloud: boolean;
	/** Sentry's ingest origin when browser error reporting is on, else null. */
	sentryConnectSrc: string | null;
}

export function securityHeaders({
	origin,
	isCloud,
	sentryConnectSrc
}: SecurityHeaderOptions): Record<string, string> {
	const https = origin.startsWith('https://');

	// No 'unsafe-inline' for scripts: SvelteKit puts a per-request nonce on its
	// own inline scripts (kit.csp in svelte.config.js) and withKitScriptSrc
	// copies that nonce into this policy, so an injected script can't run.
	// 'wasm-unsafe-eval' and worker-src let the in-browser Stockfish ($lib/engine)
	// compile its WebAssembly and start its worker threads; blob: is for the
	// opponent-prep PGN parser, an inlined worker ($lib/prep/pipeline.ts).
	// Cloudflare Web Analytics is injected by Cloudflare's proxy in front of
	// chessstack.app, so only the cloud edition allows its hosts.
	// Browser error reports go straight to Sentry's ingest host.
	const analyticsScriptSrc = isCloud ? ' https://static.cloudflareinsights.com' : '';
	const analyticsConnectSrc = isCloud
		? ' https://cloudflareinsights.com https://static.cloudflareinsights.com'
		: '';
	const csp = [
		`default-src 'self'`,
		`script-src 'self' 'wasm-unsafe-eval'${analyticsScriptSrc}`,
		`worker-src 'self' blob:`,
		`style-src 'self' 'unsafe-inline'`,
		`img-src 'self' data:`,
		`font-src 'self'`,
		`connect-src 'self'${analyticsConnectSrc}${sentryConnectSrc ? ' ' + sentryConnectSrc : ''}`,
		`frame-ancestors 'none'`,
		// Only over HTTPS: on a plain-HTTP origin other than localhost (a
		// self-hosted instance at http://192.168.1.10:3000) browsers rewrite the
		// app's own script and form URLs to https://, so it never loads.
		...(https ? ['upgrade-insecure-requests'] : [])
	].join('; ');

	const headers: Record<string, string> = {
		'Content-Security-Policy': csp,
		'X-Frame-Options': 'DENY',
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
		// Cross-origin isolation, which the multi-threaded Stockfish build needs
		// (SharedArrayBuffer). It has to be on every page, not just the analysis
		// ones, because client-side navigation keeps the first page's headers.
		// "credentialless" still lets third-party scripts such as Cloudflare's
		// analytics load (without cookies); browsers that don't support it fall
		// back to the single-threaded engine.
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'credentialless'
	};

	// Browsers ignore HSTS over plain HTTP. includeSubDomains only on
	// chessstack.app: a self-hoster at chess.home.example would otherwise force
	// HTTPS on every other host under home.example for two years.
	if (https) {
		headers['Strict-Transport-Security'] =
			`max-age=63072000${isCloud ? '; includeSubDomains' : ''}`;
	}

	return headers;
}

/**
 * Adds the nonce or hash sources from SvelteKit's own CSP header (set on
 * server-rendered pages, see kit.csp) to our policy's script-src. Without a
 * SvelteKit header (API responses, assets) our policy is returned as is.
 */
export function withKitScriptSrc(ourCsp: string, kitCsp: string | null): string {
	if (!kitCsp) return ourCsp;
	const kitScriptSrc = kitCsp
		.split(';')
		.map((d) => d.trim())
		.find((d) => d.startsWith('script-src '));
	const sources = (kitScriptSrc ?? '')
		.split(/\s+/)
		.filter((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
	if (sources.length === 0) return ourCsp;
	return ourCsp
		.split('; ')
		.map((d) => (d.startsWith('script-src ') ? `${d} ${sources.join(' ')}` : d))
		.join('; ');
}
