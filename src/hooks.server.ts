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
import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import {
	validateSession,
	setSessionCookie,
	deleteSession,
	cleanExpiredSessions,
	cleanExpiredTokens,
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
import { securityHeaders, withKitScriptSrc } from '$lib/server/security-headers';
import { CLOUD_ONLY_ROUTES, IS_CLOUD, isCloudOnlyRoute } from '$lib/server/edition';
import { effectiveTier } from '$lib/stripe/tiers';
import { pruneRateLimits } from '$lib/auth/rate-limit';
import { ORIGIN } from '$lib/server/origin';

// How often to sweep expired sessions, tokens and rate-limit counters (6 hours).
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Who can register: 'open' = anyone, 'invite' = admin only (default).
const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';

// Routes that anyone can access without being logged in.
// Everything not on this list requires a valid session.
const PUBLIC_ROUTES = [
	// The marketing site: the landing page at / (also the dashboard when logged
	// in), /landing (legacy URL, redirects to /), the blog, the opening guides,
	// the feature pages, the sitemap, llms.txt and the legal pages. Cloud only.
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

// Periodically delete rows nothing will read again, so these tables don't grow
// without bound.
setInterval(async () => {
	try {
		const sessions = await cleanExpiredSessions();
		const tokens = await cleanExpiredTokens();
		const rateLimits = await pruneRateLimits();
		if (sessions + tokens + rateLimits > 0) {
			log.info('Cleaned expired rows', { sessions, tokens, rateLimits });
		}
	} catch (e) {
		log.error('Expired row cleanup error', { err: e });
	}
}, CLEANUP_INTERVAL_MS);

// Tell the user the actual URL to visit (ORIGIN), not the raw 0.0.0.0 bind address.
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

// NOINDEX=true asks search engines not to index anything (staging copies).
const NOINDEX = process.env.NOINDEX === 'true';

// Same for every response; see $lib/server/security-headers.
const SECURITY_HEADERS = Object.entries(
	securityHeaders({
		origin: ORIGIN,
		isCloud: IS_CLOUD,
		sentryConnectSrc: sentryIngestOrigin(process.env.PUBLIC_SENTRY_DSN)
	})
);

// Paths left out of the request log: monitors poll the health checks.
const UNLOGGED_PATHS = new Set(['/api/health', '/api/health/ready']);

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
			// error() thrown from the auth hook below (cloud-only routes on a
			// self-hosted instance) ends up here.
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

	// Read the session cookie: the random token we set at login.
	const token = event.cookies.get(SESSION_COOKIE_NAME);

	// The user's preferred app theme, injected into the HTML during SSR so the
	// page doesn't flash the wrong theme on load.
	let appTheme = 'dark';

	if (token) {
		// Look up the token in the session table.
		const sessionData = await validateSession(token);

		if (sessionData) {
			// Session is valid: fetch the user with their subscription and theme in
			// one round trip.
			const [foundUser] = await db
				.select({
					id: user.id,
					username: user.username,
					role: user.role,
					enabled: user.enabled,
					email: user.email,
					emailVerified: user.emailVerified,
					tier: subscription.tier,
					giftExpiry: subscription.giftExpiry,
					appTheme: userSettings.appTheme
				})
				.from(user)
				.leftJoin(subscription, eq(subscription.userId, user.id))
				.leftJoin(userSettings, eq(userSettings.userId, user.id))
				.where(eq(user.id, sessionData.userId));

			if (foundUser) {
				if (!foundUser.enabled) {
					// Account has been disabled by an admin — immediately invalidate the session.
					await deleteSession(token);
					event.cookies.delete(SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE });
				} else {
					// No subscription row means free. An active gift (giftExpiry in the
					// future) grants paid access on top of Stripe. Self-hosted instances
					// have no plans: everyone gets the paid limits.
					const sub = foundUser.tier
						? { tier: foundUser.tier, giftExpiry: foundUser.giftExpiry }
						: null;
					const tier = IS_CLOUD ? effectiveTier(sub) : 'paid';

					// Only known themes reach the HTML attribute below — the settings API
					// already validates on write, this guards against a bad stored value.
					if (foundUser.appTheme === 'light' || foundUser.appTheme === 'dark') {
						appTheme = foundUser.appTheme;
					}

					// Keep the cookie alive as long as the session it carries.
					if (sessionData.renewed) setSessionCookie(event.cookies, token);

					// Only the numeric id goes to Sentry, never the email or username.
					Sentry.setUser({ id: foundUser.id });

					event.locals.user = {
						id: foundUser.id,
						username: foundUser.username,
						role: foundUser.role,
						tier,
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

	const isApi = pathname.startsWith('/api/');

	// Unauthenticated user trying to access a protected route → send to the
	// landing page (the login form on self-hosted instances). API calls get a
	// JSON 401 instead: a fetch() would follow the redirect and try to parse
	// the landing page as JSON.
	// Unknown URLs are left alone so SvelteKit answers 404: redirecting them to /
	// made every mistyped or removed URL a "soft 404" that search engines treat
	// as a copy of the home page (and made /llms.txt return the landing page).
	if (!event.locals.user && !isPublicRoute && routeExists) {
		if (isApi) return secured(jsonError(401, 'Not authenticated'));
		return secured(redirectTo(IS_CLOUD ? '/' : '/login'));
	}

	// Authenticated user trying to visit /login, /register, or /landing → send to dashboard.
	if (
		event.locals.user &&
		(pathname === '/login' || pathname === '/register' || pathname === '/landing')
	) {
		return secured(redirectTo('/'));
	}

	// Admin-only routes — non-admins get redirected to the dashboard (403 for the API).
	if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
		if (!event.locals.user || event.locals.user.role !== 'admin') {
			if (isApi) {
				return secured(
					event.locals.user ? jsonError(403, 'Admin only') : jsonError(401, 'Not authenticated')
				);
			}
			return secured(redirectTo('/'));
		}
	}

	// Email verification gate — logged-in users with unverified email are
	// confined to /verify-email and the verification/logout API routes, plus
	// the email endpoint so a mistyped address can be corrected.
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
		!pathname.startsWith('/api/account/email') &&
		!pathname.startsWith('/api/health')
	) {
		if (isApi) return secured(jsonError(403, 'Verify your email address first'));
		return secured(redirectTo('/verify-email'));
	}

	// All checks passed — continue to the actual page or API handler.
	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('<html lang="en">', `<html lang="en" data-theme="${appTheme}">`)
	});

	const secure = secured(response);

	// CORS response headers for API routes when the request origin is allowed.
	if (isAllowedOrigin && isApi) {
		secure.headers.set('Access-Control-Allow-Origin', requestOrigin!);
		secure.headers.set('Access-Control-Allow-Credentials', 'true');
	}

	return secure;
};

// The auth hook's own redirects and refusals are returned rather than thrown,
// so they go out with the security headers too (a thrown redirect skips them).
function redirectTo(location: string): Response {
	return new Response(null, { status: 302, headers: { location } });
}

function jsonError(status: number, message: string): Response {
	return json({ message }, { status });
}

/** Adds the security headers (and the staging noindex) to a response. */
function secured(response: Response): Response {
	// SvelteKit's own CSP header carries the nonce for its inline scripts on
	// pages; merge it into ours rather than overwrite it (see security-headers).
	const kitCsp = response.headers.get('Content-Security-Policy');
	for (const [name, value] of SECURITY_HEADERS) {
		response.headers.set(
			name,
			name === 'Content-Security-Policy' ? withKitScriptSrc(value, kitCsp) : value
		);
	}

	// A staging copy serves the same public pages as the live site; keep it out
	// of search results so it never competes with the live site.
	if (NOINDEX) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	return response;
}

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
