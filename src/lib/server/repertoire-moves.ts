// Every write to a repertoire's move tree goes through here: Build, game
// review, PGN import and opponent prep all save, replace and delete moves with
// the same rules, so they can't drift apart.
//
// The rules:
//   - On the user's turn a position has one move, with one drill card.
//   - On the opponent's turn a position can have any number of moves, without
//     cards (you drill your own replies, not the opponent's choices).
//   - Replacing a user move swaps the move in place, gives it a fresh card, and
//     removes the moves that only the old move led to.
//   - Deleting a move removes it and every move that is no longer reachable
//     from the start position without it.
//
// FENs are stored without move counters, so a repertoire is a graph, not a
// tree: transpositions join lines, and a line such as 1.Nf3 Nf6 2.Ng1 Ng8
// leads back to a position already in it. The deletes below terminate on such
// a cycle, walk a shared position once, and keep any position another line
// still reaches.
//
// Each function runs inside the caller's transaction, after lockRepertoire(),
// so two requests writing to one repertoire (a double click, two tabs) take
// turns instead of both passing the "is it already saved?" check. The unique
// indexes on user_move and user_repertoire_move back this up.

import { Chess } from 'chess.js';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { fenKey, STARTING_FEN } from '$lib/fen';

/** A Drizzle transaction, as handed to the db.transaction() callback. */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MoveRow = typeof userMove.$inferSelect;
export type RepertoireColor = 'WHITE' | 'BLACK';

// Long enough for any real repertoire, short enough that a runaway query can't
// hold a pooled connection for long.
const DELETE_TIMEOUT = '10s';

/** Whether the repertoire's side is to move in `fen`. */
export function isUserTurn(color: RepertoireColor, fen: string): boolean {
	return fen.split(' ')[1] === (color === 'WHITE' ? 'w' : 'b');
}

/**
 * Plays `san` from `fromFen`. Returns the normalised positions and SAN, or
 * null when the FEN is invalid or the move illegal.
 */
export function playMove(
	fromFen: string,
	san: string
): { fromFen: string; toFen: string; san: string } | null {
	try {
		const chess = new Chess(fromFen);
		const result = chess.move(san);
		return { fromFen: fenKey(fromFen), toFen: fenKey(chess.fen()), san: result.san };
	} catch {
		return null;
	}
}

/** A drill card for a newly saved user move, due immediately. */
export function newCard(userId: number, repertoireId: number, fromFen: string, san: string) {
	return {
		userId,
		repertoireId,
		fromFen,
		san,
		due: new Date(),
		state: 0, // New
		reps: 0,
		lapses: 0,
		stability: null,
		difficulty: null,
		elapsedDays: null,
		scheduledDays: null,
		lastReview: null,
		learningSteps: 0
	};
}

/** Holds the repertoire row until the transaction ends, so writers take turns. */
export async function lockRepertoire(tx: Transaction, repertoireId: number): Promise<void> {
	await tx
		.select({ id: repertoire.id })
		.from(repertoire)
		.where(eq(repertoire.id, repertoireId))
		.for('update');
}

interface Target {
	userId: number;
	repertoireId: number;
	color: RepertoireColor;
}

interface NewMove {
	fromFen: string;
	toFen: string;
	san: string;
	source: string;
	notes?: string | null;
}

export type AddResult =
	| { status: 'created'; move: MoveRow }
	| { status: 'exists'; move: MoveRow }
	| { status: 'conflict'; existing: MoveRow };

/**
 * Saves a move, with a drill card when it is the user's. The same move saved
 * again returns the saved row; a different user move at a position that
 * already has one is a conflict, and nothing is written.
 */
export async function addMove(tx: Transaction, target: Target, move: NewMove): Promise<AddResult> {
	const { userId, repertoireId, color } = target;
	const userTurn = isUserTurn(color, move.fromFen);

	const atPosition = await tx
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.fromFen, move.fromFen)));

	const same = atPosition.find((m) => m.san === move.san);
	if (same) return { status: 'exists', move: same };
	if (userTurn && atPosition.length > 0) return { status: 'conflict', existing: atPosition[0] };

	const [saved] = await tx
		.insert(userMove)
		.values({
			userId,
			repertoireId,
			fromFen: move.fromFen,
			toFen: move.toFen,
			san: move.san,
			source: move.source,
			notes: move.notes ?? null,
			createdAt: new Date()
		})
		.returning();

	if (userTurn) {
		await tx
			.insert(userRepertoireMove)
			.values(newCard(userId, repertoireId, move.fromFen, move.san));
	}

	return { status: 'created', move: saved };
}

/**
 * addMove for many moves at once, in a fixed number of queries however many
 * there are: one read of the moves already at their positions, one insert of
 * the new moves and one of their cards. Same rules and same order as calling
 * addMove for each in turn: a move already saved (or earlier in the list) is
 * skipped, and so is a user move at a position that already has one. Never
 * replaces anything; conflicts the user resolved go through replaceMove.
 */
export async function addMoves(
	tx: Transaction,
	target: Target,
	moves: NewMove[]
): Promise<{ created: number; skipped: number }> {
	const { userId, repertoireId, color } = target;
	if (moves.length === 0) return { created: 0, skipped: 0 };

	// One JSON parameter rather than a parameter per position, so a chunk of a
	// thousand moves is still a small statement.
	const fens = [...new Set(moves.map((m) => m.fromFen))];
	const existing = await tx
		.select({ fromFen: userMove.fromFen, san: userMove.san })
		.from(userMove)
		.where(
			and(
				eq(userMove.repertoireId, repertoireId),
				sql`${userMove.fromFen} IN (SELECT jsonb_array_elements_text(${JSON.stringify(fens)}::jsonb))`
			)
		);

	// SANs at each position, updated as moves are planned so later moves in
	// the list see earlier ones, as they would one call at a time.
	const atPosition = new Map<string, string[]>();
	for (const m of existing) {
		const list = atPosition.get(m.fromFen);
		if (list) list.push(m.san);
		else atPosition.set(m.fromFen, [m.san]);
	}

	const toInsert: NewMove[] = [];
	for (const move of moves) {
		const sans = atPosition.get(move.fromFen) ?? [];
		if (sans.includes(move.san)) continue;
		if (isUserTurn(color, move.fromFen) && sans.length > 0) continue;
		atPosition.set(move.fromFen, [...sans, move.san]);
		toInsert.push(move);
	}
	if (toInsert.length === 0) return { created: 0, skipped: moves.length };

	const now = new Date();
	// The repertoire is locked, so nothing else can have saved these since the
	// read; the unique index only backs that up.
	const saved = await tx
		.insert(userMove)
		.values(
			toInsert.map((m) => ({
				userId,
				repertoireId,
				fromFen: m.fromFen,
				toFen: m.toFen,
				san: m.san,
				source: m.source,
				notes: m.notes ?? null,
				createdAt: now
			}))
		)
		.onConflictDoNothing()
		.returning({ fromFen: userMove.fromFen, san: userMove.san });

	const cards = saved
		.filter((m) => isUserTurn(color, m.fromFen))
		.map((m) => newCard(userId, repertoireId, m.fromFen, m.san));
	if (cards.length > 0) {
		await tx.insert(userRepertoireMove).values(cards).onConflictDoNothing();
	}

	return { created: saved.length, skipped: moves.length - saved.length };
}

/**
 * Replaces a saved user move with a different move from the same position.
 * The row is updated in place, its old card is replaced by a new one (the
 * user has never drilled the new move), and moves that only the old move led
 * to are deleted with their cards. The old move's note goes with it.
 */
export async function replaceMove(
	tx: Transaction,
	target: Target,
	existing: MoveRow,
	move: NewMove
): Promise<MoveRow> {
	const { userId, repertoireId } = target;

	const [updated] = await tx
		.update(userMove)
		.set({
			san: move.san,
			toFen: move.toFen,
			source: move.source,
			notes: move.notes ?? null
		})
		.where(eq(userMove.id, existing.id))
		.returning();

	await tx
		.delete(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, userId),
				eq(userRepertoireMove.repertoireId, repertoireId),
				eq(userRepertoireMove.fromFen, existing.fromFen)
			)
		);
	await tx
		.insert(userRepertoireMove)
		.values(newCard(userId, repertoireId, existing.fromFen, move.san));

	await deleteUnreachable(tx, userId, repertoireId, existing.toFen, existing.fromFen);

	return updated;
}

/**
 * Deletes a saved move and every move that can no longer be reached from the
 * start position without it, with their cards. Returns how many moves were
 * deleted, the move itself included.
 */
export async function deleteMove(tx: Transaction, userId: number, move: MoveRow): Promise<number> {
	await tx
		.delete(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, userId),
				eq(userRepertoireMove.repertoireId, move.repertoireId),
				eq(userRepertoireMove.fromFen, move.fromFen),
				eq(userRepertoireMove.san, move.san)
			)
		);
	await tx.delete(userMove).where(eq(userMove.id, move.id));

	const count = await deleteUnreachable(tx, userId, move.repertoireId, move.toFen, move.fromFen);

	// Defense-in-depth: a card is orphaned if no move has its (fromFen, san).
	await tx.delete(userRepertoireMove).where(
		and(
			eq(userRepertoireMove.userId, userId),
			eq(userRepertoireMove.repertoireId, move.repertoireId),
			notExists(
				tx
					.select({ one: sql`1` })
					.from(userMove)
					.where(
						and(
							eq(userMove.repertoireId, userRepertoireMove.repertoireId),
							eq(userMove.fromFen, userRepertoireMove.fromFen),
							eq(userMove.san, userRepertoireMove.san)
						)
					)
			)
		)
	);

	return count + 1;
}

/**
 * Deletes the moves after `startFen` that the start position no longer
 * reaches, with their cards, and returns how many it deleted. Call it once
 * the move into `startFen` has been deleted or redirected; a position some
 * other line still leads to keeps its moves.
 *
 * `stopFen` is where the removed move started. The walk never continues out
 * of it, so a line that cycles back there can't take the rest of the
 * repertoire with it even if that position is itself unreachable.
 *
 * Runs as one statement inside the caller's transaction.
 */
export async function deleteUnreachable(
	tx: Transaction,
	userId: number,
	repertoireId: number,
	startFen: string,
	stopFen: string
): Promise<number> {
	await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${DELETE_TIMEOUT}'`));

	// UNION (not UNION ALL) drops rows already collected, so both walks end on
	// a cycle and visit a position reached by two paths once.
	const deleted = await tx.execute<{ id: number }>(sql`
		WITH RECURSIVE subtree AS (
			SELECT id, from_fen, to_fen, san
			FROM user_move
			WHERE repertoire_id = ${repertoireId} AND from_fen = ${startFen}
			UNION
			SELECT m.id, m.from_fen, m.to_fen, m.san
			FROM user_move m
			JOIN subtree s ON m.from_fen = s.to_fen
			WHERE m.repertoire_id = ${repertoireId} AND m.from_fen <> ${stopFen}
		),
		reachable(fen) AS (
			SELECT ${STARTING_FEN}::text
			UNION
			SELECT m.to_fen
			FROM user_move m
			JOIN reachable r ON m.from_fen = r.fen
			WHERE m.repertoire_id = ${repertoireId}
		),
		doomed AS (
			SELECT s.id, s.from_fen, s.san
			FROM subtree s
			WHERE s.from_fen NOT IN (SELECT fen FROM reachable)
		),
		deleted_cards AS (
			DELETE FROM user_repertoire_move c
			USING doomed d
			WHERE c.user_id = ${userId}
				AND c.repertoire_id = ${repertoireId}
				AND c.from_fen = d.from_fen
				AND c.san = d.san
		)
		DELETE FROM user_move m
		USING doomed d
		WHERE m.id = d.id
		RETURNING m.id
	`);

	return deleted.length;
}
