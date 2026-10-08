<script lang="ts">
	import Seo from '$lib/components/Seo.svelte';
	import type { ActionData, PageData } from './$types';
	import { base } from '$app/paths';
	import { PASSWORD_HINT } from '$lib/auth/password';
	import logoIcon from '$lib/assets/logo-icon.svg';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<Seo
	title="Reset Password | Chessstack"
	description="Set a new password for your Chessstack account."
	noindex
/>

<div class="login-page">
	<div class="login-card">
		<div class="logo">
			<img class="logo-icon" src={logoIcon} alt="Chessstack logo" />
			<span class="logo-text">Chessstack</span>
		</div>
		<h1>Reset password</h1>

		{#if form?.success}
			<p class="success">
				Your password has been reset. You can now sign in with your new password.
			</p>
			<a class="action-link" href="{base}/login">Sign in</a>
		{:else if !data.hasToken}
			<p class="error" role="alert">Invalid reset link. Please request a new one.</p>
			<a class="action-link" href="{base}/forgot-password">Request new reset link</a>
			<p class="help-text">
				Still having trouble? Contact
				<a href="mailto:support@chessstack.app" class="support-link">support@chessstack.app</a>
			</p>
		{:else}
			<form method="POST">
				<input type="hidden" name="token" value={data.token} />

				{#if form?.error}
					<p class="error" role="alert">{form.error}</p>
				{/if}

				<div class="field">
					<label for="password">New password</label>
					<input
						id="password"
						type="password"
						name="password"
						required
						autocomplete="new-password"
					/>
					<p class="hint">{PASSWORD_HINT}</p>
				</div>

				<div class="field">
					<label for="confirmPassword">Confirm password</label>
					<input
						id="confirmPassword"
						type="password"
						name="confirmPassword"
						required
						autocomplete="new-password"
					/>
				</div>

				<button type="submit">Reset password</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-base);
	}

	.login-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-10);
		width: 100%;
		max-width: 380px;
	}

	.logo {
		display: flex;
		align-items: center;
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
		margin: 0 0 var(--space-8) 0;
		color: var(--color-text-secondary);
	}

	.field {
		margin-bottom: var(--space-5);
	}

	label {
		display: block;
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
	}

	input[type='password'] {
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 14px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	input[type='password']:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.hint {
		font-size: 12px;
		color: var(--color-text-muted);
		margin-top: var(--space-2);
		line-height: 1.4;
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

	.success {
		background: rgba(74, 222, 128, 0.1);
		border: 1px solid rgba(74, 222, 128, 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-success);
		padding: var(--space-3) var(--space-4);
		font-size: 13px;
		line-height: 1.5;
		margin-bottom: var(--space-6);
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
		margin-top: var(--space-2);
		transition:
			filter var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	button:hover {
		box-shadow: var(--glow-accent);
		filter: brightness(1.1);
	}

	button:active {
		transform: scale(0.97);
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

	.action-link {
		display: block;
		text-align: center;
		margin-top: var(--space-6);
		font-size: 13px;
		color: var(--color-accent);
		text-decoration: none;
	}

	.action-link:hover {
		text-decoration: underline;
	}
</style>
