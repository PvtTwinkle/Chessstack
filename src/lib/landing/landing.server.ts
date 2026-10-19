// The open-source edition has no public website, so the logged-out home page
// has nothing to load. Self-hosted instances send logged-out visitors to
// /login before the page renders; this only runs with EDITION=cloud.

export interface LandingData {
	posts: never[];
	openings: { slug: string; name: string }[];
}

export function loadLanding(): LandingData {
	return { posts: [], openings: [] };
}
