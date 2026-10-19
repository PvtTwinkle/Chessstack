// adapter-node compiles SvelteKit into a plain Node.js HTTP server.
// This is the correct adapter for a self-hosted Docker deployment.
// The built output lands in /build and is started with: node build/index.js
import adapter from '@sveltejs/adapter-node';
import { mdsvex } from 'mdsvex';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.md'],
	preprocess: [
		mdsvex({
			extensions: ['.md']
		})
	],
	kit: {
		adapter: adapter(),
		// SvelteKit adds a per-request nonce to its inline hydration scripts and
		// sends it in a script-src header. hooks.server.ts merges that nonce into
		// the full policy from $lib/server/security-headers, which no longer
		// needs 'unsafe-inline' for scripts.
		csp: {
			mode: 'nonce',
			directives: { 'script-src': ['self'] }
		}
	}
};

export default config;
