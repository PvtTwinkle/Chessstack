// Chess.com Published Data API client — fetches recent games for a user.
//
// Two-step process:
//   1. GET /pub/player/{username}/games/archives → list of monthly archive URLs
//   2. GET each relevant archive URL → array of games with full PGN
//
// Rate limits: serial access unlimited; parallel may trigger 429.
// We fetch archives sequentially with a 1-second delay between requests.
// User-Agent header is required per Chess.com API policy.

import { log } from '$lib/server/log';

const CHESSCOM_API_BASE = 'https://api.chess.com';
const USER_AGENT = 'Chessstack/1.0 (https://github.com/PvtTwinkle/Chessstack)';
const DELAY_BETWEEN_ARCHIVES_MS = 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChesscomGame {
	id: string; // Chess.com game URL (unique identifier)
	pgn: string; // full PGN (provided directly by the API)
	playerColor: 'WHITE' | 'BLACK';
	opponentName: string | null;
	opponentRating: number | null;
	playerRating: number | null;
	timeControl: string | null; // e.g. "600", "180+2"
	result: string | null; // '1-0', '0-1', '1/2-1/2'
	playedAt: Date | null;
}

export class ChesscomApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public retryAfter?: number
	) {
		super(message);
		this.name = 'ChesscomApiError';
	}
}

// ── Raw API response types (internal) ────────────────────────────────────────

interface ChesscomArchivesResponse {
	archives: string[]; // e.g. ["https://api.chess.com/pub/player/user/games/2024/01", ...]
}

interface ChesscomPlayerInfo {
	username: string;
	rating: number;
	result: string; // "win", "checkmated", "timeout", "resigned", "stalemate", "agreed", "repetition", "insufficient", "50move", "abandoned", "timevsinsufficient"
}

interface ChesscomRawGame {
	url: string; // e.g. "https://www.chess.com/game/live/12345678"
	pgn: string;
	time_control: string; // e.g. "600", "180+2"
	end_time: number; // Unix timestamp (seconds)
	rated: boolean;
	time_class: string; // "bullet", "blitz", "rapid", "daily"
	rules: string; // "chess" for standard
	white: ChesscomPlayerInfo;
	black: ChesscomPlayerInfo;
}

interface ChesscomGamesResponse {
	games: ChesscomRawGame[];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch recent games for a Chess.com user.
 *
 * @param username - Chess.com username (case-insensitive)
 * @param options.since - Only fetch games played after this date
 * @param options.max - Maximum number of games to return (default 50)
 */
export async function fetchChesscomGames(
	username: string,
	options: { since?: Date; max?: number } = {}
): Promise<ChesscomGame[]> {
	const max = options.max ?? 50;

	// Step 1: Get the list of monthly archive URLs.
	const archiveUrls = await fetchArchiveList(username);

	log.info('Chess.com archives found', { username, archives: archiveUrls.length });

	if (archiveUrls.length === 0) {
		return [];
	}

	// Filter to only relevant archives (from the watermark month onward,
	// or the last 3 months if no watermark).
	const relevantArchives = filterArchives(archiveUrls, options.since);

	log.info('Chess.com archives after date filter', {
		archives: relevantArchives.length,
		since: options.since?.toISOString() ?? null
	});

	// Step 2: Fetch each archive sequentially (newest first for better UX).
	const allGames: ChesscomGame[] = [];
	let archiveErrors = 0;

	for (let i = relevantArchives.length - 1; i >= 0; i--) {
		const archiveUrl = relevantArchives[i];

		if (allGames.length >= max) break;

		const games = await fetchArchiveGames(archiveUrl, username, options.since);
		if (games === null) {
			archiveErrors++;
		} else {
			allGames.push(...games);
		}

		// Delay between archive fetches to be polite.
		if (i > 0) {
			await sleep(DELAY_BETWEEN_ARCHIVES_MS);
		}
	}

	// If every archive failed and we got 0 games, surface the error instead
	// of silently returning an empty array that looks like "no games exist."
	if (allGames.length === 0 && archiveErrors > 0) {
		throw new ChesscomApiError(
			`Chess.com returned errors for ${archiveErrors} archive(s). The API may be temporarily unavailable.`,
			502
		);
	}

	// Sort by playedAt ascending (oldest first) so the watermark advances monotonically,
	// then trim to max.
	allGames.sort((a, b) => (a.playedAt?.getTime() ?? 0) - (b.playedAt?.getTime() ?? 0));
	return allGames.slice(0, max);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function fetchArchiveList(username: string): Promise<string[]> {
	const url = `${CHESSCOM_API_BASE}/pub/player/${encodeURIComponent(username)}/games/archives`;
	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

	if (res.status === 404) {
		throw new ChesscomApiError(`Chess.com user "${username}" not found`, 404);
	}
	if (res.status === 429) {
		throw new ChesscomApiError('Chess.com rate limit exceeded. Try again later.', 429);
	}
	if (!res.ok) {
		throw new ChesscomApiError(`Chess.com API error: ${res.status} ${res.statusText}`, res.status);
	}

	const data = (await res.json()) as ChesscomArchivesResponse;
	return data.archives ?? [];
}

/**
 * Filter archive URLs to those relevant for the import.
 * Each URL ends with /YYYY/MM — we parse that to compare dates.
 */
function filterArchives(urls: string[], since?: Date): string[] {
	if (!since) {
		// No watermark: fetch the last 3 months of archives.
		return urls.slice(-3);
	}

	const sinceYear = since.getUTCFullYear();
	const sinceMonth = since.getUTCMonth() + 1; // 1-indexed

	return urls.filter((url) => {
		const parts = url.split('/');
		const month = parseInt(parts[parts.length - 1]);
		const year = parseInt(parts[parts.length - 2]);
		if (isNaN(year) || isNaN(month)) {
			log.warn('Chess.com: could not parse archive URL, skipping', { url });
			return false;
		}

		// Include archives from the watermark month onward.
		return year > sinceYear || (year === sinceYear && month >= sinceMonth);
	});
}

async function fetchArchiveGames(
	archiveUrl: string,
	username: string,
	since?: Date
): Promise<ChesscomGame[] | null> {
	const res = await fetch(archiveUrl, { headers: { 'User-Agent': USER_AGENT } });

	if (res.status === 429) {
		throw new ChesscomApiError('Chess.com rate limit exceeded. Try again later.', 429);
	}
	if (!res.ok) {
		log.warn('Chess.com archive fetch failed', {
			status: res.status,
			statusText: res.statusText,
			url: archiveUrl
		});
		return null;
	}

	const data = (await res.json()) as ChesscomGamesResponse;
	const rawCount = data.games?.length ?? 0;
	const games: ChesscomGame[] = [];

	for (const raw of data.games ?? []) {
		// Only standard chess (skip variants like chess960, bughouse, etc.)
		if (raw.rules !== 'chess') continue;

		// Skip games older than the watermark.
		const playedAt = raw.end_time ? new Date(raw.end_time * 1000) : null;
		if (since && playedAt && playedAt <= since) continue;

		try {
			games.push(parseChesscomGame(raw, username));
		} catch (err) {
			log.warn('Skipping malformed Chess.com game', { err });
		}
	}

	log.info('Chess.com archive fetched', { url: archiveUrl, raw: rawCount, kept: games.length });

	return games;
}

function parseChesscomGame(raw: ChesscomRawGame, username: string): ChesscomGame {
	// Determine which color the user played (case-insensitive match).
	// Check both sides explicitly rather than assuming "not white = black",
	// with a PGN header fallback in case the JSON usernames don't match.
	const userLower = username.trim().toLowerCase();
	const whiteMatch = raw.white.username.trim().toLowerCase() === userLower;
	const blackMatch = raw.black.username.trim().toLowerCase() === userLower;

	let playerColor: 'WHITE' | 'BLACK';
	if (whiteMatch) {
		playerColor = 'WHITE';
	} else if (blackMatch) {
		playerColor = 'BLACK';
	} else {
		// Fallback: check PGN [White] / [Black] headers
		const whiteHeader = extractPgnHeader(raw.pgn, 'White')?.trim().toLowerCase();
		const blackHeader = extractPgnHeader(raw.pgn, 'Black')?.trim().toLowerCase();
		playerColor =
			whiteHeader === userLower ? 'WHITE' : blackHeader === userLower ? 'BLACK' : 'WHITE';
	}

	const isWhite = playerColor === 'WHITE';
	const opponentInfo = isWhite ? raw.black : raw.white;
	const playerInfo = isWhite ? raw.white : raw.black;

	// Map Chess.com result strings to standard PGN result.
	const result = mapChesscomResult(raw.white.result, raw.black.result);

	return {
		id: raw.url,
		pgn: raw.pgn,
		playerColor,
		opponentName: opponentInfo.username,
		opponentRating: opponentInfo.rating ?? null,
		playerRating: playerInfo.rating ?? null,
		timeControl: raw.time_control ?? null,
		result,
		playedAt: raw.end_time ? new Date(raw.end_time * 1000) : null
	};
}

/**
 * Map Chess.com result fields to standard PGN result notation.
 * Chess.com stores results per-player (e.g. white.result="win", black.result="checkmated").
 */
function mapChesscomResult(whiteResult: string, blackResult: string): string | null {
	const whiteWins = ['win'];
	const blackWins = ['win'];
	const drawResults = [
		'stalemate',
		'agreed',
		'repetition',
		'insufficient',
		'50move',
		'timevsinsufficient'
	];

	if (whiteWins.includes(whiteResult)) return '1-0';
	if (blackWins.includes(blackResult)) return '0-1';
	if (drawResults.includes(whiteResult) || drawResults.includes(blackResult)) return '1/2-1/2';

	// Fallback: check for loss indicators on each side.
	const lossResults = ['checkmated', 'timeout', 'resigned', 'abandoned'];
	if (lossResults.includes(whiteResult)) return '0-1';
	if (lossResults.includes(blackResult)) return '1-0';

	return null;
}

/** Extract a single PGN header value by tag name, e.g. extractPgnHeader(pgn, 'White'). */
function extractPgnHeader(pgn: string, tag: string): string | null {
	// eslint-disable-next-line security/detect-non-literal-regexp -- tag is always a hardcoded literal from our own code
	const re = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`);
	const m = pgn.match(re);
	return m ? m[1] : null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
