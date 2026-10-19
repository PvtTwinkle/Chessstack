// Opening Report: pure functions that turn a user's games and drill history
// into the report's sections (plans/opening-report-plan.md).
//
// Everything here is computed on read from data that already exists:
// imported and reviewed games, the repertoire's moves, and review_log. Nothing
// is stored, so editing the repertoire changes the report straight away. The
// caller loads the rows; these functions never touch the database.

import { Chess } from 'chess.js';
import { fenKey, STARTING_FEN, toFullFen } from '$lib/fen';
import type { RepertoireMoveRow } from '$lib/pgn';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlayerColor = 'WHITE' | 'BLACK';

/**
 * How a game left the repertoire:
 *   YOU_LEFT   — the user played a different move than their repertoire says.
 *   THEY_LEFT  — the opponent played a move the repertoire doesn't cover.
 *   PREP_ENDED — the user reached a position the repertoire has no move for.
 *   IN_BOOK    — the game ended without leaving the repertoire.
 */
export type ExitKind = 'YOU_LEFT' | 'THEY_LEFT' | 'PREP_ENDED' | 'IN_BOOK';

export type Outcome = 'WIN' | 'DRAW' | 'LOSS';

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily';

export interface ReportGameInput {
	id: number;
	pgn: string;
	playerColor: PlayerColor;
	result: string | null; // '1-0', '0-1', '1/2-1/2' or null
	timeControl: string | null; // e.g. "600+0", "1/86400"
	playedAt: Date | null;
}

export interface ClassifiedGame {
	id: number;
	playerColor: PlayerColor;
	outcome: Outcome | null; // null when the game has no result (aborted, ongoing)
	speed: Speed | null;
	rated: boolean | null; // null when the PGN doesn't say (Chess.com PGNs never do)
	playedAt: Date | null;
	depth: number; // plies played inside the repertoire
	exit: ExitKind;
	exitFen: string | null; // position the exit move was played from; null for IN_BOOK
	playedSan: string | null; // the move that left the repertoire
	repertoireSan: string | null; // what the repertoire expected (YOU_LEFT only)
	// fenKeys from the start position to the last in-book position, oldest
	// first. The report names a game's line from the deepest of these.
	bookFens: string[];
	bookSans: string[]; // the in-book moves, as the repertoire spells them
}

export interface ReviewLogInput {
	cardId: number;
	rating: number; // 1=Again, 3=Good, 4=Easy
	reviewedAt: Date;
}

export interface CardInput {
	id: number;
	fromFen: string;
	san: string;
}

/** A repertoire's moves keyed by position, built once per report. */
export interface RepertoireIndex {
	userTurn: 'w' | 'b';
	userMove: Map<string, string>; // fenKey → the user's move there
	// `${fenKey}|${san}` → the move and the fenKey after it, for every prepared
	// move on either side, so walking a game through book needs no move generation.
	edges: Map<string, { san: string; toFen: string }>;
}

// Check marks are left out of the edge keys: a PGN from another site may
// write them differently, and they never tell two moves apart.
const edgeKey = (fen: string, san: string) => `${fen}|${san.replace(/[+#]$/, '')}`;

export function indexRepertoire(moves: RepertoireMoveRow[], color: PlayerColor): RepertoireIndex {
	const userTurn = color === 'WHITE' ? 'w' : 'b';
	const index: RepertoireIndex = { userTurn, userMove: new Map(), edges: new Map() };
	const isUserTurn = (fen: string) => fen.split(' ')[1] === userTurn;
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		if (isUserTurn(key)) index.userMove.set(key, m.san);
	}
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		// Only the user's one move per position is book, as in analyzeGame.
		if (isUserTurn(key) && index.userMove.get(key) !== m.san) continue;
		index.edges.set(edgeKey(key, m.san), { san: m.san, toFen: fenKey(m.toFen) });
	}
	return index;
}

// ─── Game classification ─────────────────────────────────────────────────────

/**
 * Map a time control to the speed classes Lichess uses, from the estimated
 * game length (base + 40 × increment). Chess.com draws its lines slightly
 * differently, but one scale keeps the filter consistent across both sites.
 */
export function speedOf(timeControl: string | null): Speed | null {
	if (!timeControl || timeControl === '-') return null;
	// Chess.com daily games: "1/86400" (one move per N seconds).
	if (timeControl.includes('/')) return 'daily';
	const [base, increment = '0', ...rest] = timeControl.trim().split('+');
	if (rest.length || !/^\d+$/.test(base) || !/^\d+$/.test(increment)) return null;
	const estimate = Number(base) + 40 * Number(increment);
	if (estimate < 180) return 'bullet';
	if (estimate < 480) return 'blitz';
	if (estimate < 1500) return 'rapid';
	return 'classical';
}

/** The game's result from the user's side. */
export function outcomeOf(result: string | null, playerColor: PlayerColor): Outcome | null {
	if (result === '1/2-1/2') return 'DRAW';
	if (result === '1-0') return playerColor === 'WHITE' ? 'WIN' : 'LOSS';
	if (result === '0-1') return playerColor === 'BLACK' ? 'WIN' : 'LOSS';
	return null;
}

/** Lichess names its events "Rated Blitz game" or "Casual Rapid game". */
export function ratedOf(headers: Record<string, string>): boolean | null {
	const event = headers.Event ?? '';
	if (/^rated\b/i.test(event)) return true;
	if (/^casual\b/i.test(event)) return false;
	return null;
}

// A tag pair like [Event "Club [A] champs"]; the value may contain `]`.
const HEADER_TAG = /\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g;

/**
 * Split a single-game PGN into its header tags and mainline SAN moves,
 * dropping comments (Lichess adds a clock comment to every move), variations,
 * NAGs, move numbers and the result.
 */
export function splitPgn(pgn: string): { headers: Record<string, string>; sans: string[] } {
	const headers: Record<string, string> = {};
	const movetext = pgn
		.replace(/\{[^}]*\}/g, ' ')
		.replace(HEADER_TAG, (_m, tag: string, value: string) => {
			headers[tag] = value;
			return ' ';
		})
		.replace(/;[^\n]*/g, ' ');

	const sans: string[] = [];
	let depth = 0;
	for (const raw of movetext.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').split(/\s+/)) {
		if (raw === '(') depth++;
		else if (raw === ')') depth = Math.max(0, depth - 1);
		else if (depth > 0 || !raw) continue;
		else {
			const san = raw.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
			if (!san || san.startsWith('$') || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(san)) continue;
			sans.push(san);
		}
	}
	return { headers, sans };
}

/**
 * Walk one game through a repertoire and record where it left book, with the
 * same rules as Review's analyzeGame. In book it follows the repertoire's own
 * stored positions, and chess.js replays only the move that leaves: parsing
 * every game in full made a 500-game report take seconds.
 *
 * Returns null for a game that can't be read (custom start, an illegal move
 * at the exit), which the report skips rather than failing the page.
 */
export function classifyGame(game: ReportGameInput, index: RepertoireIndex): ClassifiedGame | null {
	const { headers, sans } = splitPgn(game.pgn);
	if (headers.SetUp === '1' || sans.length === 0) return null;

	const bookFens = [fenKey(STARTING_FEN)];
	const bookSans: string[] = [];
	let exit: ExitKind = 'IN_BOOK';
	let exitFen: string | null = null;
	let playedSan: string | null = null;
	let repertoireSan: string | null = null;

	for (const raw of sans) {
		const fen = bookFens[bookFens.length - 1];
		let next = index.edges.get(edgeKey(fen, raw));
		let san = raw;
		if (!next) {
			// Not a prepared move as written. Spell it the way chess.js does
			// (as the repertoire was stored) before deciding it left book.
			try {
				san = new Chess(toFullFen(fen)).move(raw).san;
			} catch {
				return null;
			}
			next = index.edges.get(edgeKey(fen, san));
		}
		if (next) {
			bookFens.push(next.toFen);
			bookSans.push(next.san);
			continue;
		}

		exitFen = fen;
		playedSan = san;
		if (fen.split(' ')[1] !== index.userTurn) exit = 'THEY_LEFT';
		else {
			repertoireSan = index.userMove.get(fen) ?? null;
			exit = repertoireSan ? 'YOU_LEFT' : 'PREP_ENDED';
		}
		break;
	}

	return {
		id: game.id,
		playerColor: game.playerColor,
		outcome: outcomeOf(game.result, game.playerColor),
		speed: speedOf(game.timeControl),
		rated: ratedOf(headers),
		playedAt: game.playedAt,
		depth: bookFens.length - 1,
		exit,
		exitFen,
		playedSan,
		repertoireSan,
		bookFens,
		bookSans
	};
}

/**
 * Whether a classified game belongs in a repertoire's report at all. A White
 * game that leaves on move one was a different opening (likely another
 * repertoire, or a one-off), not a gap in this one. For Black, the opponent's
 * unprepared first move is real information, so it stays.
 */
export function isMatched(game: ClassifiedGame): boolean {
	return !(game.depth === 0 && game.playerColor === 'WHITE');
}

/**
 * Pick the repertoire a game belongs to: the one it stays in book longest,
 * like Review's repertoire picker. Ties go to the earliest repertoire listed.
 */
export function bestRepertoire<T extends { id: number; index: RepertoireIndex }>(
	game: ReportGameInput,
	repertoires: T[]
): { repertoire: T; classified: ClassifiedGame } | null {
	let best: { repertoire: T; classified: ClassifiedGame } | null = null;
	for (const repertoire of repertoires) {
		const classified = classifyGame(game, repertoire.index);
		if (!classified) return null; // unparseable for every repertoire alike
		if (!best || classified.depth > best.classified.depth) best = { repertoire, classified };
	}
	return best;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export interface Score {
	games: number;
	wins: number;
	draws: number;
	losses: number;
	// Points per scored game, 0 to 1. Null when no game has a result.
	score: number | null;
}

function emptyScore(): Score {
	return { games: 0, wins: 0, draws: 0, losses: 0, score: null };
}

function addGame(s: Score, outcome: Outcome | null): void {
	s.games++;
	if (outcome === 'WIN') s.wins++;
	else if (outcome === 'DRAW') s.draws++;
	else if (outcome === 'LOSS') s.losses++;
	const scored = s.wins + s.draws + s.losses;
	s.score = scored ? (s.wins + s.draws / 2) / scored : null;
}

/** Points the user dropped in these games: a loss costs 1, a draw ½. */
export function pointsLost(s: Score): number {
	return s.losses + s.draws / 2;
}

export interface ExitSummary extends Score {
	kind: Exclude<ExitKind, 'IN_BOOK'>;
	fen: string;
	playedSan: string;
	repertoireSan: string | null;
	line: string[]; // moves from the start to `fen`, for links into Build
	gameIds: number[];
}

/**
 * The positions where games most often leave book. YOU_LEFT exits group by the
 * move the user played instead, so "6...e5 instead of 6...Ng4" and
 * "6...Nc6 instead of 6...Ng4" are separate mistakes.
 */
export function topExits(games: ClassifiedGame[]): ExitSummary[] {
	const byKey = new Map<string, ExitSummary>();
	for (const g of games) {
		if (g.exit === 'IN_BOOK' || !g.exitFen || !g.playedSan) continue;
		const key = `${g.exit}|${g.exitFen}|${g.playedSan}`;
		let summary = byKey.get(key);
		if (!summary) {
			summary = {
				...emptyScore(),
				kind: g.exit,
				fen: g.exitFen,
				playedSan: g.playedSan,
				repertoireSan: g.repertoireSan,
				line: g.bookSans,
				gameIds: []
			};
			byKey.set(key, summary);
		}
		addGame(summary, g.outcome);
		summary.gameIds.push(g.id);
	}
	return [...byKey.values()].sort(
		(a, b) => b.games - a.games || pointsLost(b) - pointsLost(a) || a.fen.localeCompare(b.fen)
	);
}

export interface LineSummary extends Score {
	name: string | null; // null when no position in the line has an ECO name
	// The named position and the moves to it (from the first game reaching it),
	// for the Drill and Build links. The start position when unnamed.
	fen: string;
	line: string[];
	averageDepth: number; // plies in book
	topExit: ExitSummary | null;
}

/**
 * Group games by the name of the deepest named position they reached in book.
 * `names` maps fenKey to an opening name (from eco_opening); the caller loads
 * it for every FEN in the games' bookFens.
 */
export function groupByLine(
	games: ClassifiedGame[],
	names: ReadonlyMap<string, string>
): LineSummary[] {
	const groups = new Map<string | null, { fen: string; line: string[]; games: ClassifiedGame[] }>();
	for (const g of games) {
		let name: string | null = null;
		let at = 0;
		for (let i = g.bookFens.length - 1; i > 0; i--) {
			const found = names.get(g.bookFens[i]);
			if (found) {
				name = found;
				at = i;
				break;
			}
		}
		const group = groups.get(name);
		if (group) group.games.push(g);
		else groups.set(name, { fen: g.bookFens[at], line: g.bookSans.slice(0, at), games: [g] });
	}

	const lines: LineSummary[] = [];
	for (const [name, { fen, line, games: group }] of groups) {
		const score = emptyScore();
		let depthTotal = 0;
		for (const g of group) {
			addGame(score, g.outcome);
			depthTotal += g.depth;
		}
		lines.push({
			...score,
			name,
			fen,
			line,
			averageDepth: depthTotal / group.length,
			topExit: topExits(group)[0] ?? null
		});
	}
	return lines.sort((a, b) => b.games - a.games || (a.name ?? '').localeCompare(b.name ?? ''));
}

/** Every FEN the report needs a name for, for one eco_opening query. */
export function fensToName(games: ClassifiedGame[]): string[] {
	const fens = new Set<string>();
	for (const g of games) for (const fen of g.bookFens) fens.add(fen);
	fens.delete(fenKey(STARTING_FEN));
	return [...fens];
}

/**
 * The shortest move sequence from the start to each target position through
 * a repertoire, for naming a drill card's move ("6...e5") and linking it into
 * Build. Targets the repertoire can't reach from the start are left out.
 */
export function linesTo(
	moves: RepertoireMoveRow[],
	targets: Iterable<string>
): Map<string, string[]> {
	const wanted = new Set([...targets].map(fenKey));
	const next = new Map<string, { san: string; toFen: string }[]>();
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		const list = next.get(key);
		const edge = { san: m.san, toFen: fenKey(m.toFen) };
		if (list) list.push(edge);
		else next.set(key, [edge]);
	}

	const found = new Map<string, string[]>();
	const start = fenKey(STARTING_FEN);
	const seen = new Map<string, string[]>([[start, []]]);
	const queue = [start];
	for (let i = 0; i < queue.length && found.size < wanted.size; i++) {
		const fen = queue[i];
		const line = seen.get(fen)!;
		if (wanted.has(fen)) found.set(fen, line);
		for (const edge of next.get(fen) ?? []) {
			if (seen.has(edge.toFen)) continue;
			seen.set(edge.toFen, [...line, edge.san]);
			queue.push(edge.toFen);
		}
	}
	return found;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

const AGAIN = 1;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ForgottenCard {
	cardId: number;
	fromFen: string;
	san: string;
	misses: number; // Again grades in the period
	grades: number;
}

export interface MemoryStats {
	grades: number;
	// Share of grades that weren't Again, 0 to 1. Null with no grades.
	retention: number | null;
	// One entry per week, oldest first, ending with the week containing `now`.
	weekly: { weekStart: Date; grades: number; retention: number | null }[];
	forgotten: ForgottenCard[];
}

/**
 * Retention and the most-forgotten cards over a period of review_log rows.
 * Deviations found in Review are logged as Again, so a move forgotten over the
 * board counts the same as one forgotten in a drill.
 */
export function memoryStats(
	logs: ReviewLogInput[],
	cards: CardInput[],
	now: Date,
	weeks: number
): MemoryStats {
	const start = now.getTime() - weeks * WEEK_MS;
	const weekly = Array.from({ length: weeks }, (_, i) => ({
		weekStart: new Date(start + i * WEEK_MS),
		grades: 0,
		misses: 0
	}));
	const cardById = new Map(cards.map((c) => [c.id, c]));
	const perCard = new Map<number, { misses: number; grades: number }>();
	let grades = 0;
	let misses = 0;

	for (const log of logs) {
		const t = log.reviewedAt.getTime();
		if (t < start || t > now.getTime()) continue;
		const missed = log.rating === AGAIN;
		grades++;
		if (missed) misses++;
		const week = weekly[Math.min(weeks - 1, Math.floor((t - start) / WEEK_MS))];
		week.grades++;
		if (missed) week.misses++;
		const c = perCard.get(log.cardId) ?? { misses: 0, grades: 0 };
		c.grades++;
		if (missed) c.misses++;
		perCard.set(log.cardId, c);
	}

	const forgotten: ForgottenCard[] = [];
	for (const [cardId, c] of perCard) {
		const card = cardById.get(cardId);
		// A card deleted since its grades has nowhere to send the user.
		if (!card || c.misses === 0) continue;
		forgotten.push({ cardId, fromFen: fenKey(card.fromFen), san: card.san, ...c });
	}
	forgotten.sort((a, b) => b.misses - a.misses || b.grades - a.grades || a.cardId - b.cardId);

	return {
		grades,
		retention: grades ? (grades - misses) / grades : null,
		weekly: weekly.map((w) => ({
			weekStart: w.weekStart,
			grades: w.grades,
			retention: w.grades ? (w.grades - w.misses) / w.grades : null
		})),
		forgotten
	};
}

// ─── Fix this next ───────────────────────────────────────────────────────────

// Below this many games an exit is as likely to be noise as a pattern.
export const MIN_EXIT_GAMES = 2;
// A move missed twice in drills is a real gap but costs no points by itself;
// half a point per miss ranks it against a line that is losing games.
const POINTS_PER_MISS = 0.5;
const MIN_MISSES = 2;

export type FixNext =
	| { kind: 'DRILL_EXIT'; weight: number; exit: ExitSummary }
	| { kind: 'PREPARE_REPLY'; weight: number; exit: ExitSummary }
	| { kind: 'DRILL_CARD'; weight: number; card: ForgottenCard };

/**
 * The single most useful thing to work on: the exit or forgotten card that has
 * cost the most. A YOU_LEFT exit is fixed by drilling the move, a THEY_LEFT
 * exit by preparing a reply in Build. PREP_ENDED exits aren't candidates: the
 * prep ending is expected somewhere, and the Lines section shows how deep it
 * goes.
 */
export function pickFixNext(exits: ExitSummary[], memory: MemoryStats): FixNext | null {
	const candidates: FixNext[] = [];
	for (const exit of exits) {
		if (exit.games < MIN_EXIT_GAMES) continue;
		// A user who keeps deviating but keeps winning still has a gap to close,
		// so every game counts a little on top of the points lost.
		const weight = pointsLost(exit) + exit.games * 0.1;
		if (exit.kind === 'YOU_LEFT') candidates.push({ kind: 'DRILL_EXIT', weight, exit });
		else if (exit.kind === 'THEY_LEFT') candidates.push({ kind: 'PREPARE_REPLY', weight, exit });
	}
	for (const card of memory.forgotten) {
		if (card.misses < MIN_MISSES) continue;
		candidates.push({ kind: 'DRILL_CARD', weight: card.misses * POINTS_PER_MISS, card });
	}
	candidates.sort((a, b) => b.weight - a.weight);
	return candidates[0] ?? null;
}
