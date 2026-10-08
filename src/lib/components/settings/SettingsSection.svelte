<!--
	A card section with the look of the sections on the Settings page.

	Every section of the Settings page is its own component wrapped in this
	one. The generic styles below (rows, labels, hints, inputs, buttons and
	status messages) apply to all of their content.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		id,
		danger = false,
		children
	}: {
		title: string;
		/** Optional anchor id for the heading, e.g. "subscription" for /settings#subscription. */
		id?: string;
		/** Red "danger zone" styling. */
		danger?: boolean;
		children: Snippet;
	} = $props();
</script>

<section class="settings-section" class:danger-zone={danger}>
	<h2 {id} class:danger-heading={danger}>{title}</h2>
	{@render children()}
</section>

<style>
	h2 {
		margin: 0 0 var(--space-4);
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--space-3);
	}

	.settings-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		box-shadow: var(--shadow-surface);
		/* Isolate stacking context so Chessground's z-indexed children
		   in the board preview can't escape and overlay other sections. */
		position: relative;
		z-index: 0;
	}

	.danger-zone {
		border-color: rgba(239, 68, 68, 0.3);
	}

	.danger-heading {
		color: var(--color-danger);
		border-bottom-color: rgba(239, 68, 68, 0.3);
	}

	/* ── Generic content styles, applied to the children of the section ── */

	.settings-section :global(.setting-row) {
		margin-bottom: var(--space-5);
	}

	.settings-section :global(.setting-row:last-child) {
		margin-bottom: 0;
	}

	.settings-section :global(.setting-label) {
		display: block;
		font-size: 13px;
		color: var(--color-text-secondary);
		margin-bottom: var(--space-2);
	}

	.settings-section :global(.setting-hint) {
		margin: var(--space-1) 0 0;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.settings-section :global(.setting-hint a) {
		color: var(--color-accent);
		text-decoration: underline;
	}

	.settings-section :global(.username-input-row) {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		max-width: 320px;
	}

	.settings-section :global(.username-input) {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.settings-section :global(.username-input::placeholder) {
		color: var(--color-text-muted);
	}

	.settings-section :global(.username-input:focus) {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.settings-section :global(.btn-save) {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.settings-section :global(.btn-save:hover:not(:disabled)) {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.settings-section :global(.btn-save:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.settings-section :global(.btn-primary) {
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: var(--color-base);
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		align-self: flex-start;
		transition:
			box-shadow var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	.settings-section :global(.btn-primary:hover:not(:disabled)) {
		box-shadow: var(--glow-accent);
	}

	.settings-section :global(.btn-primary:active:not(:disabled)) {
		transform: scale(0.97);
	}

	.settings-section :global(.btn-primary:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.settings-section :global(.status-msg) {
		display: block;
		font-size: 12px;
		color: var(--color-success);
		margin-top: var(--space-1);
	}

	.settings-section :global(.error-msg) {
		margin: var(--space-2) 0 0;
		font-size: 13px;
		color: var(--color-danger);
	}

	/* ── Tablets and phones (< 768px) ── --bp-md */
	@media (max-width: 767px) {
		.settings-section :global(.btn-save),
		.settings-section :global(.btn-primary) {
			min-height: 44px;
		}

		.settings-section :global(.username-input-row) {
			max-width: 100%;
		}

		.settings-section :global(.username-input) {
			font-size: 16px; /* prevents iOS auto-zoom on focus */
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.settings-section {
			padding: var(--space-3);
		}

		.settings-section :global(.username-input-row) {
			flex-direction: column;
		}
	}
</style>
