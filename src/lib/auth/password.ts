// Shared password-strength validation.
//
// Single source of truth for password requirements — used by both
// server-side API routes and client-side Svelte components.

const MIN_LENGTH = 12;

/**
 * Validate a password against the strength requirements.
 * Returns an error message string if invalid, or `null` if the password is acceptable.
 */
export function validatePassword(password: string): string | null {
	if (password.length < MIN_LENGTH) {
		return `Password must be at least ${MIN_LENGTH} characters.`;
	}
	if (!/[a-z]/.test(password)) {
		return 'Password must include at least one lowercase letter.';
	}
	if (!/[A-Z]/.test(password)) {
		return 'Password must include at least one uppercase letter.';
	}
	if (!/[0-9]/.test(password)) {
		return 'Password must include at least one number.';
	}
	if (!/[^a-zA-Z0-9]/.test(password)) {
		return 'Password must include at least one special character.';
	}
	return null;
}

/** Human-readable summary of the requirements, for hint text. */
export const PASSWORD_HINT =
	'At least 12 characters with uppercase, lowercase, number, and special character.';
