import { describe, expect, it } from 'vitest';
import { engineSettings } from './settings';

describe('engineSettings', () => {
	it('uses the saved depth and timeout', () => {
		expect(engineSettings({ stockfishDepth: 24, stockfishTimeout: 5 })).toEqual({
			depth: 24,
			timeoutMs: 5000
		});
	});

	it('falls back to depth 20 and 10 seconds without settings', () => {
		expect(engineSettings(null)).toEqual({ depth: 20, timeoutMs: 10_000 });
	});

	it('keeps the depth within 15-30', () => {
		expect(engineSettings({ stockfishDepth: 40 }).depth).toBe(30);
		expect(engineSettings({ stockfishDepth: 5 }).depth).toBe(15);
	});
});
