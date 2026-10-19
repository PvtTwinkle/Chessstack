// Opening Report page (plans/opening-report-plan.md): how the active
// repertoire holds up in the user's games. Filters come from the query string
// so a filtered report can be linked and reloaded.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { loadOpeningReport, sameColorRepertoires } from '$lib/server/report';
import { parseReportFilters } from '$lib/report/filters';
import type { PlayerColor } from '$lib/report';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const { activeRepertoireId, repertoires, lockedRepertoireIds } = await parent();
	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) redirect(302, '/');

	const userId = locals.user!.id;
	const color = activeRep.color as PlayerColor;
	const filters = parseReportFilters(url.searchParams);
	const sameColor = sameColorRepertoires(repertoires, color, lockedRepertoireIds);

	const [report, [settings]] = await Promise.all([
		loadOpeningReport(userId, activeRep.id, color, sameColor, filters),
		db
			.select({
				lichessUsername: userSettings.lichessUsername,
				chesscomUsername: userSettings.chesscomUsername
			})
			.from(userSettings)
			.where(eq(userSettings.userId, userId))
	]);

	return {
		repertoire: activeRep,
		filters,
		report,
		hasUsernames: Boolean(settings?.lichessUsername || settings?.chesscomUsername)
	};
};
