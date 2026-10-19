import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchChesscomGames } from './chesscom';

// Six monthly archives, two games each, ending a day into each month.
const MONTHS = ['2025/01', '2025/02', '2025/03', '2025/04', '2025/05', '2025/06'];
const BASE = 'https://api.chess.com/pub/player/rival/games';

function game(month: string, n: number) {
	const [year, mm] = month.split('/').map(Number);
	return {
		url: `https://www.chess.com/game/live/${month}-${n}`,
		pgn: `[White "rival"]\n[Black "x"]\n\n1. e4 *`,
		time_control: '180',
		end_time: Date.UTC(year, mm - 1, 1 + n) / 1000,
		time_class: 'blitz',
		rules: 'chess',
		white: { username: 'rival', rating: 1500, result: 'win' },
		black: { username: 'x', rating: 1500, result: 'checkmated' }
	};
}

describe('fetchChesscomGames', () => {
	const fetched: string[] = [];

	beforeEach(() => {
		vi.useFakeTimers();
		fetched.length = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				fetched.push(url);
				if (url.endsWith('/archives')) {
					return Response.json({ archives: MONTHS.map((m) => `${BASE}/${m}`) });
				}
				const month = url.slice(-7);
				return Response.json({ games: [game(month, 1), game(month, 2)] });
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	async function run(options: Parameters<typeof fetchChesscomGames>[1]) {
		const pending = fetchChesscomGames('rival', options);
		await vi.runAllTimersAsync();
		return pending;
	}

	it('reads only the last 3 archives when there is no since date', async () => {
		const games = await run({ max: 100 });
		expect(games).toHaveLength(6);
		expect(fetched).not.toContain(`${BASE}/2025/03`);
	});

	it('reads every archive for all time', async () => {
		const games = await run({ max: 100, allArchives: true });
		expect(games).toHaveLength(12);
	});

	it('returns games oldest first by default, for the import watermark', async () => {
		const games = await run({ max: 3 });
		expect(games.map((g) => g.id)).toEqual([
			'https://www.chess.com/game/live/2025/05-1',
			'https://www.chess.com/game/live/2025/05-2',
			'https://www.chess.com/game/live/2025/06-1'
		]);
	});

	it('keeps the newest games, newest first, when asked', async () => {
		const games = await run({ max: 3, allArchives: true, newestFirst: true });
		expect(games.map((g) => g.id)).toEqual([
			'https://www.chess.com/game/live/2025/06-2',
			'https://www.chess.com/game/live/2025/06-1',
			'https://www.chess.com/game/live/2025/05-2'
		]);
		// It stops reading archives once it has enough games.
		expect(fetched).not.toContain(`${BASE}/2025/01`);
	});
});
