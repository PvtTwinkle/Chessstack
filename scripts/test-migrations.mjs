/**
 * Migration smoke test for CI.
 *
 * This script applies every migration file in drizzle/migrations/ to a
 * database the same way startup does (the self-hosted migration bridge, then
 * Drizzle's migrate()), and then again to show a second start changes nothing.
 * If any migration fails — because of a SQL syntax error, a bad constraint, a
 * missing column, or anything else — this script exits with code 1, causing
 * the CI job to fail.
 *
 * It first checks the journal's dates: Drizzle only runs migrations dated
 * after the newest one a database has applied, so a new entry dated earlier
 * than an older one would be skipped on every existing database.
 *
 * Requires a running PostgreSQL instance. In CI this is provided by a GitHub
 * Actions service container. Locally you can point DATABASE_URL at any
 * throwaway PostgreSQL database.
 *
 * This is a plain .mjs file (JavaScript, not TypeScript) so Node.js can run it
 * directly without a build step.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
// Node 24 strips the types itself, so this runs the app's own bridge code.
import { bridgeSelfHostedMigrations } from '../src/lib/db/migration-bridge.ts';

// __dirname is not available in ES modules (.mjs files), so we derive it from
// import.meta.url — the URL of the currently executing file.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the drizzle/migrations/ folder, resolved relative to this script's
// location. join(__dirname, '..', 'drizzle', 'migrations') means:
//   start at scripts/
//   go up one level to the project root
//   then down into drizzle/migrations/
const migrationsFolder = join(__dirname, '..', 'drizzle', 'migrations');

// Connect to PostgreSQL. In CI this comes from the service container.
// Locally you can set DATABASE_URL to point at any test database.
const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://chessstack:chessstack@localhost:5432/chessstack';

// These two shipped dated before 0016. Every database is past them, so they
// do no harm, but nothing after them may repeat it.
const KNOWN_OUT_OF_ORDER = new Set(['0017_polite_blur', '0018_mixed_shen']);

const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
let newest = 0;
for (const entry of journal.entries) {
	if (entry.when <= newest && !KNOWN_OUT_OF_ORDER.has(entry.tag)) {
		console.error(
			`✗ ${entry.tag} is dated before an earlier migration; existing databases would skip it. ` +
				'Regenerate it with npx drizzle-kit generate.'
		);
		process.exit(1);
	}
	newest = Math.max(newest, entry.when);
}

const sql = postgres(DATABASE_URL, { onnotice: () => {} });
const db = drizzle(sql);

try {
	// The same steps the app takes at startup in src/lib/db/index.ts, twice.
	for (let run = 0; run < 2; run++) {
		await bridgeSelfHostedMigrations(sql, migrationsFolder);
		await migrate(db, { migrationsFolder });
	}

	console.log('✓ All migrations applied successfully.');
} catch (err) {
	console.error('✗ Migration failed:', err);
	process.exit(1);
} finally {
	// Close the connection cleanly so the process can exit.
	await sql.end();
}
