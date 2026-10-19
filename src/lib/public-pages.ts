// Public pages (landing, opening guides, blog, legal and feature pages) lay
// out their own landmarks: the public header, a <main>, then the public
// footer. The root layout must not wrap them in its own <main>, or the header
// and footer would lose their banner and contentinfo roles and the page would
// end up with two mains.
//
// Most of these routes are cloud-only and missing from the self-hosted
// edition; listing an absent route is harmless.

const PUBLIC_PAGE_ROUTES = new Set([
	'/blog',
	'/blog/[slug]',
	'/terms',
	'/privacy',
	'/openings',
	'/openings/[family]',
	'/openings/[family]/[variation]',
	'/chess-opening-trainer',
	'/chess-repertoire-builder'
]);

/** Whether the page at this route renders its own <main>, header and footer. */
export function pageOwnsLandmarks(routeId: string | null, signedIn: boolean): boolean {
	if (routeId === null) return false;
	// The home route is the landing page for visitors and the dashboard for users.
	if (routeId === '/') return !signedIn;
	return PUBLIC_PAGE_ROUTES.has(routeId);
}
