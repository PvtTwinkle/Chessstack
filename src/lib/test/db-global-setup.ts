// Fails fast (instead of silently skipping) when the DB test project is run
// without a database to point at.
export default function setup() {
	if (!process.env.DATABASE_URL) {
		throw new Error(
			'DB tests require DATABASE_URL pointing at a disposable PostgreSQL database ' +
				'(tables are truncated between tests). Example:\n' +
				'  DATABASE_URL=postgresql://chessstack:chessstack@localhost:5432/chessstack_test npm run test:db'
		);
	}
}
