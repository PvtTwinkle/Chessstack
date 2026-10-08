// Drizzle Kit configuration file.
// Drizzle Kit is the companion CLI tool that reads your schema (schema.ts)
// and generates SQL migration files from it. This config tells it:
//   - where your schema is defined
//   - where to write the generated SQL migration files
//   - which database dialect to use (postgresql)
//   - the database connection string (only used by drizzle-kit studio, not the app)

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	// We are using PostgreSQL
	dialect: 'postgresql',

	// The TypeScript file where all tables are defined
	schema: './src/lib/db/schema.ts',

	// Where to write the generated SQL migration files
	out: './drizzle/migrations',

	dbCredentials: {
		// DATABASE_URL must be set in your .env file or shell environment.
		url: process.env.DATABASE_URL!
	}
});
