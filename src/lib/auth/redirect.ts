// Validates a post-login destination taken from the query string.
//
// Only same-site paths are allowed, so a crafted link such as
// /login?redirectTo=https://evil.example cannot bounce a user who just signed
// in to another site (an "open redirect").

export function safeRedirectPath(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
	// Must be a root-relative path. "//host" and "/\host" are protocol-relative
	// URLs to browsers, so they are rejected too.
	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
	// Control characters (tabs, newlines) are stripped by browsers when parsing
	// URLs, which can turn "/\t/host" into "//host".
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(value)) return null;
	return value;
}

/**
 * Cookie holding where to send a new user once they verify their email: the
 * redirectTo they registered with, which would otherwise be lost while they
 * go and find the verification email.
 */
export const POST_VERIFY_REDIRECT_COOKIE = 'post_verify_redirect';
