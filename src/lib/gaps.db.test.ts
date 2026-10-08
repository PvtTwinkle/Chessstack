import { afterEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import { chessmontMoves, ecoOpening } from '$lib/db/schema';
import { fenKey, loadGapData, STARTING_FEN } from './gaps';
import { lookupEco } from './eco';
import { toFullFen } from './fen';

/** Replays SANs from the start and returns one move row per ply, as user_move stores them. */
function movesFor(...sans: string[]) {
	const chess = new Chess(toFullFen(STARTING_FEN));
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

function mastersRow(move: { fromFen: string; toFen: string; san: string }, gamesPlayed: number) {
	return {
		positionFen: move.fromFen,
		moveSan: move.san,
		resultingFen: move.toFen,
		gamesPlayed
	};
}

afterEach(async () => {
	await db.delete(chessmontMoves);
	await db.delete(ecoOpening);
});

describe('loadGapData', () => {
	it('finds gaps right after a reply with no continuation yet', async () => {
		const [, c5] = movesFor('e4', 'c5');
		await db.insert(chessmontMoves).values(mastersRow(c5, 50000));

		const gaps = await loadGapData(db, movesFor('e4'), 'WHITE', null, 10000);

		expect(gaps).toMatchObject([{ line: 'e4,c5', gamesPlayed: 50000 }]);
	});

	it("finds White's first moves for an empty Black repertoire", async () => {
		const [e4] = movesFor('e4');
		await db.insert(chessmontMoves).values(mastersRow(e4, 50000));

		const gaps = await loadGapData(db, [], 'BLACK', null, 10000);

		expect(gaps.map((g) => g.line)).toEqual(['e4']);
	});

	it('names each gap after the deepest opening along its line', async () => {
		const [e4, c5] = movesFor('e4', 'c5');
		await db.insert(chessmontMoves).values(mastersRow(c5, 50000));
		await db.insert(ecoOpening).values([
			{ fen: e4.toFen, code: 'B00', name: "King's Pawn Game" },
			{ fen: c5.toFen, code: 'B20', name: 'Sicilian Defense' }
		]);

		const gaps = await loadGapData(db, movesFor('e4'), 'WHITE', null, 10000);

		expect(gaps[0].opening).toEqual({ code: 'B20', name: 'Sicilian Defense' });
	});
});

describe('lookupEco', () => {
	it('matches the 6-field FENs that chess.js produces', async () => {
		const chess = new Chess();
		chess.move('e4');
		const afterE4 = chess.fen();
		chess.move('c5');
		await db.insert(ecoOpening).values({ fen: fenKey(afterE4), code: 'B00', name: "King's Pawn" });

		expect(await lookupEco(db, [chess.fen(), afterE4])).toEqual({
			code: 'B00',
			name: "King's Pawn"
		});
	});
});
