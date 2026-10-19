// Turns an import preview plus the user's conflict choices into the body for
// POST /api/import/execute. Shared by the PGN import modal and the opening
// guides' "Add to my repertoire".
//
// Choosing one move at a conflict abandons the other alternatives, and with
// them every move the import would have saved after them: those positions can
// no longer be reached, so saving them would leave stray moves (with drill
// cards) in the repertoire. Conflicts inside an abandoned branch stop being
// asked about for the same reason. The existing repertoire move is never
// counted here: when it loses, the execute route deletes its subtree itself.

import { Chess } from 'chess.js';
import { fenKey } from '$lib/fen';
import { IMPORT_MAX_MOVES } from '$lib/validation-limits';
import type { ImportConflict, ImportPreview } from './detectConflicts';

/** Conflict position (the conflict's fromFen, as given) → the SAN the user chose. */
export type Resolutions = ReadonlyMap<string, string>;

export interface ImportMove {
	fromFen: string;
	san: string;
	annotation?: string | null;
}

export interface ImportRequest {
	moves: ImportMove[];
	replacements: { fromFen: string; san: string }[];
}

function target(fromFen: string, san: string): string | null {
	try {
		const chess = new Chess(fromFen);
		chess.move(san);
		return fenKey(chess.fen());
	} catch {
		return null;
	}
}

/**
 * Position keys (fenKey) that only the abandoned alternatives lead to. A
 * position that a kept move also reaches (a transposition) stays reachable.
 * Moves already saved in the repertoire aren't in the preview, so a
 * transposition through them isn't seen; that errs towards saving less.
 */
export function abandonedPositions(preview: ImportPreview, resolved: Resolutions): Set<string> {
	const edges = [...preview.newUserMoves, ...preview.newOpponentMoves];
	// Built once so the walk is linear in the number of edges: this runs on
	// every conflict click, and a big repertoire file has thousands of edges.
	const childrenOf = new Map<string, string[]>();
	for (const edge of edges) {
		const from = fenKey(edge.fromFen);
		const list = childrenOf.get(from);
		if (list) list.push(fenKey(edge.toFen));
		else childrenOf.set(from, [fenKey(edge.toFen)]);
	}

	const roots = new Set<string>();
	for (const conflict of preview.conflicts) {
		const chosen = resolved.get(conflict.fromFen);
		if (!chosen) continue;
		for (const alt of conflict.alternatives) {
			if (alt === chosen || alt === conflict.existingMove) continue;
			const to = target(conflict.fromFen, alt);
			if (to) roots.add(to);
		}
	}

	const reachable = new Set<string>();
	for (;;) {
		const dead = new Set<string>();
		const queue = [...roots].filter((p) => !reachable.has(p));
		for (const p of queue) dead.add(p);
		while (queue.length > 0) {
			const from = queue.pop()!;
			for (const to of childrenOf.get(from) ?? []) {
				if (!dead.has(to) && !reachable.has(to)) {
					dead.add(to);
					queue.push(to);
				}
			}
		}

		// Anything a still-saved move leads into is reachable after all; go again without it.
		let changed = false;
		const revive = (to: string | null) => {
			if (to && dead.has(to) && !reachable.has(to)) {
				reachable.add(to);
				changed = true;
			}
		};
		for (const edge of edges) {
			if (!dead.has(fenKey(edge.fromFen))) revive(fenKey(edge.toFen));
		}
		for (const conflict of preview.conflicts) {
			const chosen = resolved.get(conflict.fromFen);
			if (chosen && !dead.has(fenKey(conflict.fromFen))) revive(target(conflict.fromFen, chosen));
		}
		if (!changed) return dead;
	}
}

/** Conflicts still waiting for a choice, in preview order, skipping abandoned branches. */
export function openConflicts(preview: ImportPreview, resolved: Resolutions): ImportConflict[] {
	const dead = abandonedPositions(preview, resolved);
	return preview.conflicts.filter((c) => !resolved.has(c.fromFen) && !dead.has(fenKey(c.fromFen)));
}

/** The moves to send to POST /api/import/execute. */
export function buildImportRequest(preview: ImportPreview, resolved: Resolutions): ImportRequest {
	const dead = abandonedPositions(preview, resolved);
	const edges = [...preview.newUserMoves, ...preview.newOpponentMoves];
	const moves: ImportMove[] = edges
		.filter((edge) => !dead.has(fenKey(edge.fromFen)))
		.map((edge) => ({ fromFen: edge.fromFen, san: edge.san, annotation: edge.annotation }));

	const replacements: { fromFen: string; san: string }[] = [];
	for (const conflict of preview.conflicts) {
		const chosen = resolved.get(conflict.fromFen);
		if (!chosen || dead.has(fenKey(conflict.fromFen))) continue;
		const edge = edges.find((e) => e.fromFen === conflict.fromFen && e.san === chosen);
		moves.push({ fromFen: conflict.fromFen, san: chosen, annotation: edge?.annotation ?? null });
		// Choosing a move other than the saved one replaces it.
		if (conflict.existingMove && chosen !== conflict.existingMove) {
			replacements.push({ fromFen: conflict.fromFen, san: chosen });
		}
	}
	return { moves, replacements };
}

/**
 * Moves per POST /api/import/execute, the most one request accepts. Each move
 * is about 100 bytes of JSON, so one request for a big repertoire file would
 * pass the preview and then hit the server's request body limit on save.
 */
export const IMPORT_CHUNK_SIZE = IMPORT_MAX_MOVES;

export interface ImportCounts {
	inserted: number;
	replaced: number;
	skipped: number;
}

/**
 * Split an import request into requests of at most `size` moves. The server
 * saves each move idempotently, so the chunks can be sent one after another
 * and a failed import can simply be retried. Replacing moves go first, and
 * each chunk carries the replacements for its own moves: the server handles
 * a replacement before the rest because removing an old line can remove
 * moves the import would otherwise count as already saved.
 */
export function chunkImportRequest(
	request: ImportRequest,
	size = IMPORT_CHUNK_SIZE
): ImportRequest[] {
	const key = (m: { fromFen: string; san: string }) => `${fenKey(m.fromFen)}|${m.san}`;
	const replacing = new Set(request.replacements.map(key));
	const ordered = [
		...request.moves.filter((m) => replacing.has(key(m))),
		...request.moves.filter((m) => !replacing.has(key(m)))
	];
	const chunks: ImportRequest[] = [];
	for (let i = 0; i < ordered.length; i += size) {
		const moves = ordered.slice(i, i + size);
		const inChunk = new Set(moves.map(key));
		chunks.push({ moves, replacements: request.replacements.filter((r) => inChunk.has(key(r))) });
	}
	return chunks;
}

/** Send an import chunk by chunk and add up the server's counts. */
export async function sendImportInChunks(
	request: ImportRequest,
	send: (chunk: ImportRequest) => Promise<ImportCounts>
): Promise<ImportCounts> {
	const total: ImportCounts = { inserted: 0, replaced: 0, skipped: 0 };
	for (const chunk of chunkImportRequest(request)) {
		const counts = await send(chunk);
		total.inserted += counts.inserted;
		total.replaced += counts.replaced;
		total.skipped += counts.skipped;
	}
	return total;
}
