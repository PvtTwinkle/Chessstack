// Database connection singleton.
//
// This file does four things when the app first starts:
//   1. Opens a connection to the PostgreSQL database
//   2. Runs any pending migrations — creates all tables on first run,
//      applies only new migrations on subsequent runs
//   3. Creates a default admin if no user exists yet (self-hosted edition only)
//   4. Exports the `db` object that every other file uses to query the database
//
// IMPORTANT: The connection and initialization are lazy — they only happen when
// `dbReady` is first awaited (in hooks.server.ts). This is critical because
// SvelteKit's `vite build` evaluates server modules at build time to generate
// the production bundle. If we connected eagerly at module scope, the build
// would crash with ECONNREFUSED (no database available during Docker build).

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'path';
import bcrypt from 'bcryptjs';
import { count } from 'drizzle-orm';
import * as schema from './schema';
import { loadSeedData } from './seed-data';
import { bridgeSelfHostedMigrations } from './migration-bridge';
import { log } from '$lib/server/log';
import { IS_CLOUD } from '$lib/server/edition';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration via environment variables
//
// DATABASE_URL:    PostgreSQL connection string (required).
//                 Set in .env or docker-compose.yml.
//
// DEFAULT_USERNAME / DEFAULT_PASSWORD: the admin account a self-hosted
//                 instance creates on first run (default admin / changeme).
//                 Not used by the cloud edition.
// ─────────────────────────────────────────────────────────────────────────────

function getDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			'[chessstack] DATABASE_URL environment variable is required but not set. ' +
				'See .env.example for the expected format.'
		);
	}
	return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy connection — the postgres.js client and Drizzle instance are created on
// first access, not at import time. This prevents the build from crashing when
// no database is available (e.g. inside a Docker build stage).
// ─────────────────────────────────────────────────────────────────────────────

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
	if (!_db) {
		_sql = postgres(getDatabaseUrl(), {
			onnotice: () => {} // suppress PostgreSQL NOTICE messages (e.g. "already exists" from migrations)
		});
		_db = drizzle(_sql, { schema });
	}
	return _db;
}

// Raw SQL client for operations Drizzle doesn't support (e.g. advisory locks).
export function getRawSql() {
	if (!_sql) getDb(); // ensure connection is initialized
	return _sql!;
}

// Re-export as `db` for convenience. Every call goes through the lazy getter.
// This is a getter-based export so it defers connection until first use.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
	get(_target, prop, receiver) {
		return Reflect.get(getDb(), prop, receiver);
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Async initialization — migrations + default user
//
// dbReady is a lazy promise: it only runs when first awaited (in hooks.server.ts).
// This ensures no database connection is attempted during `vite build`.
// ─────────────────────────────────────────────────────────────────────────────

let _dbReadyPromise: Promise<void> | null = null;

export const dbReady: Promise<void> = {
	then(onfulfilled, onrejected) {
		if (!_dbReadyPromise) {
			_dbReadyPromise = initDatabase();
		}
		return _dbReadyPromise.then(onfulfilled, onrejected);
	}
} as Promise<void>;

async function initDatabase(): Promise<void> {
	const realDb = getDb();

	const migrationsFolder = path.join(process.cwd(), 'drizzle', 'migrations');

	// A database created by the self-hosted edition records its migrations
	// under the old numbering; the bridge rewrites that record first so that
	// migrate() below sees the same history as on any other database.
	const bridge = await bridgeSelfHostedMigrations(getRawSql(), migrationsFolder);
	if (bridge.status === 'bridged') {
		log.info('Upgraded self-hosted migration history.', {
			redated: bridge.redated,
			applied: bridge.applied
		});
	}

	// migrate() checks which migration files have already been applied and runs
	// only the ones that have not run yet. On first run it creates all tables.
	await migrate(realDb, { migrationsFolder });
	log.info('Database migrations complete.');

	// Seed large reference tables (masters + puzzles) from embedded dump files.
	// Skips silently in local dev (no dump files) or if tables already have data.
	await loadSeedData();

	// The cloud edition creates no account: the first person to register becomes
	// admin. A self-hosted instance usually runs in invite mode, where nobody
	// could register, so it starts with a default admin as it always has.
	if (!IS_CLOUD) await createDefaultAdmin(realDb);
}

/** Creates the self-hosted edition's first account, unless any account exists. */
export async function createDefaultAdmin(realDb: ReturnType<typeof getDb>): Promise<void> {
	const [{ total }] = await realDb.select({ total: count() }).from(schema.user);
	if (total > 0) return;

	const username = process.env.DEFAULT_USERNAME ?? 'admin';
	const password = process.env.DEFAULT_PASSWORD ?? 'changeme';
	await realDb.insert(schema.user).values({
		username,
		passwordHash: await bcrypt.hash(password, 10),
		role: 'admin',
		createdAt: new Date()
	});

	log.info('Created the default admin account.', { username });
	if (!process.env.DEFAULT_PASSWORD) {
		log.warn(
			'The default admin uses the password "changeme". Set DEFAULT_PASSWORD, or change it in Settings after signing in.'
		);
	}
}
