import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { opponentMoves, opponentPreps } from '$lib/db/schema';
import { resetDb, createUser } from '$lib/test/db-helpers';
import { POST as createPrep } from '../../routes/api/prep/+server';
import { POST as refresh } from '../../routes/api/prep/[id]/refresh/+server';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -';

function move(moveSan: string, resultingFen: string) {
	return {
		positionFen: START,
		moveSan,
		opponentColor: 'w',
		resultingFen,
		gamesPlayed: 3,
		whiteWins: 1,
		blackWins: 1,
		draws: 1
	};
}

function post(handler: typeof refresh, userId: number, prepId: number, body: unknown) {
	return handler({
		locals: { user: { id: userId } },
		params: { id: String(prepId) },
		request: new Request('http://localhost/api/prep', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as unknown as Parameters<typeof refresh>[0]);
}

/** Calls the refresh endpoint, returning the status and JSON body (or the thrown error's). */
async function call(userId: number, prepId: number, body: unknown) {
	try {
		const res = await post(refresh, userId, prepId, body);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		const err = e as { status: number; body: unknown };
		return { status: err.status, body: err.body };
	}
}

async function listedIds(userId: number) {
	// What the prep list page shows: the user's preps that aren't pending uploads.
	const rows = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.userId, userId), isNull(opponentPreps.pendingSince)));
	return rows.map((p) => p.id);
}

async function movesOf(prepId: number) {
	const rows = await db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId));
	return rows.map((r) => r.moveSan).sort();
}

async function newPrep(userId: number) {
	const res = await post(createPrep as unknown as typeof refresh, userId, 0, {
		opponentName: 'rival',
		platform: 'LICHESS',
		platformUsername: 'rival',
		timeWindow: '3m'
	});
	return ((await res.json()) as { id: number }).id;
}

/** A live prep with 1.e4 as its only move. */
async function livePrep(userId: number) {
	const id = await newPrep(userId);
	await call(userId, id, { mode: 'merge-batch', moves: [move('e4', AFTER_E4)] });
	await call(userId, id, { mode: 'merge-commit', timeWindow: '3m', gamesAsWhite: 3 });
	return id;
}

describe('opponent prep uploads', () => {
	let userId: number;

	beforeEach(async () => {
		await resetDb();
		userId = await createUser();
	});

	it('keeps a new prep hidden until its moves are committed', async () => {
		const id = await newPrep(userId);
		await call(userId, id, { mode: 'merge-batch', moves: [move('e4', AFTER_E4)] });

		expect(await listedIds(userId)).toEqual([]);

		const commit = await call(userId, id, {
			mode: 'merge-commit',
			timeWindow: '3m',
			gamesAsWhite: 3,
			gamesAsBlack: 0
		});

		expect(commit).toEqual({ status: 200, body: { prepId: id } });
		expect(await listedIds(userId)).toEqual([id]);
		expect(await movesOf(id)).toEqual(['e4']);
	});

	it('leaves the old moves in place when a refresh never commits', async () => {
		const id = await livePrep(userId);

		const start = await call(userId, id, { mode: 'merge-start' });
		const { uploadId } = start.body as { uploadId: number };
		await call(userId, uploadId, { mode: 'merge-batch', moves: [move('d4', AFTER_D4)] });

		expect(await movesOf(id)).toEqual(['e4']);
		expect(await listedIds(userId)).toEqual([id]);
	});

	it('swaps the new moves in on commit and keeps the chosen time window', async () => {
		const id = await livePrep(userId);

		const { uploadId } = (await call(userId, id, { mode: 'merge-start' })).body as {
			uploadId: number;
		};
		await call(userId, uploadId, { mode: 'merge-batch', moves: [move('d4', AFTER_D4)] });
		const commit = await call(userId, uploadId, {
			mode: 'merge-commit',
			timeWindow: '1y',
			gamesAsWhite: 7,
			gamesAsBlack: 2
		});

		expect(commit).toEqual({ status: 200, body: { prepId: id } });
		expect(await movesOf(id)).toEqual(['d4']);
		const rows = await db.select().from(opponentPreps);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id,
			timeWindow: '1y',
			gamesAsWhite: 7,
			gamesAsBlack: 2,
			pendingSince: null
		});
	});

	it('drops an unfinished refresh when a new one starts', async () => {
		const id = await livePrep(userId);
		const first = (await call(userId, id, { mode: 'merge-start' })).body as { uploadId: number };
		await call(userId, first.uploadId, { mode: 'merge-batch', moves: [move('d4', AFTER_D4)] });

		await call(userId, id, { mode: 'merge-start' });

		expect((await call(userId, first.uploadId, { mode: 'merge-commit' })).status).toBe(404);
		expect(await movesOf(id)).toEqual(['e4']);
	});

	it('only accepts batches and commits on an unfinished upload', async () => {
		const id = await livePrep(userId);
		const { uploadId } = (await call(userId, id, { mode: 'merge-start' })).body as {
			uploadId: number;
		};

		expect(
			(await call(userId, id, { mode: 'merge-batch', moves: [move('d4', AFTER_D4)] })).status
		).toBe(409);
		expect((await call(userId, id, { mode: 'merge-commit' })).status).toBe(409);
		expect((await call(userId, uploadId, { mode: 'merge-start' })).status).toBe(409);
		expect(await movesOf(id)).toEqual(['e4']);
	});

	it("refuses another user's upload", async () => {
		const id = await livePrep(userId);
		const { uploadId } = (await call(userId, id, { mode: 'merge-start' })).body as {
			uploadId: number;
		};
		const intruder = await createUser();

		expect((await call(intruder, uploadId, { mode: 'merge-commit' })).status).toBe(404);
		expect(
			(await call(intruder, uploadId, { mode: 'merge-batch', moves: [move('d4', AFTER_D4)] }))
				.status
		).toBe(404);
	});
});
