import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	opponentMoves,
	opponentPreps,
	prepMoves,
	userMove,
	userRepertoireMove
} from '$lib/db/schema';
import { fenKey } from '$lib/fen';
import { resetDb, createUser, createRepertoire } from '$lib/test/db-helpers';
import { POST } from '../../routes/api/prep/[id]/add-to-repertoire/+server';

type Row = { fromFen: string; toFen: string; san: string };

/** One row per SAN, replayed from the start position. */
function line(...sans: string[]): Row[] {
	const chess = new Chess();
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

const isWhiteMove = (r: Row) => r.fromFen.split(' ')[1] === 'w';

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

describe('POST /api/prep/[id]/add-to-repertoire', () => {
	let userId: number;
	let repertoireId: number;
	let prepId: number;

	beforeEach(async () => {
		await resetDb();
		userId = await createUser();
		repertoireId = await createRepertoire(userId, new Date('2026-01-01'));

		// The White repertoire plays 1.e4 e5 2.Nf3 Nc6 3.Bb5.
		for (const r of line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5')) {
			await db
				.insert(userMove)
				.values({ userId, repertoireId, ...r, source: 'PERSONAL', createdAt: new Date() });
			if (isWhiteMove(r)) {
				await db
					.insert(userRepertoireMove)
					.values({ userId, repertoireId, fromFen: r.fromFen, san: r.san, state: 0 });
			}
		}

		// The prep answers the opponent's 1...e5 with 2.Bc4 instead, and meets
		// 2...Nf6 with 3.d3.
		const now = new Date();
		const [prep] = await db
			.insert(opponentPreps)
			.values({
				userId,
				opponentName: 'rival',
				platform: 'LICHESS',
				platformUsername: 'rival',
				lastFetchedAt: now,
				createdAt: now
			})
			.returning();
		prepId = prep.id;
		const prepLine = line('e4', 'e5', 'Bc4', 'Nf6', 'd3');
		for (const r of prepLine) {
			if (isWhiteMove(r)) {
				await db.insert(prepMoves).values({ prepId, userId, ...r, color: 'white', createdAt: now });
			} else {
				await db.insert(opponentMoves).values({
					prepId,
					positionFen: r.fromFen,
					moveSan: r.san,
					opponentColor: 'b',
					resultingFen: r.toFen,
					gamesPlayed: 4
				});
			}
		}
	});

	async function addToRepertoire(body: Record<string, unknown>) {
		const res = await POST({
			locals: { user: { id: userId } },
			params: { id: String(prepId) },
			request: new Request('http://localhost/api/prep/add-to-repertoire', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, color: 'white', ...body })
			})
		} as unknown as Parameters<typeof POST>[0]);
		return res.json();
	}

	const bc4 = line('e4', 'e5', 'Bc4')[2];

	it('previews the new, connecting and conflicting moves', async () => {
		expect(await addToRepertoire({ mode: 'preview' })).toEqual({
			newMoves: 1,
			connectingMoves: 1,
			duplicates: 1,
			conflicts: [{ fromFen: bc4.fromFen, existingMove: 'Nf3', prepMove: 'Bc4' }]
		});
	});

	it("removes the replaced move's line and its drill cards", async () => {
		const result = await addToRepertoire({
			mode: 'execute',
			replacements: [{ fromFen: bc4.fromFen, san: 'Bc4' }]
		});

		expect(result).toEqual({ inserted: 1, replaced: 1, skipped: 0, connecting: 1 });
		// 2.Nf3 Nc6 3.Bb5 is gone; the prep line 2.Bc4 Nf6 3.d3 takes its place.
		expect(await sansLeft(repertoireId)).toEqual(['Bc4', 'Nf6', 'd3', 'e4', 'e5']);
		expect(await cardsLeft(repertoireId)).toEqual(['Bc4', 'd3', 'e4']);
	});

	it('keeps the existing line when the conflict is not replaced', async () => {
		const result = await addToRepertoire({ mode: 'execute' });

		expect(result).toMatchObject({ replaced: 0, skipped: 1 });
		expect(await sansLeft(repertoireId)).toEqual(expect.arrayContaining(['Nf3', 'Nc6', 'Bb5']));
		expect(await cardsLeft(repertoireId)).toEqual(expect.arrayContaining(['Nf3', 'Bb5']));
	});
});
