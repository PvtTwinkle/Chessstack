// Recognises Postgres errors that answer a request rather than break it.

/**
 * True for a unique-constraint violation (SQLSTATE 23505), the error two
 * concurrent requests get when both passed a "does it exist yet?" check.
 * Optionally narrowed to one constraint or index name.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
	if (typeof err !== 'object' || err === null) return false;
	// Drizzle wraps the driver's error in `cause`.
	const pgError = 'cause' in err && typeof err.cause === 'object' && err.cause ? err.cause : err;
	if (!('code' in pgError) || pgError.code !== '23505') return false;
	if (constraint === undefined) return true;
	return 'constraint_name' in pgError && pgError.constraint_name === constraint;
}
