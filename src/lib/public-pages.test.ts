import { describe, expect, it } from 'vitest';
import { pageOwnsLandmarks } from './public-pages';

describe('pageOwnsLandmarks', () => {
	it('is true for public pages whoever views them', () => {
		for (const signedIn of [false, true]) {
			expect(pageOwnsLandmarks('/openings/[family]/[variation]', signedIn)).toBe(true);
			expect(pageOwnsLandmarks('/blog/[slug]', signedIn)).toBe(true);
			expect(pageOwnsLandmarks('/terms', signedIn)).toBe(true);
		}
	});

	it('is true for the home route only when it shows the landing page', () => {
		expect(pageOwnsLandmarks('/', false)).toBe(true);
		expect(pageOwnsLandmarks('/', true)).toBe(false);
	});

	it('is false for app pages, unknown routes and errors', () => {
		expect(pageOwnsLandmarks('/build', true)).toBe(false);
		expect(pageOwnsLandmarks('/login', false)).toBe(false);
		expect(pageOwnsLandmarks(null, false)).toBe(false);
	});
});
