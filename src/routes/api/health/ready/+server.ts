import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRawSql } from '$lib/db';

// Readiness check — unlike /api/health (liveness, no DB query), this verifies
// the database is reachable right now. Point uptime monitors here so a
// database outage is noticed; keep frequent load-balancer/container probes
// on /api/health, since restarting the app does not fix a database outage.

const DB_TIMEOUT_MS = 2000;

export const GET: RequestHandler = async () => {
	try {
		await Promise.race([
			getRawSql()`SELECT 1`,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('database check timed out')), DB_TIMEOUT_MS)
			)
		]);
		return json({ status: 'ok', db: 'ok' });
	} catch {
		return json({ status: 'error', db: 'unreachable' }, { status: 503 });
	}
};
