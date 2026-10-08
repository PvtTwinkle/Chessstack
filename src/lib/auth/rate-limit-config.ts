// Centralized rate limit configuration for expensive API endpoints.
// All limits are per-user, based on a 5-minute sliding window.
// Override any default with the corresponding environment variable.

const FIVE_MINUTES = 5 * 60 * 1000;

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const parsed = parseInt(raw, 10);
	return isNaN(parsed) ? fallback : parsed;
}

export const RATE_LIMITS = {
	book: {
		prefix: 'book',
		max: envInt('RATE_LIMIT_BOOK', 120),
		windowMs: FIVE_MINUTES
	},
	importFetch: {
		prefix: 'import-fetch',
		max: envInt('RATE_LIMIT_IMPORT_FETCH', 10),
		windowMs: FIVE_MINUTES
	},
	importAnalyze: {
		prefix: 'import-analyze',
		max: envInt('RATE_LIMIT_IMPORT_ANALYZE', 30),
		windowMs: FIVE_MINUTES
	},
	gaps: {
		prefix: 'gaps',
		max: envInt('RATE_LIMIT_GAPS', 30),
		windowMs: FIVE_MINUTES
	},
	masters: {
		prefix: 'masters',
		max: envInt('RATE_LIMIT_MASTERS', 120),
		windowMs: FIVE_MINUTES
	},
	eco: {
		prefix: 'eco',
		max: envInt('RATE_LIMIT_ECO', 120),
		windowMs: FIVE_MINUTES
	},
	puzzlesNext: {
		prefix: 'puzzles-next',
		max: envInt('RATE_LIMIT_PUZZLES_NEXT', 60),
		windowMs: FIVE_MINUTES
	}
};

// Registrations per client IP per hour. Kept low in production to slow down
// sign-up abuse; the end-to-end tests raise it because every test registers
// its own account from the same IP.
export const REGISTER_RATE_LIMIT = {
	prefix: 'register',
	max: envInt('RATE_LIMIT_REGISTER', 20),
	windowMs: 60 * 60 * 1000
};
