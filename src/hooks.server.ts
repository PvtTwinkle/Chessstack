// SvelteKit server hooks — middleware that runs on every request.
//
// The `handle` function here is the gatekeeper for the entire app.
// It runs before any page or API route does, giving us a single place
// to enforce authentication across every route.
//
// What it does on each request:
//   1. Sets locals.user to null (unauthenticated by default)
//   2. Reads the session cookie from the browser
//   3. If a valid session cookie exists, looks it up in the database
//   4. If the session is valid, attaches the user to locals.user
//   5. If the user is not authenticated and the route requires auth, redirects to /
//      (/login on self-hosted instances; URLs that match no route get a 404 instead)
//   6. If the user IS authenticated and is trying to visit /login or /landing, redirects to /

// Must stay the first import: it initialises Sentry before the modules below
// (the database module runs migrations as soon as it is imported).
import '$lib/server/sentry';
import * as Sentry from '@sentry/sveltekit';
import { error, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import {
	validateSession,
	deleteSession,
	cleanExpiredSessions,
	SESSION_COOKIE_NAME,
	SECURE_COOKIE
} from '$lib/auth';
import { db, dbReady } from '$lib/db';
import { user, userSettings, subscription } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { startImportScheduler } from '$lib/server/import-scheduler';
import { isEmailVerificationEnabled } from '$lib/loops';
import { log, runWithRequestContext, serializeError } from '$lib/server/log';
import { sentryIngestOrigin } from '$lib/sentry';
import { CLOUD_ONLY_ROUTES, IS_CLOUD, isCloudOnlyRoute } from '$lib/server/edition';

// How often to sweep the sessions table for expired rows (6 hours).
const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Who can register: 'open' = anyone, 'invite' = admin only (default).
const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';

// Routes that anyone can access without being logged in.
// Everything not on this list requires a valid session.
const PUBLIC_ROUTES = [
	// The marketing site: the landing page at / (also the dashboard when logged
	// in), /landing (legacy URL, redirects to /), the blog, the opening guides,
	// the sitemap, llms.txt and the legal pages. Cloud only.
	...(IS_CLOUD ? ['/', ...CLOUD_ONLY_ROUTES] : []),
	'/login', // the login form itself
	'/engine', // in-browser Stockfish files; the worker's requests mustn't depend on the session cookie
	'/api/health', // monitoring endpoint — must be publicly accessible
	'/api/billing/webhook', // Stripe webhook — authenticated via signature, not session
	'/api/auth/verify-email', // email verification link — token is the auth
	'/forgot-password', // password reset request form
	'/reset-password', // password reset form — token is the auth
	...(REGISTRATION_MODE === 'open' ? ['/register'] : [])
];

// Ensure the database is fully initialised (migrations + default user)
// before we handle any requests. This awaits the promise exported from db/index.ts.
await dbReady;

// Start the background import scheduler (no-op if GAME_IMPORT_INTERVAL_MINUTES=0).
startImportScheduler();

// Periodically clean expired sessions (every 6 hours).
setInterval(async () => {
	try {
		const count = await cleanExpiredSessions();
		if (count > 0) {
			log.info('Cleaned expired sessions', { count });
		}
	} catch (e) {
		log.error('Session cleanup error', { err: e });
	}
}, SESSION_CLEANUP_INTERVAL_MS);

// Tell the user the actual URL to visit (ORIGIN), not the raw 0.0.0.0 bind address.
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';
log.info(`Ready at ${ORIGIN}`);

// Login/registration/password-reset rate limits are keyed on the client IP.
// Behind a reverse proxy (Railway, Cloudflare, Nginx…) adapter-node only sees
// the proxy's address unless ADDRESS_HEADER (and XFF_DEPTH for
// X-Forwarded-For) are set — every visitor would then share one rate-limit
// bucket and a handful of failed logins would lock everyone out.
if (ORIGIN.startsWith('https://') && !process.env.ADDRESS_HEADER) {
	log.warn(
		'ORIGIN is https but ADDRESS_HEADER is not set. If this app runs ' +
			'behind a reverse proxy, all clients will share one IP-based rate-limit bucket. ' +
			'Set ADDRESS_HEADER (e.g. X-Forwarded-For with XFF_DEPTH) — see .env.example.'
	);
}

// CORS — allowed origins for cross-origin API requests (e.g. mobile app, external client).
// Comma-separated list. Empty or unset = same-origin only (no CORS header emitted).
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// Browser error reports go straight to Sentry's ingest host, so the CSP has to
// allow it. Only added when PUBLIC_SENTRY_DSN is set.
// 'wasm-unsafe-eval' and worker-src let the in-browser Stockfish ($lib/engine)
// compile its WebAssembly and start its worker threads.
// Cloudflare Web Analytics is injected by Cloudflare's proxy in front of
// chessstack.app, so only the cloud edition allows its hosts.
const SENTRY_CONNECT_SRC = sentryIngestOrigin(process.env.PUBLIC_SENTRY_DSN);
const ANALYTICS_SCRIPT_SRC = IS_CLOUD ? ' https://static.cloudflareinsights.com' : '';
const ANALYTICS_CONNECT_SRC = IS_CLOUD
	? ' https://cloudflareinsights.com https://static.cloudflareinsights.com'
	: '';
const CONTENT_SECURITY_POLICY =
	`default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${ANALYTICS_SCRIPT_SRC}; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ` +
	`connect-src 'self'${ANALYTICS_CONNECT_SRC}${SENTRY_CONNECT_SRC ? ' ' + SENTRY_CONNECT_SRC : ''}; ` +
	"frame-ancestors 'none'; upgrade-insecure-requests";

// Paths left out of the request log: the health check is polled every 30s.
const UNLOGGED_PATHS = new Set(['/api/health']);

// Gives every request an id, logs one line per request, and makes the id
// available to all logs written while handling it (see $lib/server/log).
// The id is returned in the X-Request-Id header and shown on the error page,
// so a user's bug report can be matched to the logs and the Sentry event.
const requestContext: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID();
	event.locals.requestId = requestId;
	Sentry.setTag('request_id', requestId);

	const start = performance.now();
	const logRequest = (status: number) => {
		if (UNLOGGED_PATHS.has(event.url.pathname)) return;
		// Path only: query strings can carry tokens (password reset, email verification).
		log.info('request', {
			method: event.request.method,
			path: event.url.pathname,
			route: event.route.id,
			status,
			durationMs: Math.round(performance.now() - start),
			userId: event.locals.user?.id
		});
	};

	return runWithRequestContext(requestId, async () => {
		try {
			const response = await resolve(event);
			response.headers.set('X-Request-Id', requestId);
			logRequest(response.status);
			return response;
		} catch (e) {
			// redirect() and error() thrown from the auth hook below end up here.
			logRequest(isRedirect(e) || isHttpError(e) ? e.status : 500);
			throw e;
		}
	});
};

const authenticate: Handle = async ({ event, resolve }) => {
	// ── CORS preflight ──────────────────────────────────────────────────────
	// Handle OPTIONS requests for API routes when CORS_ORIGINS is configured.
	const requestOrigin = event.request.headers.get('origin');
	const isAllowedOrigin = requestOrigin && CORS_ORIGINS.includes(requestOrigin);

	if (
		event.request.method === 'OPTIONS' &&
		isAllowedOrigin &&
		event.url.pathname.startsWith('/api/')
	) {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': requestOrigin,
				'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Max-Age': '86400'
			}
		});
	}

	// Start every request as unauthenticated. We will upgrade this below
	// if we find a valid session cookie.
	event.locals.user = null;

	// Read the session cookie. This is the random UUID token we set at login.
	const token = event.cookies.get(SESSION_COOKIE_NAME);

	if (token) {
		// Look up the token in the session table.
		const sessionData = await validateSession(token);

		if (sessionData) {
			// Session is valid — fetch the user record so we have the username and role.
			const [foundUser] = await db
				.select({
					id: user.id,
					username: user.username,
					role: user.role,
					enabled: user.enabled,
					email: user.email,
					emailVerified: user.emailVerified
				})
				.from(user)
				.where(eq(user.id, sessionData.userId));

			if (foundUser) {
				if (!foundUser.enabled) {
					// Account has been disabled by an admin — immediately invalidate the session.
					await deleteSession(token);
					event.cookies.delete(SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE });
				} else {
					// Look up the user's subscription tier. Default to 'free' if no row exists.
					// An active gift (giftExpiry in the future) forces paid access regardless of Stripe.
					const [sub] = await db
						.select({ tier: subscription.tier, giftExpiry: subscription.giftExpiry })
						.from(subscription)
						.where(eq(subscription.userId, foundUser.id));

					// Self-hosted instances have no plans: everyone gets the paid limits.
					const giftActive = sub?.giftExpiry != null && sub.giftExpiry > new Date();
					const effectiveTier: 'free' | 'paid' =
						!IS_CLOUD || giftActive || sub?.tier === 'paid' ? 'paid' : 'free';

					// Only the numeric id goes to Sentry, never the email or username.
					Sentry.setUser({ id: foundUser.id });

					event.locals.user = {
						id: foundUser.id,
						username: foundUser.username,
						role: foundUser.role,
						tier: effectiveTier,
						email: foundUser.email ?? null,
						emailVerified: foundUser.emailVerified
					};
				}
			}
		} else {
			// The token exists in the browser but is not valid (expired or deleted).
			// Clear the stale cookie so the browser stops sending it on every request.
			event.cookies.delete(SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE });
		}
	}

	const { pathname } = event.url;

	if (!IS_CLOUD && isCloudOnlyRoute(pathname)) {
		error(404, 'Not Found');
	}

	// Check if this route is public (no auth required).
	// The startsWith check handles sub-paths, e.g. /api/health/details.
	const isPublicRoute = PUBLIC_ROUTES.some(
		(route) => pathname === route || pathname.startsWith(route + '/')
	);

	// SvelteKit has already matched the URL to a route at this point; route.id is
	// null when nothing matched.
	const routeExists = event.route.id !== null;

	// Unauthenticated user trying to access a protected route → send to the
	// landing page (the login form on self-hosted instances).
	// Unknown URLs are left alone so SvelteKit answers 404: redirecting them to /
	// made every mistyped or removed URL a "soft 404" that search engines treat
	// as a copy of the home page (and made /llms.txt return the landing page).
	if (!event.locals.user && !isPublicRoute && routeExists) {
		redirect(302, IS_CLOUD ? '/' : '/login');
	}

	// Authenticated user trying to visit /login, /register, or /landing → send to dashboard.
	if (
		event.locals.user &&
		(pathname === '/login' || pathname === '/register' || pathname === '/landing')
	) {
		redirect(302, '/');
	}

	// Admin-only routes — non-admins get redirected to the dashboard.
	if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
		if (!event.locals.user || event.locals.user.role !== 'admin') {
			redirect(302, '/');
		}
	}

	// Email verification gate — logged-in users with unverified email are
	// confined to /verify-email and the verification/logout API routes.
	// Skipped entirely when Loops is not configured (graceful degradation), and
	// for accounts without an email (self-hosted sign-ups may leave it out).
	if (
		event.locals.user &&
		isEmailVerificationEnabled() &&
		event.locals.user.email !== null &&
		!event.locals.user.emailVerified &&
		!pathname.startsWith('/verify-email') &&
		!pathname.startsWith('/api/auth/verify-email') &&
		!pathname.startsWith('/api/auth/resend-verification') &&
		!pathname.startsWith('/api/auth/logout') &&
		!pathname.startsWith('/api/health')
	) {
		redirect(302, '/verify-email');
	}

	// Look up the user's preferred app theme so we can inject it into the HTML
	// during SSR. This prevents a flash of the wrong theme on page load.
	// Skipped for API requests — they don't render HTML and don't need the theme.
	let appTheme = 'dark';
	if (event.locals.user && !pathname.startsWith('/api/')) {
		const [settings] = await db
			.select({ appTheme: userSettings.appTheme })
			.from(userSettings)
			.where(eq(userSettings.userId, event.locals.user.id));
		// Only known themes reach the HTML attribute below — the settings API already
		// validates on write, this guards against any bad value already in the DB.
		if (settings?.appTheme === 'light' || settings?.appTheme === 'dark') {
			appTheme = settings.appTheme;
		}
	}

	// All checks passed — continue to the actual page or API handler.
	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('<html lang="en">', `<html lang="en" data-theme="${appTheme}">`)
	});

	// Security headers — defence-in-depth for a cloud deployment.
	response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
	// Cross-origin isolation, which the multi-threaded Stockfish build needs
	// (SharedArrayBuffer). It has to be on every page, not just the analysis
	// ones, because client-side navigation keeps the first page's headers.
	// "credentialless" still lets third-party scripts such as Cloudflare's
	// analytics load (without cookies); browsers that don't support it fall
	// back to the single-threaded engine.
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');

	// CORS response headers for API routes when the request origin is allowed.
	if (isAllowedOrigin && event.url.pathname.startsWith('/api/')) {
		response.headers.set('Access-Control-Allow-Origin', requestOrigin!);
		response.headers.set('Access-Control-Allow-Credentials', 'true');
	}

	return response;
};

// sentryHandle reports the request to Sentry (a no-op without SENTRY_DSN);
// it runs first so errors anywhere in the chain are attributed to the request.
export const handle = sequence(Sentry.sentryHandle(), requestContext, authenticate);

// Log unexpected server errors (500s) as one JSON line, tagged with the
// request id, and report them to Sentry. Only the message and stack are
// logged — never the full error object, which may contain sensitive data
// (query params, headers, request bodies).
//
// The returned object becomes `page.error`: the request id is shown on the
// error page so a user can quote it.
export const handleError: HandleServerError = Sentry.handleErrorWithSentry(
	async ({ error, event, status, message }) => {
		// Unknown URLs are routine (crawlers, bots probing for /wp-login.php…), not errors.
		if (status === 404) return;

		log.error('Unhandled error', {
			method: event.request.method,
			// Path only, to avoid leaking sensitive query params.
			path: event.url.pathname,
			route: event.route.id,
			status,
			// Serialised here rather than passed as an Error: handleErrorWithSentry
			// has already reported it, and log.error would report it again.
			err: serializeError(error)
		});

		return { message, requestId: event.locals.requestId };
	}
);
