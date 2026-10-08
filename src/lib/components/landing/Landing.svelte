<!--
	The logged-out home page. The open-source edition has no public website, so
	this only links to sign-in; self-hosted instances never show it, because
	they send logged-out visitors straight to /login.
-->
<script lang="ts">
	import logoIcon from '$lib/assets/logo-icon.svg';
	import { base } from '$app/paths';
	import type { LandingData } from '$lib/landing/landing.server';

	let { registrationMode }: LandingData & { registrationMode: string } = $props();
</script>

<svelte:head>
	<title>Chessstack</title>
</svelte:head>

<main class="landing">
	<div class="card">
		<div class="logo">
			<img src={logoIcon} alt="" class="logo-icon" />
			<span class="logo-text">Chessstack</span>
		</div>
		<p>Build your chess opening repertoire and train it with spaced repetition.</p>
		<div class="actions">
			<a class="primary" href="{base}/login">Log in</a>
			{#if registrationMode === 'open'}
				<a href="{base}/register">Create an account</a>
			{/if}
		</div>
	</div>
</main>

<style>
	.landing {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-base);
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-10);
		width: 100%;
		max-width: 380px;
		color: var(--color-text-secondary);
	}

	.logo {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.logo-icon {
		width: 32px;
		height: 32px;
		border-radius: 6px;
		background: var(--color-logo-bg);
		padding: 1px;
	}

	.logo-text {
		font-family: var(--font-body);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	.actions {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin-top: var(--space-6);
	}

	.actions a {
		color: var(--color-text-primary);
	}

	.actions .primary {
		background: var(--color-accent);
		color: var(--color-base);
		padding: var(--space-2) var(--space-5);
		border-radius: var(--radius-md);
		text-decoration: none;
	}
</style>
