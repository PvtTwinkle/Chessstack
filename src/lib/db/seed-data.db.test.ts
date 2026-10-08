/* eslint-disable security/detect-non-literal-fs-filename -- test writes fixture dumps into its own mkdtemp directory */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { getRawSql } from '$lib/db';
import { restoreGzipDump } from './seed-data';

const DATABASE_URL = process.env.DATABASE_URL!;
let dir: string;

function writeDump(name: string, sqlText: string): string {
	const file = path.join(dir, name);
	writeFileSync(file, gzipSync(sqlText));
	return file;
}

beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'seed-test-'));
	await getRawSql()`DROP TABLE IF EXISTS seed_restore_test`;
});

afterAll(async () => {
	await getRawSql()`DROP TABLE IF EXISTS seed_restore_test`;
	await getRawSql().unsafe(`DROP ROLE IF EXISTS seed_shell_test`);
	rmSync(dir, { recursive: true, force: true });
});

describe('restoreGzipDump', () => {
	it('streams a gzipped SQL dump into the database', async () => {
		const file = writeDump(
			'ok.sql.gz',
			'CREATE TABLE seed_restore_test (n int);\nINSERT INTO seed_restore_test SELECT generate_series(1, 5000);\n'
		);
		await restoreGzipDump(file, DATABASE_URL);
		const [{ count }] = await getRawSql()`SELECT count(*)::int AS count FROM seed_restore_test`;
		expect(count).toBe(5000);
	});

	it('rejects a corrupt archive', async () => {
		const file = path.join(dir, 'corrupt.sql.gz');
		writeFileSync(file, Buffer.from('this is not gzip data'));
		await expect(restoreGzipDump(file, DATABASE_URL)).rejects.toThrow(/gunzip exited/);
	});

	it('rejects a truncated archive even though psql succeeds on the partial input', async () => {
		const full = gzipSync('SELECT 1;\n'.repeat(20000));
		const file = path.join(dir, 'truncated.sql.gz');
		writeFileSync(file, full.subarray(0, Math.floor(full.length / 2)));
		await expect(restoreGzipDump(file, DATABASE_URL)).rejects.toThrow(/gunzip exited/);
	});

	it('rejects when a binary is missing instead of hanging', async () => {
		const file = writeDump('noop.sql.gz', 'SELECT 1;\n');
		const savedPath = process.env.PATH;
		process.env.PATH = '/nonexistent';
		try {
			await expect(restoreGzipDump(file, DATABASE_URL)).rejects.toThrow(/ENOENT/);
		} finally {
			process.env.PATH = savedPath;
		}
	});

	it('passes a password full of shell metacharacters through untouched', async () => {
		const password = 'p$HOME"`id`\'; x';
		const escaped = password.replace(/'/g, "''");
		await getRawSql().unsafe(`DROP ROLE IF EXISTS seed_shell_test`);
		await getRawSql().unsafe(`CREATE ROLE seed_shell_test LOGIN PASSWORD '${escaped}'`);

		const url = new URL(DATABASE_URL);
		url.username = 'seed_shell_test';
		url.password = encodeURIComponent(password);
		const file = writeDump('select.sql.gz', 'SELECT 1;\n');
		await expect(restoreGzipDump(file, url.toString())).resolves.toBeUndefined();
	});
});
