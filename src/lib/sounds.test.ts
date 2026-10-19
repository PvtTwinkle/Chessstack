import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A window with just the listener methods sounds.ts uses.
function fakeWindow() {
	const listeners = new Map<string, Set<() => void>>();
	return {
		addEventListener: (type: string, fn: () => void) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(fn);
		},
		removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
		fire: (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn())
	};
}

class FakeAudioContext {
	static created = 0;
	state = 'running';
	destination = {};
	started = 0;
	constructor() {
		FakeAudioContext.created++;
	}
	decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
	createBufferSource = () => ({
		connect: () => {},
		start: () => this.started++,
		buffer: null
	});
	createGain = () => ({ connect: () => {}, gain: { value: 1 } });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sounds', () => {
	let win: ReturnType<typeof fakeWindow>;
	const fetchMock = vi.fn(async () => new Response(new ArrayBuffer(4)));

	beforeEach(() => {
		vi.resetModules();
		fetchMock.mockClear();
		FakeAudioContext.created = 0;
		win = fakeWindow();
		vi.stubGlobal('window', win);
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('AudioContext', FakeAudioContext);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('fetches each file once however many pages ask for the sounds', async () => {
		const sounds = await import('./sounds');
		sounds.initSounds();
		sounds.setSoundEnabled(true);
		sounds.initSounds();
		await flush();
		sounds.initSounds();
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('loads nothing while sound is off, and starts when it is switched on', async () => {
		const sounds = await import('./sounds');
		sounds.initSounds();
		sounds.setSoundEnabled(false);
		await flush();
		expect(fetchMock).not.toHaveBeenCalled();

		sounds.setSoundEnabled(true);
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('creates the audio context only on the first gesture, then plays', async () => {
		const sounds = await import('./sounds');
		sounds.initSounds();
		sounds.setSoundEnabled(true);
		await flush();
		expect(FakeAudioContext.created).toBe(0);
		sounds.playMove(); // no context yet: a silent no-op

		win.fire('pointerdown');
		await flush();
		expect(FakeAudioContext.created).toBe(1);

		win.fire('keydown');
		expect(FakeAudioContext.created).toBe(1);
		expect(() => sounds.playMove()).not.toThrow();
	});
});
