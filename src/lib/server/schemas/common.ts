// Building blocks shared by the per-route request schemas.

import { z } from 'zod';
import { FEN_MAX_LENGTH } from '$lib/validation-limits';

/** A database row id sent in a JSON body. */
export const id = z.number().int();

/** A FEN string as sent by the client (normalise it with fenKey before storing). */
export const fen = z.string().trim().min(1).max(FEN_MAX_LENGTH);

/**
 * A number rounded to the nearest integer and clamped to [min, max].
 * Settings clamp rather than reject so a slider or stale client value still saves.
 */
export function clampedInt(min: number, max: number) {
	return z.number().transform((v) => Math.max(min, Math.min(max, Math.round(v))));
}
