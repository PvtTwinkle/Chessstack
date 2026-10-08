// Site-wide constants for search engines and social previews.
//
// Canonical URLs, Open Graph tags, structured data and the sitemap all build
// absolute URLs from SITE_URL, so search engines see one host (https, no www)
// whichever address a visitor or crawler arrived on.

export const SITE_URL = 'https://chessstack.app';
export const SITE_NAME = 'Chessstack';

export interface SocialImage {
	/** Root-relative path (e.g. /og-image.png) or an absolute URL. */
	src: string;
	width: number;
	height: number;
	alt: string;
}

/**
 * Default image for link previews (static/og-image.png). 1200×630 is the
 * 1.91:1 size Facebook, LinkedIn and X use for large previews.
 */
export const DEFAULT_SOCIAL_IMAGE: SocialImage = {
	src: '/og-image.png',
	width: 1200,
	height: 630,
	alt: 'Chessstack: chess opening repertoire builder and trainer'
};

/** Square logo for Organization structured data (Google requires at least 112×112). */
export const LOGO_IMAGE = { src: '/logo.png', width: 512, height: 512 };

// Google shows roughly 60 characters of a title before truncating it.
export const MAX_TITLE_LENGTH = 60;
export const TITLE_SUFFIX = ` | ${SITE_NAME}`;

/** Turns a root-relative path into an absolute URL on SITE_URL. Absolute URLs pass through. */
export function absoluteUrl(pathOrUrl: string): string {
	if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
	return SITE_URL + (pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`);
}

/**
 * Appends " | Chessstack" to a page title when the result still fits in a
 * search result. Longer titles are returned unchanged so the words people
 * searched for are not cut off.
 */
export function pageTitle(title: string): string {
	const withSuffix = title + TITLE_SUFFIX;
	return withSuffix.length <= MAX_TITLE_LENGTH ? withSuffix : title;
}
