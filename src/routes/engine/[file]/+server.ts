// GET /engine/<file> — the in-browser Stockfish build (see $lib/engine).
//
// These files live in /engine rather than /static because static files skip
// hooks.server.ts. The multi-threaded engine only runs when both the page and
// the worker script are cross-origin isolated, so the worker script must carry
// the same COOP/COEP headers the hooks add to every page.

import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

const ENGINE_DIR = path.join(process.cwd(), 'engine');

// Only these files are served. The names carry the Stockfish version, so a
// browser may cache them for good; a new version ships under new names.
const FILES: Record<string, string> = {
	'stockfish-19-lite.js': 'text/javascript; charset=utf-8',
	'stockfish-19-lite.wasm': 'application/wasm',
	'stockfish-19-lite-single.js': 'text/javascript; charset=utf-8',
	'stockfish-19-lite-single.wasm': 'application/wasm'
};

export const GET: RequestHandler = async ({ params }) => {
	const contentType = FILES[params.file];
	if (!contentType) throw error(404, 'Not found');

	// Safe: params.file is one of the FILES keys checked above.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const body = await readFile(path.join(ENGINE_DIR, params.file));
	return new Response(body, {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
};
