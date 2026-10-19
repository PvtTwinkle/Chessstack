import { describe, expect, it } from 'vitest';
import { parseReportFilters } from './filters';

describe('parseReportFilters', () => {
	it('defaults to the last 90 days, every speed, rated or not', () => {
		expect(parseReportFilters(new URLSearchParams())).toEqual({
			period: '90',
			speed: 'all',
			ratedOnly: false
		});
	});

	it('reads known values and ignores unknown ones', () => {
		expect(parseReportFilters(new URLSearchParams('period=all&speed=blitz&rated=1'))).toEqual({
			period: 'all',
			speed: 'blitz',
			ratedOnly: true
		});
		expect(parseReportFilters(new URLSearchParams('period=7&speed=hyper&rated=yes'))).toEqual({
			period: '90',
			speed: 'all',
			ratedOnly: false
		});
	});
});
