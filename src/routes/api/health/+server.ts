import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Lightweight liveness check — no database query. Cloud load balancers and
// Kubernetes probes hit this frequently; querying the DB on every probe adds
// unnecessary load. The app only reaches this point if it booted successfully
// (dbReady resolved in hooks.server.ts before any requests are served).
export const GET: RequestHandler = async () => {
	return json({ status: 'ok' });
};
