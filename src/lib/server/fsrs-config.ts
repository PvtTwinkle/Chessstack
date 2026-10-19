// Shared helper for loading per-user FSRS config from the database, so every
// place that grades a card or shows an interval uses the same query and
// fallbacks.

import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_RETENTION, DEFAULT_MAX_INTERVAL, DEFAULT_RELEARNING_MINUTES } from '$lib/fsrs';
import type { FSRSUserConfig } from '$lib/fsrs';

export async function loadFsrsConfig(userId: number): Promise<FSRSUserConfig> {
	const [settings] = await db
		.select({
			fsrsDesiredRetention: userSettings.fsrsDesiredRetention,
			fsrsMaximumInterval: userSettings.fsrsMaximumInterval,
			fsrsRelearningMinutes: userSettings.fsrsRelearningMinutes
		})
		.from(userSettings)
		.where(eq(userSettings.userId, userId));

	return {
		requestRetention: settings?.fsrsDesiredRetention ?? DEFAULT_RETENTION,
		maximumInterval: settings?.fsrsMaximumInterval ?? DEFAULT_MAX_INTERVAL,
		relearningMinutes: settings?.fsrsRelearningMinutes ?? DEFAULT_RELEARNING_MINUTES
	};
}
