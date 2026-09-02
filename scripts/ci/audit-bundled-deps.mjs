#!/usr/bin/env node
// Audits vulnerabilities in packages that end up compiled into build/index.js
// (the production Node server) even though npm classifies them as
// devDependencies. With adapter-node, `vite build` inlines the source of
// @sveltejs/kit and svelte directly into the server bundle, and
// `npm prune --omit=dev` then removes the packages themselves from the
// final Docker image's node_modules — so the code still runs in
// production, but `npm audit --omit=dev` never sees it.
//
// Method: walk the real `dependencies` (never `peerDependencies` — those
// are build-time tooling like vite/typescript that is never bundled) of
// the three roots below, recursively, using what npm actually installed
// in node_modules. Cross-reference that set against `npm audit --json`.
//
// Known limitation, accepted deliberately (see security.yml PR discussion):
// this walk is a proxy for "compiled into the bundle", not a guarantee.
// Two categories can be flagged without being a true runtime risk:
//   - rollup / @rollup/plugin-* — real dependency of @sveltejs/adapter-node,
//     but only executed by adapter-node during `vite build` to bundle its
//     own runtime shim, not inside the running server process afterwards.
//     A CVE here is a build-time supply-chain risk, not a request-time one.
//   - @typescript-eslint/types — real dependency of esrap (a real
//     dependency of svelte), but contains only TypeScript type
//     declarations, no executable code.
// Do not silently exclude these in code. If either fires, read the
// advisory and judge it on its merits, then decide by hand.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOTS = ['@sveltejs/kit', 'svelte', '@sveltejs/adapter-node'];
const NODE_MODULES = 'node_modules';

function resolveBundledPackages() {
  const visited = new Set();
  function walk(pkgName) {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);
    const pkgJsonPath = join(NODE_MODULES, pkgName, 'package.json');
    if (!existsSync(pkgJsonPath)) return;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    for (const dep of Object.keys(pkg.dependencies || {})) walk(dep);
  }
  for (const r of ROOTS) walk(r);
  return visited;
}

function runAudit() {
  try {
    const out = execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      // Without shell: true, Windows fails with ENOENT because `npm` is
      // actually `npm.cmd` (a batch script) and execFileSync doesn't
      // resolve that through PATH on its own. shell: true works
      // identically on Linux (CI runs on ubuntu-latest).
      shell: true
    });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits non-zero when it finds vulnerabilities; stdout still
    // has the JSON report in that case.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

const bundled = resolveBundledPackages();
const audit = runAudit();
const vulns = audit.vulnerabilities || {};

const flagged = Object.entries(vulns).filter(([name]) => bundled.has(name));

console.log(`Resolved ${bundled.size} packages reachable from ${ROOTS.join(', ')} (dependencies only, not peerDependencies).`);
console.log(`npm audit reported ${Object.keys(vulns).length} vulnerable package(s) total.`);

if (flagged.length === 0) {
  console.log('None of them are in the production-bundled set. OK.');
  process.exit(0);
}

console.log('\nVulnerabilities affecting packages compiled into the production build:\n');
for (const [name, info] of flagged) {
  console.log(`  - ${name} (severity: ${info.severity}, range: ${info.range})`);
}
console.log(
  '\nIf this list is only "rollup", "@rollup/plugin-*", or ' +
  '"@typescript-eslint/types", read the comment at the top of this script ' +
  'before treating it as a confirmed production runtime issue.'
);
process.exit(1);