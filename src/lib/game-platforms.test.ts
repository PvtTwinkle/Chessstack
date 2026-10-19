import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/log', () => ({
	log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const { fetchLichessGames, LichessApiError } = await import('./lichess');
const { fetchChesscomGames, ChesscomApiError } = await import('./chesscom');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
	fetchMock.mockReset();
	vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function timeoutError() {
	return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

describe('fetchLichessGames', () => {
	it('passes a timeout signal and the since/sort parameters', async () => {
		fetchMock.mockResolvedValueOnce(new Response(''));
		await fetchLichessGames('alice', { since: 1234, max: 10, sort: 'dateAsc' });
		const [url, init] = fetchMock.mock.calls[0];
		const params = new URL(url).searchParams;
		expect(params.get('since')).toBe('1234');
		expect(params.get('sort')).toBe('dateAsc');
		expect(params.get('max')).toBe('10');
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('maps a timeout to a 504 LichessApiError', async () => {
		fetchMock.mockRejectedValueOnce(timeoutError());
		const err = await fetchLichessGames('alice').catch((e) => e);
		expect(err).toBeInstanceOf(LichessApiError);
		expect(err.status).toBe(504);
		expect(err.message).toMatch(/did not respond in time/);
	});

	it('reads the colour and result, and skips malformed lines', async () => {
		const game = {
			id: 'abc',
			createdAt: 1_700_000_000_000,
			status: 'resign',
			winner: 'black',
			players: {
				white: { user: { name: 'Bob', id: 'bob' }, rating: 1500 },
				black: { user: { name: 'Alice', id: 'alice' }, rating: 1600 }
			},
			moves: 'e4 e5',
			pgn: '1. e4 e5 0-1'
		};
		fetchMock.mockResolvedValueOnce(new Response(`${JSON.stringify(game)}\n{not json\n`));
		const games = await fetchLichessGames('ALICE');
		expect(games).toHaveLength(1);
		expect(games[0]).toMatchObject({
			playerColor: 'BLACK',
			result: '0-1',
			opponentName: 'Bob',
			opponentRating: 1500
		});
	});
});

function archive(year: number, month: number) {
	return `https://api.chess.com/pub/player/alice/games/${year}/${String(month).padStart(2, '0')}`;
}

function chesscomGame(n: number, endTime: number) {
	return {
		url: `https://www.chess.com/game/live/${n}`,
		pgn: `[White "alice"]\n1. e4 *`,
		time_control: '600',
		end_time: endTime,
		rated: true,
		time_class: 'rapid',
		rules: 'chess',
		white: { username: 'alice', rating: 1500, result: 'win' },
		black: { username: 'bob', rating: 1400, result: 'resigned' }
	};
}

describe('fetchChesscomGames', () => {
	it('walks archives oldest first from the watermark month and stops at max', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		const since = new Date(Date.UTC(2026, 6, 15)); // July 2026
		const julyGames = [1, 2, 3].map((i) => chesscomGame(i, since.getTime() / 1000 + i * 60));
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({ archives: [archive(2026, 6), archive(2026, 7), archive(2026, 8)] })
			)
			.mockResolvedValueOnce(jsonResponse({ games: julyGames }));

		const games = await fetchChesscomGames('alice', { since, max: 2, oldestFirst: true });
		// Only July was fetched: max was reached before August.
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toBe(archive(2026, 7));
		expect(games.map((g) => g.id)).toEqual([
			'https://www.chess.com/game/live/1',
			'https://www.chess.com/game/live/2'
		]);
	});

	it('maps a timeout on an archive to a 504 ChesscomApiError', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ archives: [archive(2026, 7)] }))
			.mockRejectedValueOnce(timeoutError());
		const err = await fetchChesscomGames('alice', { oldestFirst: true }).catch((e) => e);
		expect(err).toBeInstanceOf(ChesscomApiError);
		expect(err.status).toBe(504);
		expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
	});

	it('reports an unknown user as 404', async () => {
		fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
		const err = await fetchChesscomGames('nobody').catch((e) => e);
		expect(err).toBeInstanceOf(ChesscomApiError);
		expect(err.status).toBe(404);
	});
});
