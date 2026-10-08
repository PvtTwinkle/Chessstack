import { describe, expect, it } from 'vitest';
import { MAX_TITLE_LENGTH, absoluteUrl, pageTitle } from './site';
import { ANNUAL_PLAN, FREE_REPERTOIRES, MONTHLY_PLAN, formatPrice } from './pricing';

describe('absoluteUrl', () => {
	it('prefixes root-relative paths with the site URL', () => {
		expect(absoluteUrl('/')).toBe('https://chessstack.app/');
		expect(absoluteUrl('/blog/post')).toBe('https://chessstack.app/blog/post');
	});

	it('adds a missing leading slash', () => {
		expect(absoluteUrl('og-image.png')).toBe('https://chessstack.app/og-image.png');
	});

	it('leaves absolute URLs alone', () => {
		expect(absoluteUrl('https://github.com/x')).toBe('https://github.com/x');
	});
});

describe('pageTitle', () => {
	it('appends the site name when it fits', () => {
		expect(pageTitle('Sign In')).toBe('Sign In | Chessstack');
	});

	it('keeps long titles intact rather than letting search results cut them', () => {
		const long = 'How to Memorize Chess Openings (Without Losing Your Mind)';
		expect(pageTitle(long)).toBe(long);
	});

	it('never returns a suffixed title longer than the limit', () => {
		for (let length = 1; length <= 80; length++) {
			const title = pageTitle('x'.repeat(length));
			if (title.endsWith('| Chessstack'))
				expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
		}
	});
});

describe('pricing', () => {
	it('matches the published plans: free with 1 repertoire, $1/month, $10/year', () => {
		expect(FREE_REPERTOIRES).toBe(1);
		expect(MONTHLY_PLAN.price).toBe(1);
		expect(ANNUAL_PLAN.price).toBe(10);
	});

	it('formats whole and fractional prices', () => {
		expect(formatPrice(1)).toBe('$1');
		expect(formatPrice(0.83)).toBe('$0.83');
	});
});
