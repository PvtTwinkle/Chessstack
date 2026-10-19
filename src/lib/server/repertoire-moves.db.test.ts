import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { userMove, userRepertoireMove, userSettings } from '$lib/db/schema';
import { fenKey } from '$lib/fen';
import { resetDb, createUser, createRepertoire } from '$lib/test/db-helpers';
import { DELETE } from '../../routes/api/moves/[id]/+server';
import { POST as executeImport } from '../../routes/api/import/execute/+server';
import { POST as createMove } from '../../routes/api/moves/+server';
import { POST as reviewAddMove } from '../../routes/api/review/add-move/+server';
import { POST as failCard } from '../../routes/api/review/fail-card/+server';
import { PATCH as patchSettings } from '../../routes/api/settings/+server';

type Row = { fromFen: string; toFen: string; san: string };

/** One move row per SAN, replayed from the start position. */
function line(...sans: string[]): Row[] {
	const chess = new Chess();
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

/**
 * Saves the moves of a White repertoire, with a drill card for every White
 * move. Moves already saved (a shared start of two lines) are reused.
 */
async function save(userId: number, repertoireId: number, rows: Row[]) {
	const saved = [];
	for (const r of rows) {
		const [existing] = await db
			.select()
			.from(userMove)
			.where(
				and(
					eq(userMove.repertoireId, repertoireId),
					eq(userMove.fromFen, r.fromFen),
					eq(userMove.san, r.san)
				)
			);
		if (existing) {
			saved.push(existing);
			continue;
		}
		const [m] = await db
			.insert(userMove)
			.values({ userId, repertoireId, ...r, source: 'PERSONAL', createdAt: new Date() })
			.returning();
		saved.push(m);
		if (r.fromFen.split(' ')[1] === 'w') {
			await db.insert(userRepertoireMove).values({
				userId,
				repertoireId,
				fromFen: r.fromFen,
				san: r.san,
				state: 0,
				learningSteps: 0
			});
		}
	}
	return saved;
}

async function sansLeft(repertoireId: number) {
	const rows = await db.select().from(userMove).where(eq(userMove.repertoireId, repertoireId));
	return rows.map((r) => r.san).sort();
}

async function cardsLeft(repertoireId: number) {
	const rows = await db
		.select()
		.from(userRepertoireMove)
		.where(eq(userRepertoireMove.repertoireId, repertoireId));
	return rows.map((r) => r.san).sort();
}

/** Calls a JSON endpoint as the given user. */
async function call(
	handler: (event: never) => Response | Promise<Response>,
	userId: number,
	body: unknown
): Promise<Response> {
	return handler({
		locals: { user: { id: userId, tier: 'paid' } },
		request: new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) })
	} as never);
}

function deleteMove(userId: number, id: number) {
	return DELETE({
		locals: { user: { id: userId } },
		params: { id: String(id) }
	} as unknown as Parameters<typeof DELETE>[0]);
}

describe('DELETE /api/moves/[id]', () => {
	let userId: number;
	let repertoireId: number;

	beforeEach(async () => {
		await resetDb();
		userId = await createUser();
		repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
	});

	it('deletes the move, everything after it and their drill cards', async () => {
		const [, e5] = await save(userId, repertoireId, line('e4', 'e5', 'Nf3', 'Nc6'));
		await save(userId, repertoireId, line('e4', 'c5', 'Nf3'));

		const res = await deleteMove(userId, e5.id);

		expect(await res.json()).toEqual({ deleted: 3 });
		expect(await sansLeft(repertoireId)).toEqual(['Nf3', 'c5', 'e4']);
		expect(await cardsLeft(repertoireId)).toEqual(['Nf3', 'e4']);
	});

	it("stops where a line cycles back to the deleted move's position", async () => {
		// 3.Ng1 returns to the position after 1.e4, which also has 1...c5.
		const [, nf6] = await save(userId, repertoireId, line('e4', 'Nf6', 'Nf3', 'Ng8', 'Ng1'));
		await save(userId, repertoireId, line('e4', 'c5', 'Nf3'));

		const res = await deleteMove(userId, nf6.id);

		// 1...Nf6 and the three moves after it go; the cycle doesn't reach into 1...c5.
		expect(await res.json()).toEqual({ deleted: 4 });
		expect(await sansLeft(repertoireId)).toEqual(['Nf3', 'c5', 'e4']);
		expect(await cardsLeft(repertoireId)).toEqual(['Nf3', 'e4']);
	});

	it('keeps the rest of the repertoire when a line cycles back to the start', async () => {
		const [, nf6] = await save(userId, repertoireId, line('Nf3', 'Nf6', 'Ng1', 'Ng8'));
		await save(userId, repertoireId, line('Nf3', 'd5', 'd4'));

		const res = await deleteMove(userId, nf6.id);

		expect(await res.json()).toEqual({ deleted: 3 });
		expect(await sansLeft(repertoireId)).toEqual(['Nf3', 'd4', 'd5']);
		expect(await cardsLeft(repertoireId)).toEqual(['Nf3', 'd4']);
	});

	it('keeps the moves of a position another line transposes into', async () => {
		// 1.d4 e6 2.c4 Nf6 and 1.d4 Nf6 2.c4 e6 reach the same position, which has 3.Nc3.
		const [, e6] = await save(userId, repertoireId, line('d4', 'e6', 'c4', 'Nf6', 'Nc3'));
		await save(userId, repertoireId, line('d4', 'Nf6', 'c4', 'e6'));

		const res = await deleteMove(userId, e6.id);

		expect(await res.json()).toEqual({ deleted: 3 });
		expect(await sansLeft(repertoireId)).toEqual(['Nc3', 'Nf6', 'c4', 'd4', 'e6']);
		expect(await cardsLeft(repertoireId)).toEqual(['Nc3', 'c4', 'd4']);
	});

	it('walks a position reached by two lines once', async () => {
		// Both lines lead into the position after 2...e6: UNION ALL would revisit it per path.
		const [first] = await save(userId, repertoireId, line('d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'));
		await save(userId, repertoireId, line('d4', 'e6', 'c4', 'Nf6'));

		const res = await deleteMove(userId, first.id);

		// 6 + 3 distinct moves, each counted once.
		expect(await res.json()).toEqual({ deleted: 9 });
		expect(await sansLeft(repertoireId)).toEqual([]);
		expect(await cardsLeft(repertoireId)).toEqual([]);
	});
});

describe('POST /api/import/execute replacing a move', () => {
	beforeEach(resetDb);

	it('keeps the replacement when the old line cycles back to its position', async () => {
		const userId = await createUser();
		const repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
		// The old 2.Nf3 line returns to the position after 1...e5 with 3...Ng8.
		await save(userId, repertoireId, line('e4', 'e5', 'Nf3', 'Nf6', 'Ng1', 'Ng8'));
		const [, e5] = line('e4', 'e5');

		const res = await executeImport({
			locals: { user: { id: userId } },
			request: new Request('http://localhost/api/import/execute', {
				method: 'POST',
				body: JSON.stringify({
					repertoireId,
					moves: [{ fromFen: e5.toFen, san: 'Bc4' }],
					replacements: [{ fromFen: e5.toFen, san: 'Bc4' }]
				})
			})
		} as unknown as Parameters<typeof executeImport>[0]);

		expect(await res.json()).toEqual({ inserted: 0, replaced: 1, skipped: 0 });
		expect(await sansLeft(repertoireId)).toEqual(['Bc4', 'e4', 'e5']);
		expect(await cardsLeft(repertoireId)).toEqual(['Bc4', 'e4']);
	});
});

describe('POST /api/import/execute', () => {
	let userId: number;
	let repertoireId: number;

	beforeEach(async () => {
		await resetDb();
		userId = await createUser();
		repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
	});

	const games = () => [
		...line('d4', 'e6', 'c4', 'Nf6', 'Nc3'),
		// Transposes into the first game's position after 2...Nf6.
		...line('d4', 'Nf6', 'c4', 'e6'),
		...line('d4', 'd5', 'c4'),
		// 2.Nf3 clashes with 2.c4, imported just before it.
		...line('d4', 'd5', 'Nf3')
	];
	const importMoves = (rows: Row[], replacements: Row[] = []) =>
		call(executeImport, userId, {
			repertoireId,
			moves: rows.map(({ fromFen, san }) => ({ fromFen, san })),
			replacements: replacements.map(({ fromFen, san }) => ({ fromFen, san }))
		});

	it('saves every new move of several games once, with cards for White moves', async () => {
		const res = await importMoves(games());

		// 1.d4 three times and 1...d5 once are already saved by then; 2.Nf3 clashes.
		expect(await res.json()).toEqual({ inserted: 10, replaced: 0, skipped: 5 });
		expect(await sansLeft(repertoireId)).toEqual(
			['Nc3', 'Nf6', 'Nf6', 'c4', 'c4', 'c4', 'd4', 'd5', 'e6', 'e6'].sort()
		);
		expect(await cardsLeft(repertoireId)).toEqual(['Nc3', 'c4', 'c4', 'c4', 'd4'].sort());

		const saved = await db.select().from(userMove).where(eq(userMove.repertoireId, repertoireId));
		const expected = games();
		for (const m of saved) {
			const row = expected.find((r) => r.fromFen === m.fromFen && r.san === m.san);
			expect(m.toFen).toBe(row?.toFen);
			expect(m.source).toBe('PGN_IMPORT');
		}
	});

	it('stores annotations as notes', async () => {
		const [d4] = line('d4');
		await call(executeImport, userId, {
			repertoireId,
			moves: [{ fromFen: d4.fromFen, san: 'd4', annotation: '  Queen pawn  ' }]
		});

		const [saved] = await db.select().from(userMove).where(eq(userMove.repertoireId, repertoireId));
		expect(saved.notes).toBe('Queen pawn');
	});

	it('skips every move when the same games are imported again', async () => {
		await importMoves(games());
		const res = await importMoves(games());

		expect(await res.json()).toEqual({ inserted: 0, replaced: 0, skipped: 15 });
		expect(await sansLeft(repertoireId)).toHaveLength(10);
		expect(await cardsLeft(repertoireId)).toHaveLength(5);
	});

	it('keeps a saved White move the import clashes with unless told to replace it', async () => {
		await save(userId, repertoireId, line('e4', 'e5', 'Nf3', 'Nc6'));

		const res = await importMoves(line('e4', 'e5', 'Bc4'));

		expect(await res.json()).toEqual({ inserted: 0, replaced: 0, skipped: 3 });
		expect(await sansLeft(repertoireId)).toEqual(['Nc6', 'Nf3', 'e4', 'e5']);
	});

	it('replaces a saved White move and saves the rest of the game after it', async () => {
		await save(userId, repertoireId, line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5'));
		await db
			.update(userRepertoireMove)
			.set({ state: 2 })
			.where(eq(userRepertoireMove.repertoireId, repertoireId));
		const game = line('e4', 'e5', 'Bc4', 'Bc5', 'c3');

		const res = await importMoves(game, [game[2]]);

		// The old 2.Nf3 line goes with it; 1.e4 e5 are already saved.
		expect(await res.json()).toEqual({ inserted: 2, replaced: 1, skipped: 2 });
		expect(await sansLeft(repertoireId)).toEqual(['Bc4', 'Bc5', 'c3', 'e4', 'e5'].sort());
		const cards = await db
			.select()
			.from(userRepertoireMove)
			.where(eq(userRepertoireMove.repertoireId, repertoireId));
		expect(Object.fromEntries(cards.map((c) => [c.san, c.state]))).toEqual({
			e4: 2,
			Bc4: 0,
			c3: 0
		});
	});
});

describe('saving a move twice at once', () => {
	let userId: number;
	let repertoireId: number;

	beforeEach(async () => {
		await resetDb();
		userId = await createUser();
		repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
	});

	it('saves one move and one card for a double click', async () => {
		const [e4] = line('e4');
		const body = { repertoireId, fromFen: e4.fromFen, san: 'e4' };

		const statuses = await Promise.all([
			call(createMove, userId, body),
			call(createMove, userId, body)
		]).then((rs) => rs.map((r) => r.status).sort());

		expect(statuses).toEqual([200, 201]);
		expect(await sansLeft(repertoireId)).toEqual(['e4']);
		expect(await cardsLeft(repertoireId)).toEqual(['e4']);
	});

	it('keeps the first of two different user moves and rejects the second', async () => {
		const [e4] = line('e4');

		const statuses = await Promise.all([
			call(createMove, userId, { repertoireId, fromFen: e4.fromFen, san: 'e4' }),
			call(createMove, userId, { repertoireId, fromFen: e4.fromFen, san: 'd4' })
		]).then((rs) => rs.map((r) => r.status).sort());

		expect(statuses).toEqual([201, 409]);
		expect(await sansLeft(repertoireId)).toHaveLength(1);
		expect(await cardsLeft(repertoireId)).toEqual(await sansLeft(repertoireId));
	});

	it('creates one card when two deviations fail a position without one', async () => {
		await save(userId, repertoireId, line('e4'));
		await db.delete(userRepertoireMove).where(eq(userRepertoireMove.repertoireId, repertoireId));
		const body = { repertoireId, fromFen: line('e4')[0].fromFen };

		await Promise.all([call(failCard, userId, body), call(failCard, userId, body)]);

		expect(await cardsLeft(repertoireId)).toEqual(['e4']);
	});

	it('keeps one settings row when two first saves race', async () => {
		await Promise.all([
			call(patchSettings, userId, { soundEnabled: false }),
			call(patchSettings, userId, { stockfishDepth: 15 })
		]);

		const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
		expect(rows).toHaveLength(1);
		expect(rows[0].soundEnabled).toBe(false);
		expect(rows[0].stockfishDepth).toBe(15);
	});
});

describe('POST /api/review/add-move replacing a move', () => {
	beforeEach(resetDb);

	it('gives the new move a fresh card and removes the old line', async () => {
		const userId = await createUser();
		const repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
		await save(userId, repertoireId, line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5'));
		const [, e5] = line('e4', 'e5');
		// The old move has a drilled card that must not carry over to the new one.
		await db
			.update(userRepertoireMove)
			.set({ reps: 7, state: 2 })
			.where(eq(userRepertoireMove.fromFen, e5.toFen));

		const res = await call(reviewAddMove, userId, {
			repertoireId,
			fromFen: e5.toFen,
			san: 'Bc4',
			forceReplace: true
		});

		expect(res.status).toBe(200);
		expect(await sansLeft(repertoireId)).toEqual(['Bc4', 'e4', 'e5']);
		const [card] = await db
			.select()
			.from(userRepertoireMove)
			.where(eq(userRepertoireMove.fromFen, e5.toFen));
		expect(card).toMatchObject({ san: 'Bc4', reps: 0, state: 0 });
		expect(await cardsLeft(repertoireId)).toEqual(['Bc4', 'e4']);
	});

	it('answers 409 without replacing when forceReplace is off', async () => {
		const userId = await createUser();
		const repertoireId = await createRepertoire(userId, new Date('2026-01-01'));
		await save(userId, repertoireId, line('e4', 'e5', 'Nf3'));
		const [, e5] = line('e4', 'e5');

		const res = await call(reviewAddMove, userId, { repertoireId, fromFen: e5.toFen, san: 'Bc4' });

		expect(res.status).toBe(409);
		expect(await sansLeft(repertoireId)).toEqual(['Nf3', 'e4', 'e5']);
	});
});
