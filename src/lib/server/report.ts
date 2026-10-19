// Loads the rows behind the Opening Report and runs them through
// $lib/report. The report is computed on every load (no table of its own),
// so it is always current with the repertoire; the game cap keeps that cheap.

import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	ecoOpening,
	importedGame,
	reviewLog,
	reviewedGame,
	userMove,
	userRepertoireMove
} from '$lib/db/schema';
import {
	bestRepertoire,
	fensToName,
	groupByLine,
	indexRepertoire,
	isMatched,
	linesTo,
	memoryStats,
	pickFixNext,
	splitPgn,
	topExits,
	type ClassifiedGame,
	type ExitSummary,
	type ForgottenCard,
	type LineSummary,
	type Outcome,
	type PlayerColor,
	type ReportGameInput,
	type Speed
} from '$lib/report';
import {
	REPORT_GAME_LIMIT,
	parseReportFilters,
	type Period,
	type ReportFilters
} from '$lib/report/filters';

/** Exits listed per kind ("you left", "they left", "prep ended"). */
const EXITS_PER_KIND = 5;
/** Games linked under each exit. */
const GAMES_PER_EXIT = 5;
/** Most-forgotten moves listed in the memory section. */
const FORGOTTEN_SHOWN = 5;
// "All time" memory covers the last year: older grades say little about now.
const MEMORY_WEEKS: Record<Period, number> = { '30': 5, '90': 13, all: 52 };
// eco_opening lookups go in chunks so one query never carries thousands of parameters.
const NAME_CHUNK = 1000;

/** What the page shows for a game linked under an exit. */
export interface ReportGameLink {
	id: number;
	importedGameId: number | null; // null for a pasted game, which Review can't reopen
	opponentName: string | null;
	playedAt: Date | null;
	outcome: Outcome | null;
}

export interface ReportExit extends Omit<ExitSummary, 'gameIds'> {
	links: ReportGameLink[];
}

export interface ReportForgotten extends ForgottenCard {
	line: string[] | null; // moves to the card's position; null when unreachable from the start
}

export type ReportFixNext =
	| { kind: 'DRILL_EXIT' | 'PREPARE_REPLY'; exit: ExitSummary }
	| { kind: 'DRILL_CARD'; card: ReportForgotten };

export interface OpeningReport {
	fixNext: ReportFixNext | null;
	memory: {
		weeks: number;
		grades: number;
		retention: number | null;
		weekly: { weekStart: Date; grades: number; retention: number | null }[];
		forgotten: ReportForgotten[];
	};
	lines: LineSummary[];
	exits: Record<'YOU_LEFT' | 'THEY_LEFT' | 'PREP_ENDED', ReportExit[]>;
	totals: {
		games: number; // in this repertoire, after the filters
		wins: number;
		draws: number;
		losses: number;
		averageDepth: number | null; // plies in book
		otherRepertoire: number; // games of this color that belong to another repertoire
		capped: boolean; // true when more games exist than REPORT_GAME_LIMIT
	};
}

interface GameMeta {
	input: ReportGameInput;
	importedGameId: number | null;
	opponentName: string | null;
}

function since(period: Period, now: Date): Date | null {
	if (period === 'all') return null;
	return new Date(now.getTime() - Number(period) * 24 * 60 * 60 * 1000);
}

/** The newest imported games and pasted reviews of one color, newest first. */
async function loadGames(
	userId: number,
	color: PlayerColor,
	repertoireIds: number[],
	from: Date | null
): Promise<{ games: GameMeta[]; capped: boolean }> {
	const importedRows = await db
		.select({
			id: importedGame.id,
			pgn: importedGame.pgn,
			result: importedGame.result,
			timeControl: importedGame.timeControl,
			playedAt: importedGame.playedAt,
			opponentName: importedGame.opponentName
		})
		.from(importedGame)
		.where(
			and(
				eq(importedGame.userId, userId),
				eq(importedGame.playerColor, color),
				from ? gte(importedGame.playedAt, from) : undefined
			)
		)
		.orderBy(sql`${importedGame.playedAt} DESC NULLS LAST`, desc(importedGame.id))
		.limit(REPORT_GAME_LIMIT + 1);

	// Reviews of imported games are already counted above; only pasted games
	// (source MANUAL) add new ones. Their color is the repertoire's.
	const playedOrReviewed = sql`coalesce(${reviewedGame.playedAt}, ${reviewedGame.reviewedAt})`;
	const manualRows = repertoireIds.length
		? await db
				.select({
					id: reviewedGame.id,
					pgn: reviewedGame.pgn,
					playedAt: reviewedGame.playedAt,
					reviewedAt: reviewedGame.reviewedAt
				})
				.from(reviewedGame)
				.where(
					and(
						eq(reviewedGame.userId, userId),
						eq(reviewedGame.source, 'MANUAL'),
						inArray(reviewedGame.repertoireId, repertoireIds),
						from
							? or(
									gte(reviewedGame.playedAt, from),
									and(isNull(reviewedGame.playedAt), gte(reviewedGame.reviewedAt, from))
								)
							: undefined
					)
				)
				.orderBy(desc(playedOrReviewed), desc(reviewedGame.id))
				.limit(REPORT_GAME_LIMIT + 1)
		: [];

	// Each source gets its own id range, since the two tables' ids overlap.
	const games: GameMeta[] = [
		...importedRows.map((r, i) => ({
			input: {
				id: i,
				pgn: r.pgn,
				playerColor: color,
				result: r.result,
				timeControl: r.timeControl,
				playedAt: r.playedAt
			},
			importedGameId: r.id,
			opponentName: r.opponentName
		})),
		...manualRows.map((r, i) => {
			const { headers } = splitPgn(r.pgn);
			const opponent = color === 'WHITE' ? headers.Black : headers.White;
			return {
				input: {
					id: importedRows.length + i,
					pgn: r.pgn,
					playerColor: color,
					result: headers.Result ?? null,
					timeControl: headers.TimeControl ?? null,
					playedAt: r.playedAt ?? r.reviewedAt
				},
				importedGameId: null,
				opponentName: opponent && opponent !== '?' ? opponent : null
			};
		})
	];
	games.sort((a, b) => (b.input.playedAt?.getTime() ?? 0) - (a.input.playedAt?.getTime() ?? 0));
	return {
		games: games.slice(0, REPORT_GAME_LIMIT),
		capped: games.length > REPORT_GAME_LIMIT
	};
}

async function loadNames(fens: string[]): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	for (let i = 0; i < fens.length; i += NAME_CHUNK) {
		const rows = await db
			.select({ fen: ecoOpening.fen, name: ecoOpening.name })
			.from(ecoOpening)
			.where(inArray(ecoOpening.fen, fens.slice(i, i + NAME_CHUNK)));
		for (const r of rows) names.set(r.fen, r.name);
	}
	return names;
}

function matchesFilters(g: ClassifiedGame, filters: ReportFilters): boolean {
	if (filters.speed !== 'all' && g.speed !== (filters.speed as Speed)) return false;
	// Chess.com PGNs don't say whether a game was rated, so those games stay in.
	if (filters.ratedOnly && g.rated === false) return false;
	return true;
}

/**
 * The report for one repertoire. `sameColor` is every unlocked repertoire of
 * its color (including it): each game goes to the one it stays in book
 * longest, so a 1.d4 game doesn't show up as a gap in a 1.e4 repertoire.
 */
export async function loadOpeningReport(
	userId: number,
	repertoireId: number,
	color: PlayerColor,
	sameColor: number[],
	filters: ReportFilters,
	now = new Date()
): Promise<OpeningReport> {
	const ids = sameColor.includes(repertoireId) ? sameColor : [repertoireId, ...sameColor];
	const weeks = MEMORY_WEEKS[filters.period];
	const memoryFrom = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
	const [moves, { games, capped }, cards, logs] = await Promise.all([
		db
			.select({
				repertoireId: userMove.repertoireId,
				fromFen: userMove.fromFen,
				toFen: userMove.toFen,
				san: userMove.san
			})
			.from(userMove)
			.where(and(eq(userMove.userId, userId), inArray(userMove.repertoireId, ids))),
		loadGames(userId, color, ids, since(filters.period, now)),
		db
			.select({
				id: userRepertoireMove.id,
				fromFen: userRepertoireMove.fromFen,
				san: userRepertoireMove.san
			})
			.from(userRepertoireMove)
			.where(
				and(
					eq(userRepertoireMove.userId, userId),
					eq(userRepertoireMove.repertoireId, repertoireId)
				)
			),
		db
			.select({
				cardId: reviewLog.cardId,
				rating: reviewLog.rating,
				reviewedAt: reviewLog.reviewedAt
			})
			.from(reviewLog)
			.innerJoin(userRepertoireMove, eq(reviewLog.cardId, userRepertoireMove.id))
			.where(
				and(
					eq(reviewLog.userId, userId),
					eq(userRepertoireMove.repertoireId, repertoireId),
					gte(reviewLog.reviewedAt, memoryFrom)
				)
			)
	]);

	const repertoires = ids.map((id) => ({
		id,
		index: indexRepertoire(
			moves.filter((m) => m.repertoireId === id),
			color
		)
	}));

	const classified: ClassifiedGame[] = [];
	let otherRepertoire = 0;
	for (const game of games) {
		const match = bestRepertoire(game.input, repertoires);
		if (!match || !isMatched(match.classified)) continue;
		if (!matchesFilters(match.classified, filters)) continue;
		if (match.repertoire.id === repertoireId) classified.push(match.classified);
		else otherRepertoire++;
	}

	const names = await loadNames(fensToName(classified));
	const byId = new Map(games.map((g) => [g.input.id, g]));
	const outcomeById = new Map(classified.map((g) => [g.id, g.outcome]));

	const exits: OpeningReport['exits'] = { YOU_LEFT: [], THEY_LEFT: [], PREP_ENDED: [] };
	const allExits = topExits(classified);
	for (const exit of allExits) {
		const list = exits[exit.kind];
		if (list.length >= EXITS_PER_KIND) continue;
		const { gameIds, ...rest } = exit;
		list.push({
			...rest,
			links: gameIds.slice(0, GAMES_PER_EXIT).map((id) => {
				const meta = byId.get(id)!;
				return {
					id,
					importedGameId: meta.importedGameId,
					opponentName: meta.opponentName,
					playedAt: meta.input.playedAt,
					outcome: outcomeById.get(id) ?? null
				};
			})
		});
	}

	const memory = memoryStats(logs, cards, now, weeks);
	const ownMoves = moves.filter((m) => m.repertoireId === repertoireId);
	const forgotten = memory.forgotten.slice(0, FORGOTTEN_SHOWN);
	const fix = pickFixNext(allExits, memory);
	const cardLines = linesTo(ownMoves, [
		...forgotten.map((c) => c.fromFen),
		...(fix?.kind === 'DRILL_CARD' ? [fix.card.fromFen] : [])
	]);
	const withLine = (c: ForgottenCard): ReportForgotten => ({
		...c,
		line: cardLines.get(c.fromFen) ?? null
	});
	let fixNext: ReportFixNext | null = null;
	if (fix?.kind === 'DRILL_CARD') fixNext = { kind: 'DRILL_CARD', card: withLine(fix.card) };
	else if (fix) fixNext = { kind: fix.kind, exit: fix.exit };

	const totals = { wins: 0, draws: 0, losses: 0, depth: 0 };
	for (const g of classified) {
		if (g.outcome === 'WIN') totals.wins++;
		else if (g.outcome === 'DRAW') totals.draws++;
		else if (g.outcome === 'LOSS') totals.losses++;
		totals.depth += g.depth;
	}

	return {
		fixNext,
		memory: {
			weeks,
			grades: memory.grades,
			retention: memory.retention,
			weekly: memory.weekly,
			forgotten: forgotten.map(withLine)
		},
		lines: groupByLine(classified, names),
		exits,
		totals: {
			games: classified.length,
			wins: totals.wins,
			draws: totals.draws,
			losses: totals.losses,
			averageDepth: classified.length ? totals.depth / classified.length : null,
			otherRepertoire,
			capped
		}
	};
}

/**
 * The repertoires a game of this color could belong to: the user's unlocked
 * ones of that color. Games are matched against all of them so a game from
 * another repertoire isn't scored as a quick exit from this one.
 */
export function sameColorRepertoires(
	repertoires: { id: number; color: string }[],
	color: PlayerColor,
	lockedIds: number[]
): number[] {
	return repertoires.filter((r) => r.color === color && !lockedIds.includes(r.id)).map((r) => r.id);
}

/** What the dashboard's report tile shows, from the report's default filters. */
export interface ReportSummary {
	fixNext: ReportFixNext | null;
	weeks: number;
	grades: number;
	retention: number | null;
	games: number;
}

export async function loadReportSummary(
	userId: number,
	repertoireId: number,
	color: PlayerColor,
	sameColor: number[],
	now = new Date()
): Promise<ReportSummary> {
	const report = await loadOpeningReport(
		userId,
		repertoireId,
		color,
		sameColor,
		parseReportFilters(new URLSearchParams()),
		now
	);
	return {
		fixNext: report.fixNext,
		weeks: report.memory.weeks,
		grades: report.memory.grades,
		retention: report.memory.retention,
		games: report.totals.games
	};
}
