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
	},
	// The Players and Stars tabs query as often as Masters does.
	players: {
		prefix: 'players',
		max: envInt('RATE_LIMIT_PLAYERS', 120),
		windowMs: FIVE_MINUTES
	},
	stars: {
		prefix: 'stars',
		max: envInt('RATE_LIMIT_STARS', 120),
		windowMs: FIVE_MINUTES
	},
	// One request per computer move in Train.
	computerMove: {
		prefix: 'computer-move',
		max: envInt('RATE_LIMIT_COMPUTER_MOVE', 300),
		windowMs: FIVE_MINUTES
	},
	// Each call parses up to 1 MB of PGN.
	importParse: {
		prefix: 'import-parse',
		max: envInt('RATE_LIMIT_IMPORT_PARSE', 30),
		windowMs: FIVE_MINUTES
	},
	// Prep fetches download an opponent's games from Lichess or Chess.com.
	prepFetch: {
		prefix: 'prep-fetch',
		max: envInt('RATE_LIMIT_PREP_FETCH', 30),
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

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Sign-in attempts per client IP and, separately, per username
// (see $lib/auth/login-rate-limit).
export const LOGIN_RATE_LIMIT = {
	prefix: 'login',
	max: 30,
	windowMs: FIFTEEN_MINUTES
};
export const LOGIN_ACCOUNT_RATE_LIMIT = {
	prefix: 'login-account',
	max: 10,
	windowMs: FIFTEEN_MINUTES
};

// Current-password confirmations per signed-in user (changing the password or
// email, deleting the account), so a stolen session can't guess the password.
export const PASSWORD_CHECK_RATE_LIMIT = {
	prefix: 'password-check',
	max: 10,
	windowMs: FIFTEEN_MINUTES
};
