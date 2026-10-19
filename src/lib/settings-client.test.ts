import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchSettings, saveBoardSize } from './settings-client';

function stubFetch(impl: () => Promise<Response>) {
	const fetchMock = vi.fn<typeof fetch>(impl);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('patchSettings', () => {
	it('sends only the given keys as a JSON PATCH and resolves true on success', async () => {
		const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }));
		await expect(patchSettings({ soundEnabled: false })).resolves.toBe(true);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/settings');
		expect(init?.method).toBe('PATCH');
		expect(JSON.parse(init?.body as string)).toEqual({ soundEnabled: false });
	});

	it('resolves false on an error status', async () => {
		stubFetch(async () => new Response('{}', { status: 500 }));
		await expect(patchSettings({ boardSize: 400 })).resolves.toBe(false);
	});

	it('resolves false instead of rejecting on a network error', async () => {
		stubFetch(async () => {
			throw new TypeError('offline');
		});
		await expect(patchSettings({ boardSize: 400 })).resolves.toBe(false);
	});
});

describe('saveBoardSize', () => {
	it('saves the size and swallows failures', async () => {
		const fetchMock = stubFetch(async () => {
			throw new TypeError('offline');
		});
		saveBoardSize(512);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ boardSize: 512 });
	});
});
