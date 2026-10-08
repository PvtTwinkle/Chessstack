// Vitest environment for testing Svelte 5 runes modules (*.svelte.test.ts).
//
// The plain `node` environment transforms modules for SSR, and Svelte's
// server build turns $effect into a no-op. This is the node environment with
// the client transform, so runes compile as they do in the browser and
// effects run (inside $effect.root). Paired with the browser resolve
// condition in vite.config.ts so `svelte` itself resolves to its client build.

import { builtinEnvironments, type Environment } from 'vitest/runtime';

export default {
	...builtinEnvironments.node,
	name: 'svelte-client',
	viteEnvironment: 'client'
} satisfies Environment;
