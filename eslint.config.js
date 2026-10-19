import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import pluginSecurity from 'eslint-plugin-security';
import pluginNoUnsanitized from 'eslint-plugin-no-unsanitized';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Vendored, minified Stockfish build (see engine/README.md), and the
	// open-source edition's files, which are linted once exported.
	{ ignores: ['engine/', 'open-source/files/'] },
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	pluginSecurity.configs.recommended,
	pluginNoUnsanitized.configs.recommended,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',

			// The rule wants every internal URL passed through resolve() from $app/paths. Links
			// here are still built with {base}, so they are exempt and only goto() calls are
			// checked. SvelteKit 3 deprecates {base} links; moving them to resolve() is listed in
			// docs/sveltekit-3-migration.md.
			'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }],

			// These security rules produce overwhelmingly false positives in this codebase.
			// detect-object-injection flags every arr[i] and obj[key] — all 30+ hits are
			// safe numeric array indexing, not user-controlled property access.
			// detect-possible-timing-attacks flags every === comparison — actual password
			// checking uses bcrypt.compare() which is already timing-safe.
			'security/detect-object-injection': 'off',
			'security/detect-possible-timing-attacks': 'off'
		}
	},
	{
		// Build scripts and tests read and write files in the repository at paths they
		// build themselves (a table name, a lesson file); none comes from a request.
		files: ['scripts/**', 'e2e/**', '**/*.test.ts'],
		rules: { 'security/detect-non-literal-fs-filename': 'off' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
