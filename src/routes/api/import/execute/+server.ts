// POST /api/import/execute
//
// Batch-insert PGN-imported moves into the user's repertoire.
// All writes happen in a single transaction for atomicity.
//
// Input: {
//   repertoireId: number,
//   moves: { fromFen: string, san: string }[],          // all moves to import
//   replacements: { fromFen: string, san: string }[]     // conflicts resolved by user
// }
//
// Output: { inserted: number, replaced: number, skipped: number }
//
// Security: toFen is computed server-side for every move (never from client).
// Writes go through $lib/server/repertoire-moves, like POST /api/moves and
// POST /api/review/add-move.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import {
	addMove,
	addMoves,
	lockRepertoire,
	playMove,
	replaceMove,
	type RepertoireColor
} from '$lib/server/repertoire-moves';
import { parseBody } from '$lib/server/validation';
import { executeImportSchema } from '$lib/server/schemas/import';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const { repertoireId, moves, replacements } = await parseBody(request, executeImportSchema);

	// Verify repertoire ownership
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));
	if (!rep) throw error(404, 'Repertoire not found');

	if (await isRepertoireLocked(user.id, repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// Build a set of replacement fenKeys for quick lookup
	const replacementSet = new Set<string>();
	for (const r of replacements) {
		replacementSet.add(fenKey(r.fromFen) + '|' + r.san);
	}

	// Validate all moves upfront and compute toFen for each
	const validatedMoves: { fromFen: string; toFen: string; san: string; notes: string | null }[] =
		[];

	for (const m of moves) {
		// Skip invalid moves silently — they were already flagged during parse
		const played = playMove(m.fromFen, m.san);
		if (!played) continue;

		// Truncate annotation to 500 chars (matches existing notes limit)
		const raw = m.annotation;
		const notes = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 500) : null;

		validatedMoves.push({ ...played, notes });
	}

	if (validatedMoves.length === 0) {
		throw error(400, 'No valid moves to import');
	}

	const target = { userId: user.id, repertoireId, color: rep.color as RepertoireColor };

	// Single transaction for all writes
	const result = await db.transaction(async (tx) => {
		await lockRepertoire(tx, repertoireId);

		let inserted = 0;
		let replaced = 0;
		let skipped = 0;

		// Replacements first: removing an old line can remove moves that the
		// rest of the import would otherwise count as already saved. There is
		// one per conflict the user resolved, so these go one at a time.
		const isReplacement = (vm: (typeof validatedMoves)[number]) =>
			replacementSet.has(fenKey(vm.fromFen) + '|' + vm.san);

		for (const vm of validatedMoves.filter(isReplacement)) {
			const move = { ...vm, source: 'PGN_IMPORT' };
			const added = await addMove(tx, target, move);
			if (added.status === 'created') {
				inserted++;
			} else if (added.status === 'conflict') {
				// User chose this PGN move over the existing one
				await replaceMove(tx, target, added.existing, move);
				replaced++;
			} else {
				skipped++;
			}
		}

		// Everything else in a fixed number of queries. Moves already saved, and
		// conflicts the user didn't resolve in favour of the PGN, keep the
		// existing move (safety default) and count as skipped.
		const rest = await addMoves(
			tx,
			target,
			validatedMoves
				.filter((vm) => !isReplacement(vm))
				.map((vm) => ({ ...vm, source: 'PGN_IMPORT' }))
		);
		inserted += rest.created;
		skipped += rest.skipped;

		return { inserted, replaced, skipped };
	});

	return json(result);
};
