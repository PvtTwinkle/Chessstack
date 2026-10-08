<script lang="ts">
	import Seo from '$lib/components/Seo.svelte';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import logoIcon from '$lib/assets/logo-icon.svg';

	let { data }: { data: PageData } = $props();

	let sending = $state(false);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	// Detect if the initial email send failed (flag from registration redirect).
	const sendFailed = $derived($page.url.searchParams.get('send') === 'failed');

	// After 2 minutes, show a "didn't receive it?" prompt for normal arrivals.
	let showTimeoutHint = $state(false);
	onMount(() => {
		const timer = setTimeout(
			() => {
				showTimeoutHint = true;
			},
			2 * 60 * 1000
		);
		return () => clearTimeout(timer);
	});

	// Show error from query params (e.g. after clicking an expired link).
	const errorParam = $derived($page.url.searchParams.get('error'));
	const errorMessage = $derived(
		errorParam === 'invalid-or-expired'
			? 'That verification link is invalid or has expired. Please request a new one.'
			: errorParam === 'missing-token'
				? 'The verification link was incomplete. Please request a new one.'
				: errorParam
					? 'Something went wrong. Please request a new verification email.'
					: null
	);

	async function resend() {
		sending = true;
		feedback = null;
		try {
			const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
			const body = await res.json();
			if (res.ok) {
				feedback = { type: 'success', message: 'Verification email sent! Check your inbox.' };
			} else {
				feedback = {
					type: 'error',
					message: body.message ?? 'Could not send verification email. Try again later.'
				};
			}
		} catch {
			feedback = { type: 'error', message: 'Network error. Please try again.' };
		} finally {
			sending = false;
		}
	}
</script>

<Seo
	title="Verify Email | Chessstack"
	description="Verify the email address for your Chessstack account."
	noindex
/>

<div class="verify-page">
	<div class="verify-card">
		<div class="logo">
			<img class="logo-icon" src={logoIcon} alt="Chessstack logo" />
			<span class="logo-text">Chessstack</span>
		</div>
		<h1>Verify your email</h1>

		<p class="instructions">
			We sent a verification link to
			{#if data.email}
				<strong>{data.email}</strong>.
			{:else}
				your email address.
			{/if}
			Click the link in the email to activate your account.
		</p>

		{#if sendFailed}
			<p class="error" role="alert">
				We were unable to send the verification email. This may be a temporary issue. Try the resend
				button below, or contact
				<a href="mailto:support@chessstack.app" class="support-link">support@chessstack.app</a>
				for help.
			</p>
		{/if}

		{#if showTimeoutHint && !sendFailed}
			<p class="warning" role="status">
				It's been a couple of minutes. If you haven't received the email, check your spam folder or
				try resending. Still stuck? Contact
				<a href="mailto:support@chessstack.app" class="support-link">support@chessstack.app</a>.
			</p>
		{/if}

		{#if errorMessage}
			<p class="error" role="alert">{errorMessage}</p>
		{/if}

		{#if feedback}
			<p class={feedback.type} role="alert">{feedback.message}</p>
		{/if}

		<button onclick={resend} disabled={sending}>
			{sending ? 'Sending…' : 'Resend verification email'}
		</button>

		<p class="help-text">
			Didn't receive it? Check your spam folder, or click resend above.<br />
			Still having trouble? Contact us at
			<a href="mailto:support@chessstack.app" class="support-link">support@chessstack.app</a>
		</p>

		<form method="POST" action="/api/auth/logout" class="logout-form">
			<button type="submit" class="logout-btn">Sign out</button>
		</form>
	</div>
</div>

<style>
	.verify-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-base);
	}

	.verify-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-10);
		width: 100%;
		max-width: 420px;
		text-align: center;
	}

	.logo {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
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

	h1 {
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0 0 var(--space-6) 0;
		color: var(--color-text-secondary);
	}

	.instructions {
		font-size: 14px;
		color: var(--color-text-secondary);
		line-height: 1.5;
		margin-bottom: var(--space-6);
	}

	.instructions strong {
		color: var(--color-text-primary);
	}

	.error {
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-danger);
		padding: var(--space-3) var(--space-4);
		font-size: 13px;
		margin-bottom: var(--space-4);
	}

	.warning {
		background: rgba(250, 204, 21, 0.1);
		border: 1px solid rgba(250, 204, 21, 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-warning, #facc15);
		padding: var(--space-3) var(--space-4);
		font-size: 13px;
		margin-bottom: var(--space-4);
	}

	.success {
		background: rgba(74, 222, 128, 0.1);
		border: 1px solid rgba(74, 222, 128, 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-success, #4ade80);
		padding: var(--space-3) var(--space-4);
		font-size: 13px;
		margin-bottom: var(--space-4);
	}

	button {
		width: 100%;
		padding: var(--space-3);
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition:
			filter var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	button:hover:not(:disabled) {
		box-shadow: var(--glow-accent);
		filter: brightness(1.1);
	}

	button:active:not(:disabled) {
		transform: scale(0.97);
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.help-text {
		font-size: 12px;
		color: var(--color-text-muted);
		margin-top: var(--space-4);
		line-height: 1.5;
	}

	.support-link {
		color: var(--color-accent);
		text-decoration: none;
	}

	.support-link:hover {
		text-decoration: underline;
	}

	.logout-form {
		margin-top: var(--space-6);
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-6);
	}

	.logout-btn {
		background: transparent;
		color: var(--color-text-secondary);
		font-weight: 400;
		font-size: 13px;
		border: 1px solid var(--color-border);
	}

	.logout-btn:hover:not(:disabled) {
		background: var(--color-surface-alt);
		box-shadow: none;
		filter: none;
	}
</style>
