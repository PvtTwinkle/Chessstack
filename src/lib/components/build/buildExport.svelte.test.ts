import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgnExport } from './buildExport.svelte';
import { copyToClipboard, downloadTextFile } from '$lib/download';

vi.mock('$lib/download', () => ({ downloadTextFile: vi.fn(), copyToClipboard: vi.fn() }));

const fetchMock = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockResolvedValue(
		new Response(JSON.stringify({ pgn: '1. e4 *', filename: 'white.pgn' }), { status: 200 })
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('createPgnExport', () => {
	it('fetches the PGN and offers download and copy', async () => {
		const exp = createPgnExport(() => 7);
		await exp.exportPgn();
		expect(fetchMock).toHaveBeenCalledWith('/api/repertoires/7/export');
		expect(exp.ready).toBe(true);
		expect(exp.exporting).toBe(false);

		exp.download();
		expect(downloadTextFile).toHaveBeenCalledWith('1. e4 *', 'white.pgn');
		expect(exp.ready).toBe(false);
	});

	it('reports a failed export', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 500 }));
		const exp = createPgnExport(() => 7);
		await exp.exportPgn();
		expect(exp.message).toBe('Export failed');
		expect(exp.ready).toBe(false);
	});

	it('shows "Copied!" for two seconds', async () => {
		vi.mocked(copyToClipboard).mockResolvedValue(true);
		const exp = createPgnExport(() => 7);
		await exp.exportPgn();
		await exp.copy();
		expect(copyToClipboard).toHaveBeenCalledWith('1. e4 *');
		expect(exp.message).toBe('Copied!');
		vi.advanceTimersByTime(2000);
		expect(exp.message).toBe('');
	});

	it('keeps "Copy failed" on screen', async () => {
		vi.mocked(copyToClipboard).mockResolvedValue(false);
		const exp = createPgnExport(() => 7);
		await exp.copy();
		vi.advanceTimersByTime(5000);
		expect(exp.message).toBe('Copy failed');
	});

	it('destroy cancels the pending message timer', async () => {
		vi.mocked(copyToClipboard).mockResolvedValue(true);
		const exp = createPgnExport(() => 7);
		await exp.copy();
		exp.destroy();
		vi.advanceTimersByTime(2000);
		expect(exp.message).toBe('Copied!');
	});
});
