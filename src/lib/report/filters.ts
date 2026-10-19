// The Opening Report's filters, shared by the page and its server load.

/** Newest games per report: enough for a clear picture, small enough to compute per load. */
export const REPORT_GAME_LIMIT = 500;

export const PERIODS = ['30', '90', 'all'] as const;
export type Period = (typeof PERIODS)[number];
export const SPEEDS = ['all', 'bullet', 'blitz', 'rapid', 'classical', 'daily'] as const;
export type SpeedFilter = (typeof SPEEDS)[number];

export interface ReportFilters {
	period: Period;
	speed: SpeedFilter;
	ratedOnly: boolean;
}

/** Filters from the page's query string; anything unknown falls back to the default. */
export function parseReportFilters(params: URLSearchParams): ReportFilters {
	const period = params.get('period');
	const speed = params.get('speed');
	return {
		period: PERIODS.find((p) => p === period) ?? '90',
		speed: SPEEDS.find((s) => s === speed) ?? 'all',
		ratedOnly: params.get('rated') === '1'
	};
}
