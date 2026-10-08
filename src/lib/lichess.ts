// Lichess API client — fetches recent games for a user.
//
// Uses the NDJSON streaming endpoint for structured metadata + PGN.
// No authentication needed for public games.
// Rate limit: 20 requests/minute (we make at most 1 per import trigger).

import { log } from '$lib/server/log';

const LICHESS_API_BASE = 'https://lichess.org';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LichessGame {
	id: string; // Lichess game ID, e.g. "AbCdEfGh"
	pgn: string; // full PGN text
	playerColor: 'WHITE' | 'BLACK';
	opponentName: string | null;
	opponentRating: number | null;
	playerRating: number | null;
	timeControl: string | null; // e.g. "600+0", "180+2"
	result: string | null; // '1-0', '0-1', '1/2-1/2'
	playedAt: Date | null;
}

export class LichessApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public retryAfter?: number
	) {
		super(message);
		this.name = 'LichessApiError';
	}
}

// ── Raw NDJSON types (internal) ──────────────────────────────────────────────

interface LichessNdjsonPlayer {
	user?: { name: string; id: string };
	rating?: number;
	aiLevel?: number; // present when playing vs Stockfish
}

interface LichessNdjsonGame {
	id: string;
	rated: boolean;
	variant: string;
	speed: string; // "bullet", "blitz", "rapid", "classical", "correspondence"
	perf: string;
	createdAt: number; // Unix ms
	lastMoveAt: number;
	status: string; // "mate", "resign", "draw", "stalemate", "timeout", "outoftime", etc.
	winner?: 'white' | 'black'; // absent for draws
	players: {
		white: LichessNdjsonPlayer;
		black: LichessNdjsonPlayer;
	};
	moves: string; // space-separated SAN, e.g. "e4 e5 Nf3 Nc6"
	pgn?: string; // present when pgnInJson=true
	clock?: {
		initial: number; // seconds
		increment: number; // seconds
	};
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch recent games for a Lichess user.
 *
 * @param username - Lichess username (case-insensitive)
 * @param options.since - Only fetch games played after this Unix timestamp (ms)
 * @param options.max - Maximum number of games to return (default 50)
 */
export async function fetchLichessGames(
	username: string,
	options: { since?: number; max?: number; sort?: 'dateAsc' | 'dateDesc' } = {}
): Promise<LichessGame[]> {
	const max = options.max ?? 50;

	const params = new URLSearchParams({
		max: String(max),
		pgnInJson: 'true',
		moves: 'true',
		tags: 'true',
		clocks: 'false',
		evals: 'false',
		opening: 'false',
		sort: options.sort ?? 'dateAsc'
	});

	if (options.since !== undefined) {
		params.set('since', String(options.since));
	}

	const url = `${LICHESS_API_BASE}/api/games/user/${encodeURIComponent(username)}?${params}`;

	const res = await fetch(url, {
		headers: {
			Accept: 'application/x-ndjson'
		}
	});

	if (res.status === 404) {
		throw new LichessApiError(`Lichess user "${username}" not found`, 404);
	}

	if (res.status === 429) {
		const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60');
		throw new LichessApiError('Lichess rate limit exceeded. Try again later.', 429, retryAfter);
	}

	if (!res.ok) {
		throw new LichessApiError(`Lichess API error: ${res.status} ${res.statusText}`, res.status);
	}

	const body = await res.text();
	if (!body.trim()) return [];

	// NDJSON: one JSON object per line, separated by newlines.
	const lines = body.trim().split('\n');
	const games: LichessGame[] = [];

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const raw = JSON.parse(line) as LichessNdjsonGame;
			games.push(parseLichessGame(raw, username));
		} catch (err) {
			log.warn('Skipping malformed Lichess NDJSON line', { err });
		}
	}

	return games;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function parseLichessGame(raw: LichessNdjsonGame, username: string): LichessGame {
	// Determine which color the user played (case-insensitive match).
	// Check both sides explicitly using both user.id (always lowercase on Lichess)
	// and user.name (original casing) for maximum reliability.
	const userLower = username.trim().toLowerCase();
	const whiteUser = raw.players.white?.user;
	const blackUser = raw.players.black?.user;
	const whiteMatch = whiteUser?.id === userLower || whiteUser?.name?.toLowerCase() === userLower;
	const blackMatch = blackUser?.id === userLower || blackUser?.name?.toLowerCase() === userLower;
	const playerColor: 'WHITE' | 'BLACK' = whiteMatch ? 'WHITE' : blackMatch ? 'BLACK' : 'WHITE';

	// Opponent info
	const opponentSide = playerColor === 'WHITE' ? raw.players.black : raw.players.white;
	const playerSide = playerColor === 'WHITE' ? raw.players.white : raw.players.black;

	// Result string
	let result: string | null = null;
	if (raw.status === 'draw' || raw.status === 'stalemate') {
		result = '1/2-1/2';
	} else if (raw.winner === 'white') {
		result = '1-0';
	} else if (raw.winner === 'black') {
		result = '0-1';
	}

	// Time control
	let timeControl: string | null = null;
	if (raw.clock) {
		timeControl = `${raw.clock.initial}+${raw.clock.increment}`;
	}

	// PGN — use pgnInJson if available, otherwise build from moves string
	const pgn = raw.pgn ?? buildPgnFromMoves(raw, playerColor, result);

	return {
		id: raw.id,
		pgn,
		playerColor,
		opponentName:
			opponentSide?.user?.name ??
			(opponentSide?.aiLevel ? `Stockfish Level ${opponentSide.aiLevel}` : null),
		opponentRating: opponentSide?.rating ?? null,
		playerRating: playerSide?.rating ?? null,
		timeControl,
		result,
		playedAt: raw.createdAt ? new Date(raw.createdAt) : null
	};
}

/**
 * Fallback: build a minimal PGN from the NDJSON moves string when pgnInJson
 * is not available. The resulting PGN is compatible with parsePgn().
 */
function buildPgnFromMoves(
	raw: LichessNdjsonGame,
	playerColor: 'WHITE' | 'BLACK',
	result: string | null
): string {
	const headers: string[] = [];
	headers.push(`[Event "Lichess ${raw.speed} game"]`);
	headers.push(`[Site "https://lichess.org/${raw.id}"]`);
	headers.push(`[White "${raw.players.white?.user?.name ?? '?'}"]`);
	headers.push(`[Black "${raw.players.black?.user?.name ?? '?'}"]`);

	if (raw.createdAt) {
		const d = new Date(raw.createdAt);
		headers.push(
			`[Date "${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}"]`
		);
	}

	headers.push(`[Result "${result ?? '*'}"]`);

	if (raw.players.white?.rating) {
		headers.push(`[WhiteElo "${raw.players.white.rating}"]`);
	}
	if (raw.players.black?.rating) {
		headers.push(`[BlackElo "${raw.players.black.rating}"]`);
	}
	if (raw.clock) {
		headers.push(`[TimeControl "${raw.clock.initial}+${raw.clock.increment}"]`);
	}

	// Convert space-separated SAN to numbered PGN move text
	const sans = raw.moves.split(' ').filter(Boolean);
	let moveText = '';
	for (let i = 0; i < sans.length; i++) {
		if (i % 2 === 0) moveText += `${Math.floor(i / 2) + 1}. `;
		moveText += sans[i] + ' ';
	}
	moveText += result ?? '*';

	return headers.join('\n') + '\n\n' + moveText.trim();
}
