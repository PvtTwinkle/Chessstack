import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { fenKey } from '$lib/fen';
import { analyzeGame, parsePgn, type RepertoireMoveRow } from '$lib/pgn';
import {
	bestRepertoire,
	classifyGame,
	fensToName,
	groupByLine,
	indexRepertoire,
	isMatched,
	linesTo,
	memoryStats,
	outcomeOf,
	pickFixNext,
	speedOf,
	splitPgn,
	topExits,
	type ClassifiedGame,
	type ReportGameInput
} from './index';

/** Repertoire rows for a list of lines, each a space-separated SAN sequence. */
function repertoire(...lines: string[]): RepertoireMoveRow[] {
	const rows = new Map<string, RepertoireMoveRow>();
	for (const line of lines) {
		const chess = new Chess();
		for (const san of line.split(' ')) {
			const fromFen = chess.fen();
			chess.move(san);
			rows.set(`${fenKey(fromFen)}|${san}`, { fromFen, toFen: chess.fen(), san });
		}
	}
	return [...rows.values()];
}

/** A PGN game from a SAN sequence, with the given result. */
function pgn(moves: string, result = '*', event = 'Rated Blitz game'): string {
	const chess = new Chess();
	for (const san of moves.split(' ')) chess.move(san);
	chess.setHeader('Event', event);
	chess.setHeader('Result', result);
	return chess.pgn();
}

let nextId = 1;
function game(
	moves: string,
	opts: Partial<Omit<ReportGameInput, 'pgn'>> & { event?: string } = {}
): ReportGameInput {
	const result = opts.result ?? null;
	return {
		id: opts.id ?? nextId++,
		pgn: pgn(moves, result ?? '*', opts.event),
		playerColor: opts.playerColor ?? 'WHITE',
		result,
		timeControl: opts.timeControl ?? '180+2',
		playedAt: opts.playedAt ?? null
	};
}

function classify(input: ReportGameInput, moves: RepertoireMoveRow[]): ClassifiedGame {
	const classified = classifyGame(input, indexRepertoire(moves, input.playerColor));
	if (!classified) throw new Error('game did not classify');
	return classified;
}

// White: 1.e4 e5 2.Nf3 Nc6 3.Bb5, and 2...d6 3.d4 against the Philidor.
const WHITE_REP = repertoire('e4 e5 Nf3 Nc6 Bb5', 'e4 e5 Nf3 d6 d4');
// Black: 1.e4 c5 2.Nf3 d6 against 1.e4, 1.d4 Nf6 against 1.d4.
const BLACK_REP = repertoire('e4 c5 Nf3 d6', 'd4 Nf6');

describe('speedOf', () => {
	it('classifies by estimated game length', () => {
		expect(speedOf('60+0')).toBe('bullet');
		expect(speedOf('120+1')).toBe('bullet');
		expect(speedOf('180+2')).toBe('blitz');
		expect(speedOf('600+0')).toBe('rapid');
		expect(speedOf('1800+0')).toBe('classical');
		expect(speedOf('1/86400')).toBe('daily');
		expect(speedOf('600')).toBe('rapid');
	});

	it('returns null for missing or unknown time controls', () => {
		expect(speedOf(null)).toBeNull();
		expect(speedOf('-')).toBeNull();
		expect(speedOf('abc')).toBeNull();
	});
});

describe('outcomeOf', () => {
	it('reads the result from the user side', () => {
		expect(outcomeOf('1-0', 'WHITE')).toBe('WIN');
		expect(outcomeOf('1-0', 'BLACK')).toBe('LOSS');
		expect(outcomeOf('0-1', 'BLACK')).toBe('WIN');
		expect(outcomeOf('1/2-1/2', 'WHITE')).toBe('DRAW');
		expect(outcomeOf('*', 'WHITE')).toBeNull();
		expect(outcomeOf(null, 'BLACK')).toBeNull();
	});
});

describe('splitPgn', () => {
	it('keeps only the mainline moves and reads the headers', () => {
		const { headers, sans } = splitPgn(
			'[Event "Rated Blitz game"]\n[White "a [b]"]\n\n' +
				'1. e4 { [%clk 0:03:00] } 1... e5 $1 2. Nf3!? (2. f4 exf4 (2... d5)) 2... Nc6 ; aside\n3. Bb5 1-0'
		);
		expect(headers).toMatchObject({ Event: 'Rated Blitz game', White: 'a [b]' });
		expect(sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
	});
});

describe('classifyGame', () => {
	it('finds a move the user played instead of their repertoire move', () => {
		const g = classify(game('e4 e5 Nf3 Nc6 Bc4 Bc5', { result: '0-1' }), WHITE_REP);
		expect(g).toMatchObject({
			exit: 'YOU_LEFT',
			depth: 4,
			playedSan: 'Bc4',
			repertoireSan: 'Bb5',
			outcome: 'LOSS',
			speed: 'blitz',
			rated: true
		});
		expect(g.bookFens).toHaveLength(5);
		expect(g.exitFen).toBe(g.bookFens[4]);
		expect(g.bookSans).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
	});

	it('finds an opponent move the repertoire does not cover', () => {
		const g = classify(game('e4 e5 Nf3 Nf6 Nxe5'), WHITE_REP);
		expect(g).toMatchObject({ exit: 'THEY_LEFT', depth: 3, playedSan: 'Nf6', repertoireSan: null });
	});

	it("counts an unprepared reply after a line's last move as the opponent leaving", () => {
		const g = classify(game('e4 e5 Nf3 Nc6 Bb5 a6 Ba4'), WHITE_REP);
		expect(g).toMatchObject({ exit: 'THEY_LEFT', depth: 5, playedSan: 'a6' });
	});

	it('reports PREP_ENDED when the user reaches a position with no move', () => {
		// Black repertoire covers 1.e4 c5 2.Nf3 d6 but has no move after 3.d4.
		const rep = repertoire('e4 c5 Nf3 d6 d4');
		const g = classify(game('e4 c5 Nf3 d6 d4 cxd4', { playerColor: 'BLACK' }), rep);
		expect(g).toMatchObject({ exit: 'PREP_ENDED', depth: 5, playedSan: 'cxd4' });
	});

	it('counts a game that ends inside the repertoire as in book', () => {
		const g = classify(game('e4 e5 Nf3 Nc6', { result: '1-0' }), WHITE_REP);
		expect(g).toMatchObject({ exit: 'IN_BOOK', depth: 4, exitFen: null, outcome: 'WIN' });
	});

	it('follows a transposition into the repertoire', () => {
		// 1.Nf3 Nc6 2.e4 e5 reaches the position after 2.Nf3 Nc6 by another order.
		const rep = repertoire('e4 e5 Nf3 Nc6 Bb5', 'Nf3 Nc6 e4 e5');
		const g = classify(game('Nf3 Nc6 e4 e5 Bb5'), rep);
		expect(g.exit).toBe('IN_BOOK');
	});

	it('stays in book when the PGN spells a move differently', () => {
		const input = {
			...game('e4'),
			pgn: '1. e4 e5 2. Ng1f3 Nc6 3. Bb5 *'
		};
		const g = classify(input, WHITE_REP);
		expect(g.exit).toBe('IN_BOOK');
		expect(g.bookSans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
	});

	it('ignores check marks when matching moves', () => {
		const rep = repertoire('e4 e5 Bc4 Nc6 Bxf7+');
		const input = { ...game('e4'), pgn: '1. e4 e5 2. Bc4 Nc6 3. Bxf7 Kxf7 *' };
		const g = classify(input, rep);
		expect(g).toMatchObject({ exit: 'THEY_LEFT', depth: 5, playedSan: 'Kxf7' });
	});

	it('skips games it cannot parse', () => {
		const bad: ReportGameInput = { ...game('e4'), pgn: 'not a game' };
		const index = indexRepertoire(WHITE_REP, 'WHITE');
		expect(classifyGame(bad, index)).toBeNull();
		const custom: ReportGameInput = {
			...game('e4'),
			pgn: '[SetUp "1"]\n[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n\n1. Kb1 *'
		};
		expect(classifyGame(custom, index)).toBeNull();
	});

	it('reads whether a game was rated from the Lichess event name', () => {
		expect(classify(game('e4', { event: 'Casual Rapid game' }), WHITE_REP).rated).toBe(false);
		expect(classify(game('e4', { event: 'Live Chess' }), WHITE_REP).rated).toBeNull();
	});
});

describe('classifyGame agrees with Review', () => {
	const KIND = {
		DEVIATION: 'YOU_LEFT',
		OPPONENT_SURPRISE: 'THEY_LEFT',
		BEYOND_REPERTOIRE: 'PREP_ENDED'
	};
	const cases: [string, 'WHITE' | 'BLACK', RepertoireMoveRow[]][] = [
		['e4 e5 Nf3 Nc6 Bc4 Bc5', 'WHITE', WHITE_REP],
		['e4 e5 Nf3 Nf6 Nxe5', 'WHITE', WHITE_REP],
		['e4 e5 Nf3 d6 d4 exd4', 'WHITE', WHITE_REP],
		['e4 e5 Nf3 Nc6', 'WHITE', WHITE_REP],
		['d4 d5', 'WHITE', WHITE_REP],
		['e4 c5 Nf3 d6 d4 cxd4', 'BLACK', BLACK_REP],
		['e4 c5 Nf3 Nc6', 'BLACK', BLACK_REP],
		['d4 Nf6 c4 e6', 'BLACK', BLACK_REP],
		['c4 e5', 'BLACK', BLACK_REP]
	];

	it.each(cases)('%s as %s', (moves, color, rep) => {
		const input = game(moves, { playerColor: color });
		const ours = classify(input, rep);
		const first = analyzeGame(parsePgn(input.pgn), rep, color).issues[0];
		expect(ours.exit).toBe(first ? KIND[first.type] : 'IN_BOOK');
		expect(ours.depth).toBe(first ? first.ply - 1 : moves.split(' ').length);
		expect(ours.exitFen).toBe(first ? fenKey(first.fromFen) : null);
	});
});

describe('isMatched and bestRepertoire', () => {
	it('drops a White game that left on move one but keeps a Black one', () => {
		expect(isMatched(classify(game('d4 d5'), WHITE_REP))).toBe(false);
		const black = classify(game('c4 e5', { playerColor: 'BLACK' }), BLACK_REP);
		expect(black.exit).toBe('THEY_LEFT');
		expect(isMatched(black)).toBe(true);
	});

	it('picks the repertoire the game stays in longest', () => {
		const e4 = { id: 1, index: indexRepertoire(WHITE_REP, 'WHITE') };
		const d4 = { id: 2, index: indexRepertoire(repertoire('d4 d5 c4'), 'WHITE') };
		const match = bestRepertoire(game('d4 d5 c4 e6'), [e4, d4]);
		expect(match?.repertoire.id).toBe(2);
		expect(match?.classified.depth).toBe(3);
	});
});

describe('topExits and groupByLine', () => {
	const games = [
		classify(game('e4 e5 Nf3 Nc6 Bc4', { result: '0-1' }), WHITE_REP),
		classify(game('e4 e5 Nf3 Nc6 Bc4', { result: '1/2-1/2' }), WHITE_REP),
		classify(game('e4 e5 Nf3 Nc6 d4', { result: '1-0' }), WHITE_REP),
		classify(game('e4 e5 Nf3 Nf6', { result: '0-1' }), WHITE_REP),
		classify(game('e4 e5 Nf3 d6 d4', { result: '1-0' }), WHITE_REP)
	];

	it('groups exits by position and move, most frequent first', () => {
		const exits = topExits(games);
		expect(exits.map((e) => [e.kind, e.playedSan, e.games])).toEqual([
			['YOU_LEFT', 'Bc4', 2],
			['THEY_LEFT', 'Nf6', 1],
			['YOU_LEFT', 'd4', 1]
		]);
		expect(exits[0]).toMatchObject({ losses: 1, draws: 1, score: 0.25, repertoireSan: 'Bb5' });
		expect(exits[0].gameIds).toEqual([games[0].id, games[1].id]);
		expect(exits[0].line).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
	});

	it('names each line from its deepest named position', () => {
		const afterNc6 = games[0].bookFens[4];
		const afterNf3 = games[0].bookFens[3];
		const afterE5 = games[0].bookFens[2];
		const names = new Map([
			[afterE5, "King's Pawn Game"],
			[afterNf3, "King's Knight Opening"],
			[afterNc6, "King's Knight Opening: Normal Variation"]
		]);
		const lines = groupByLine(games, names);
		expect(lines.map((l) => [l.name, l.games])).toEqual([
			["King's Knight Opening: Normal Variation", 3],
			["King's Knight Opening", 2]
		]);
		expect(lines[0]).toMatchObject({ wins: 1, draws: 1, losses: 1, score: 0.5 });
		expect(lines[0].topExit?.playedSan).toBe('Bc4');
		expect(lines[0]).toMatchObject({ fen: afterNc6, line: ['e4', 'e5', 'Nf3', 'Nc6'] });
		expect(lines[1]).toMatchObject({ fen: afterNf3, line: ['e4', 'e5', 'Nf3'] });
		// 3 plies before 2...Nf6, and 5 for the Philidor game that ended in book.
		expect(lines[1].averageDepth).toBe(4);
	});

	it('groups games with no named position together', () => {
		const lines = groupByLine(games, new Map());
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ name: null, games: 5, line: [] });
	});

	it('asks for a name for every book position except the start', () => {
		const fens = fensToName(games);
		expect(fens).toContain(games[0].bookFens[4]);
		expect(fens).not.toContain(games[0].bookFens[0]);
		expect(new Set(fens).size).toBe(fens.length);
	});
});

describe('linesTo', () => {
	it('finds the shortest line to each position the repertoire reaches', () => {
		// 1.e4 Nc6 2.Nf3 e5 transposes into the same position.
		const rep = repertoire('e4 e5 Nf3 Nc6 Bb5', 'e4 Nc6 Nf3 e5');
		const target = classify(game('e4 e5 Nf3 Nc6'), rep).bookFens[4];
		const lines = linesTo(rep, [target, 'not a position']);
		expect(lines.get(target)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
		expect(lines.has('not a position')).toBe(false);
	});
});

describe('memoryStats', () => {
	const now = new Date('2026-10-18T12:00:00Z');
	const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
	const cards = [
		{ id: 1, fromFen: 'a w - - 0 1', san: 'Nf3' },
		{ id: 2, fromFen: 'b w - - 0 1', san: 'Bb5' }
	];

	it('measures retention and finds the most forgotten cards', () => {
		const stats = memoryStats(
			[
				{ cardId: 1, rating: 1, reviewedAt: daysAgo(1) },
				{ cardId: 1, rating: 1, reviewedAt: daysAgo(2) },
				{ cardId: 1, rating: 3, reviewedAt: daysAgo(3) },
				{ cardId: 2, rating: 3, reviewedAt: daysAgo(10) },
				{ cardId: 2, rating: 1, reviewedAt: daysAgo(11) },
				// Outside the period, and a card that has since been deleted.
				{ cardId: 2, rating: 1, reviewedAt: daysAgo(40) },
				{ cardId: 9, rating: 1, reviewedAt: daysAgo(1) }
			],
			cards,
			now,
			4
		);
		expect(stats.grades).toBe(6);
		expect(stats.retention).toBeCloseTo(2 / 6);
		expect(stats.weekly).toHaveLength(4);
		expect(stats.weekly[3]).toMatchObject({ grades: 4, retention: 0.25 });
		expect(stats.weekly[2]).toMatchObject({ grades: 2, retention: 0.5 });
		expect(stats.weekly[0]).toMatchObject({ grades: 0, retention: null });
		expect(stats.forgotten.map((c) => [c.cardId, c.misses, c.grades])).toEqual([
			[1, 2, 3],
			[2, 1, 2]
		]);
		expect(stats.forgotten[0].fromFen).toBe('a w - -');
	});

	it('has no retention without grades', () => {
		expect(memoryStats([], cards, now, 2).retention).toBeNull();
	});
});

describe('pickFixNext', () => {
	const exit = (kind: 'YOU_LEFT' | 'THEY_LEFT' | 'PREP_ENDED', games: number, losses: number) => ({
		kind,
		fen: `${kind}-${games}-${losses}`,
		playedSan: 'x',
		repertoireSan: null,
		line: [],
		gameIds: [],
		games,
		wins: games - losses,
		draws: 0,
		losses,
		score: (games - losses) / games
	});
	const noMemory = memoryStats([], [], new Date(), 1);

	it('picks the exit that has cost the most points', () => {
		const pick = pickFixNext([exit('YOU_LEFT', 3, 1), exit('THEY_LEFT', 4, 3)], noMemory);
		expect(pick?.kind).toBe('PREPARE_REPLY');
	});

	it('ignores one-off exits and the end of the prep', () => {
		expect(pickFixNext([exit('YOU_LEFT', 1, 1), exit('PREP_ENDED', 9, 9)], noMemory)).toBeNull();
	});

	it('weighs a much-forgotten card against the exits', () => {
		const memory = {
			...noMemory,
			forgotten: [{ cardId: 7, fromFen: 'f', san: 'Nf3', misses: 6, grades: 8 }]
		};
		const pick = pickFixNext([exit('YOU_LEFT', 2, 1)], memory);
		expect(pick).toMatchObject({ kind: 'DRILL_CARD', card: { cardId: 7 } });
	});
});
