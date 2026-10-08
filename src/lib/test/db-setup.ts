// Per-file setup for DB tests: apply migrations once, close the pool at the end.
import { afterAll, beforeAll } from 'vitest';
import { dbReady, getRawSql } from '$lib/db';

beforeAll(async () => {
	await dbReady;
});

afterAll(async () => {
	await getRawSql().end();
});
