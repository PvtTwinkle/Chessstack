import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { opponentMoves, opponentPreps, prepMoves, repertoire, userMove } from '$lib/db/schema';
import { fenKey } from '$lib/fen';
import { resetDb, createUser, createRepertoire } from '$lib/test/db-helpers';
import * as prepRoute from '../../routes/api/prep/[id]/+server';
import * as movesRoute from '../../routes/api/prep/[id]/moves/+server';
import { POST as refresh } from '../../routes/api/prep/[id]/refresh/+server';
import { POST as exportPrep } from '../../routes/api/prep/[id]/export/+server';
import { POST as addToRepertoire } from '../../routes/api/prep/[id]/add-to-repertoire/+server';

type Row = { fromFen: string; toFen: string; san: string };

function line(...sans: string[]): Row[] {
	const chess = new Chess();
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

type Handler = (event: never) => Promise<Response> | Response;

/** Calls a handler as `user`, returning the status (a thrown error() included). */
async function call(
	handler: Handler,
	user: { id: number; tier?: 'free' | 'paid' },
	prepId: number,
	method: string,
	body?: unknown
): Promise<{ status: number; body: unknown }> {
	try {
		const res = await handler({
			locals: { user },
			params: { id: String(prepId) },
			request: new Request('http://localhost/api/prep', {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			})
		} as never);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		const err = e as { status?: number; body?: unknown };
		if (typeof err.status !== 'number') throw e;
		return { status: err.status, body: err.body };
	}
}

// White prep against "rival": 1.e4 (prep) e5 (game) 2.Nf3 (prep) Nc6 (game) 3.Bb5 (prep).
async function createPrep(userId: number) {
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
	const ids: number[] = [];
	for (const r of line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5')) {
		if (r.fromFen.split(' ')[1] === 'w') {
			const [row] = await db
				.insert(prepMoves)
				.values({ prepId: prep.id, userId, ...r, color: 'white', createdAt: now })
				.returning();
			ids.push(row.id);
		} else {
			await db.insert(opponentMoves).values({
				prepId: prep.id,
				positionFen: r.fromFen,
				moveSan: r.san,
				opponentColor: 'b',
				resultingFen: r.toFen,
				gamesPlayed: 3
			});
		}
	}
	return { prepId: prep.id, moveIds: ids };
}

async function prepSans(prepId: number) {
	const rows = await db.select().from(prepMoves).where(eq(prepMoves.prepId, prepId));
	return rows.map((r) => r.san).sort();
}

describe('prep API', () => {
	let owner: number;
	let other: number;
	let prepId: number;
	let moveIds: number[];

	beforeEach(async () => {
		await resetDb();
		owner = await createUser();
		other = await createUser();
		({ prepId, moveIds } = await createPrep(owner));
	});

	it('gives another user 404 for every prep endpoint, and changes nothing', async () => {
		const repId = await createRepertoire(other, new Date('2026-01-01'));
		const asOther = { id: other };
		const results = await Promise.all([
			call(prepRoute.GET as Handler, asOther, prepId, 'GET'),
			call(prepRoute.PATCH as Handler, asOther, prepId, 'PATCH', { minGames: 3 }),
			call(prepRoute.DELETE as Handler, asOther, prepId, 'DELETE'),
			call(movesRoute.POST as Handler, asOther, prepId, 'POST', {
				fromFen: line('e4')[0].toFen,
				san: 'c5',
				color: 'white'
			}),
			call(movesRoute.DELETE as Handler, asOther, prepId, 'DELETE', { moveId: moveIds[0] }),
			call(refresh as Handler, asOther, prepId, 'POST', { mode: 'merge-start' }),
			call(exportPrep as Handler, asOther, prepId, 'POST', { color: 'white' }),
			call(addToRepertoire as Handler, asOther, prepId, 'POST', {
				mode: 'execute',
				repertoireId: repId,
				color: 'white'
			})
		]);
		expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
		expect(await prepSans(prepId)).toEqual(['Bb5', 'Nf3', 'e4']);
	});

	it('deletes a prep move with the prep moves only it leads to', async () => {
		const res = await call(movesRoute.DELETE as Handler, { id: owner }, prepId, 'DELETE', {
			moveId: moveIds[1]
		});
		expect(res.status).toBe(200);
		expect((res.body as { ids: number[] }).ids.sort()).toEqual([moveIds[1], moveIds[2]].sort());
		expect(await prepSans(prepId)).toEqual(['e4']);
	});

	it('keeps prep moves another line still reaches', async () => {
		// 1.Nf3 Nc6 2.e4 e5 transposes to the position 3.Bb5 is played from.
		const now = new Date();
		const [nf3, nc6, e4, e5] = line('Nf3', 'Nc6', 'e4', 'e5');
		await db.insert(prepMoves).values([
			{ prepId, userId: owner, ...nf3, color: 'white', createdAt: now },
			{ prepId, userId: owner, ...e4, color: 'white', createdAt: now }
		]);
		for (const r of [nc6, e5]) {
			await db.insert(opponentMoves).values({
				prepId,
				positionFen: r.fromFen,
				moveSan: r.san,
				opponentColor: 'b',
				resultingFen: r.toFen,
				gamesPlayed: 3
			});
		}

		await call(movesRoute.DELETE as Handler, { id: owner }, prepId, 'DELETE', {
			moveId: moveIds[0]
		});
		// 1.e4 and 2.Nf3 (only reached through it) go; 3.Bb5 stays.
		expect(await prepSans(prepId)).toEqual(['Bb5', 'Nf3', 'e4']);
		const left = await db.select().from(prepMoves).where(eq(prepMoves.prepId, prepId));
		expect(left.map((m) => m.id)).not.toContain(moveIds[0]);
		expect(left.map((m) => m.id)).not.toContain(moveIds[1]);
		expect(left.map((m) => m.id)).toContain(moveIds[2]);
	});

	describe('export', () => {
		it("refuses a free user who is at the plan's repertoire limit", async () => {
			await createRepertoire(owner, new Date('2026-01-01'));
			const res = await call(exportPrep as Handler, { id: owner, tier: 'free' }, prepId, 'POST', {
				color: 'white'
			});
			expect(res.status).toBe(403);
			const reps = await db.select().from(repertoire).where(eq(repertoire.userId, owner));
			expect(reps).toHaveLength(1);
		});

		it('creates a repertoire whose lines all start from the start position', async () => {
			// The prep skipped 1.e4 (it came from a repertoire); export adds it.
			await db.delete(prepMoves).where(eq(prepMoves.id, moveIds[0]));
			const repId = await createRepertoire(owner, new Date('2026-01-01'));
			await db.insert(userMove).values({
				userId: owner,
				repertoireId: repId,
				...line('e4')[0],
				source: 'PERSONAL',
				createdAt: new Date()
			});

			const res = await call(exportPrep as Handler, { id: owner, tier: 'paid' }, prepId, 'POST', {
				color: 'white'
			});
			expect(res.status).toBe(201);
			const newRep = (res.body as { repertoireId: number }).repertoireId;
			const rows = await db.select().from(userMove).where(eq(userMove.repertoireId, newRep));
			expect(rows.map((r) => r.san).sort()).toEqual(['Bb5', 'Nc6', 'Nf3', 'e4', 'e5']);
		});
	});

	describe('add to repertoire', () => {
		it('refuses a locked repertoire', async () => {
			await createRepertoire(owner, new Date('2026-01-01'));
			const locked = await createRepertoire(owner, new Date('2026-02-01'));
			const res = await call(
				addToRepertoire as Handler,
				{ id: owner, tier: 'free' },
				prepId,
				'POST',
				{ mode: 'execute', repertoireId: locked, color: 'white' }
			);
			expect(res.status).toBe(403);
			expect(await db.select().from(userMove).where(eq(userMove.repertoireId, locked))).toEqual([]);
		});

		it('refuses a repertoire of the other colour', async () => {
			const repId = await createRepertoire(owner, new Date('2026-01-01'));
			const res = await call(
				addToRepertoire as Handler,
				{ id: owner, tier: 'free' },
				prepId,
				'POST',
				{ mode: 'preview', repertoireId: repId, color: 'black' }
			);
			expect(res.status).toBe(400);
		});
	});
});
