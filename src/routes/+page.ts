// `/` is the marketing page for visitors and the dashboard for signed-in
// users. Loading the one that's needed here, instead of importing all three
// in +page.svelte, keeps the app out of a visitor's download and the landing
// page out of a user's. The import is awaited in the load, so the server
// still renders the page in full.

import type { PageLoad } from './$types';
import type Landing from '$lib/components/landing/Landing.svelte';
import type OnboardingWelcome from '$lib/components/OnboardingWelcome.svelte';
import type Dashboard from '$lib/components/Dashboard.svelte';

export type HomeView =
	| { kind: 'landing'; component: typeof Landing }
	| { kind: 'onboarding'; component: typeof OnboardingWelcome }
	| { kind: 'dashboard'; component: typeof Dashboard };

export const load: PageLoad = async ({ data, parent }) => {
	const { user, repertoires } = await parent();
	let view: HomeView;
	if (!user) {
		view = {
			kind: 'landing',
			component: (await import('$lib/components/landing/Landing.svelte')).default
		};
	} else if (repertoires.length === 0) {
		view = {
			kind: 'onboarding',
			component: (await import('$lib/components/OnboardingWelcome.svelte')).default
		};
	} else {
		view = {
			kind: 'dashboard',
			component: (await import('$lib/components/Dashboard.svelte')).default
		};
	}
	return { ...data, view };
};
