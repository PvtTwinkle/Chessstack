<script lang="ts">
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';

	const titles: Record<number, string> = {
		404: 'Page not found',
		403: 'Access denied',
		500: 'Something went wrong'
	};

	let status = $derived($page.status);
	let title = $derived(titles[status] ?? 'Something went wrong');
	let message = $derived($page.error?.message ?? 'An unexpected error occurred.');
	// Set for unexpected server errors (see handleError in hooks.server.ts).
	let requestId = $derived($page.error?.requestId);
	// Logged-out visitors (e.g. from a broken link in search) land on the home page.
	let backLabel = $derived($page.data.user ? 'Back to dashboard' : 'Back to home');
</script>

<!-- The HTTP status is already 404/500; noindex is a second signal for crawlers. -->
<Seo title="{title} | Chessstack" description={message} noindex />

<div class="error-page">
	<div class="error-card">
		<p class="status-code">{status}</p>
		<h1>{title}</h1>
		<p class="message">{message}</p>
		{#if requestId}
			<p class="reference">
				If you report this, please include this reference: <code>{requestId}</code>
			</p>
		{/if}
		<a class="back-link" href="{base}/">{backLabel}</a>
	</div>
</div>

<style>
	.error-page {
		min-height: 80vh;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.error-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-10);
		width: 100%;
		max-width: 380px;
		text-align: center;
	}

	.status-code {
		font-size: 48px;
		font-weight: 700;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-2) 0;
		line-height: 1;
	}

	h1 {
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0 0 var(--space-4) 0;
		color: var(--color-text-secondary);
	}

	.message {
		font-size: 14px;
		color: var(--color-text-secondary);
		line-height: 1.5;
		margin: 0 0 var(--space-8) 0;
	}

	.reference {
		font-size: 12px;
		color: var(--color-text-secondary);
		line-height: 1.5;
		margin: calc(-1 * var(--space-6)) 0 var(--space-8) 0;
		overflow-wrap: anywhere;
	}

	.back-link {
		display: block;
		width: 100%;
		padding: var(--space-3);
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		box-sizing: border-box;
		cursor: pointer;
		transition:
			filter var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	.back-link:hover {
		box-shadow: var(--glow-accent);
		filter: brightness(1.1);
	}

	.back-link:active {
		transform: scale(0.97);
	}
</style>
