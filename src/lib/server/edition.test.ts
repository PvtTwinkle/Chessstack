import { describe, expect, it } from 'vitest';
import { isCloudOnlyRoute, parseEdition } from './edition';

describe('parseEdition', () => {
	it('is cloud only when asked for explicitly', () => {
		expect(parseEdition('cloud')).toBe('cloud');
		expect(parseEdition(' Cloud ')).toBe('cloud');
	});

	it('defaults to self-hosted', () => {
		expect(parseEdition(undefined)).toBe('selfhosted');
		expect(parseEdition('')).toBe('selfhosted');
		expect(parseEdition('selfhosted')).toBe('selfhosted');
		expect(parseEdition('clould')).toBe('selfhosted');
	});
});

describe('isCloudOnlyRoute', () => {
	it('matches the marketing pages and everything under them', () => {
		expect(isCloudOnlyRoute('/openings')).toBe(true);
		expect(isCloudOnlyRoute('/openings/sicilian-defense')).toBe(true);
		expect(isCloudOnlyRoute('/sitemap.xml')).toBe(true);
	});

	it('leaves the app alone', () => {
		expect(isCloudOnlyRoute('/')).toBe(false);
		expect(isCloudOnlyRoute('/login')).toBe(false);
		expect(isCloudOnlyRoute('/blogger')).toBe(false);
		expect(isCloudOnlyRoute('/api/openings')).toBe(false);
	});
});
