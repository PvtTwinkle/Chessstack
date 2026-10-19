/**
 * Trim node_modules to what the built server can load, for the Docker image.
 *
 * Runs in the Dockerfile's builder stage after `npm prune --omit=dev`. That
 * prune still leaves about 110 MB of build tooling (Vite, Rolldown,
 * TypeScript, Lightning CSS, esbuild), because npm installs the peer
 * dependencies of @sentry/sveltekit and @sveltejs/kit even though the built
 * server never imports them.
 *
 * Starting from package.json's `dependencies` plus RUNTIME_PEERS, this follows
 * each package's `dependencies` and `optionalDependencies` (not its peers),
 * resolving names the way Node does, and deletes every installed package it
 * didn't reach.
 *
 * Usage: node scripts/prune-runtime-deps.mjs [appDir]
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Peers the server does import at runtime: @sentry/sveltekit's server entry
// imports @sveltejs/kit. Everything else that arrives only as a peer is
// build-time tooling.
const RUNTIME_PEERS = ['@sveltejs/kit'];

const app = resolve(process.argv[2] ?? '.');

function readPackage(dir) {
	return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

// Node's lookup: the nearest node_modules/<name> walking up from `fromDir`.
function locate(name, fromDir) {
	for (let dir = fromDir; ; dir = dirname(dir)) {
		const candidate = join(dir, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) return candidate;
		if (dirname(dir) === dir) return null;
	}
}

const keep = new Set();
function visit(name, fromDir) {
	const dir = locate(name, fromDir);
	if (!dir || keep.has(dir)) return;
	keep.add(dir);
	const pkg = readPackage(dir);
	for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
		visit(dep, dir);
	}
}

for (const name of [...Object.keys(readPackage(app).dependencies ?? {}), ...RUNTIME_PEERS]) {
	if (!locate(name, app)) throw new Error(`${name} is not installed in ${app}`);
	visit(name, app);
}

// Every installed package directory under a node_modules folder, including
// scoped ones and nested node_modules inside kept packages.
let removed = 0;
function sweep(modulesDir) {
	if (!existsSync(modulesDir)) return;
	for (const entry of readdirSync(modulesDir)) {
		if (entry.startsWith('.')) continue;
		const dirs = entry.startsWith('@')
			? readdirSync(join(modulesDir, entry)).map((s) => join(modulesDir, entry, s))
			: [join(modulesDir, entry)];
		for (const dir of dirs) {
			if (keep.has(dir)) {
				sweep(join(dir, 'node_modules'));
			} else {
				rmSync(dir, { recursive: true, force: true });
				removed++;
			}
		}
	}
}
sweep(join(app, 'node_modules'));
// The executables' links mostly point at packages removed above.
rmSync(join(app, 'node_modules', '.bin'), { recursive: true, force: true });

console.log(`Kept ${keep.size} packages, removed ${removed}.`);
