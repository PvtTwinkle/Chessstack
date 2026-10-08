// Request bodies for /api/repertoires routes.

import { z } from 'zod';
import { fen, id } from './common';

const name = z.string().trim().min(1, { error: 'name must be a non-empty string' });

/** POST /api/repertoires */
export const createRepertoireSchema = z.object({
	name,
	color: z.enum(['WHITE', 'BLACK'])
});

/** PATCH /api/repertoires/[id]. startFen null resets to the standard start position. */
export const updateRepertoireSchema = z
	.object({
		name: name.optional(),
		startFen: fen.nullable().optional()
	})
	.refine((body) => body.name !== undefined || body.startFen !== undefined, {
		error: 'At least one field (name, startFen) is required'
	});

/** POST /api/repertoires/active */
export const setActiveRepertoireSchema = z.object({ id });
