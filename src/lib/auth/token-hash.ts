// Hashing for single-use emailed tokens (email verification, password reset).
//
// These tokens are 32 random bytes (256 bits of entropy), so a slow password
// hash like bcrypt adds no security — nobody can brute-force a 256-bit value.
// A deterministic SHA-256 hash lets us look the token up with a single indexed
// equality query instead of bcrypt-comparing against every outstanding token,
// which was an unauthenticated CPU-exhaustion vector.

import crypto from 'crypto';

export function hashToken(rawToken: string): string {
	return crypto.createHash('sha256').update(rawToken).digest('hex');
}
