// Usernames are unique ignoring case: "Kevin" and "kevin" would be
// indistinguishable in the header and in admin search. The database only
// enforces exact uniqueness, so every check for a taken username goes
// through this condition.

import { sql, type SQL } from 'drizzle-orm';
import { user } from '$lib/db/schema';

/** WHERE condition matching a username regardless of case. */
export function usernameMatches(username: string): SQL {
	return sql`lower(${user.username}) = lower(${username})`;
}
