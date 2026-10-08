import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
	it('accepts root-relative paths', () => {
		expect(safeRedirectPath('/openings/sicilian-defense')).toBe('/openings/sicilian-defense');
		expect(safeRedirectPath('/build?line=e4,c5')).toBe('/build?line=e4,c5');
	});

	it('rejects absolute and protocol-relative URLs', () => {
		expect(safeRedirectPath('https://evil.example')).toBeNull();
		expect(safeRedirectPath('//evil.example')).toBeNull();
		expect(safeRedirectPath('/\\evil.example')).toBeNull();
		expect(safeRedirectPath('javascript:alert(1)')).toBeNull();
	});

	it('rejects control characters, empty and non-string values', () => {
		expect(safeRedirectPath('/\t/evil.example')).toBeNull();
		expect(safeRedirectPath('')).toBeNull();
		expect(safeRedirectPath(null)).toBeNull();
		expect(safeRedirectPath(undefined)).toBeNull();
	});
});
