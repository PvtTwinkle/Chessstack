<script lang="ts">
	import Seo from '$lib/components/Seo.svelte';
	import { MONTHLY_PLAN, formatPrice } from '$lib/seo/pricing';
	import type { ActionData, PageData } from './$types';
	import { base } from '$app/paths';
	import { PASSWORD_HINT } from '$lib/auth/password';
	import logoIcon from '$lib/assets/logo-icon.svg';

	// ActionData is a union of all fail() shapes from the server action.
	// Cast to include referralCodeError so TypeScript accepts the template references.
	type FormData = (ActionData & { referralCodeError?: string }) | null;
	let { form, data }: { form: FormData; data: PageData } = $props();

	let redirectQuery = $derived(
		data.redirectTo ? `?redirectTo=${encodeURIComponent(data.redirectTo)}` : ''
	);

	const monthlyPrice = formatPrice(MONTHLY_PLAN.price);
	// Self-hosted instances have no plans or referral codes, and the email is optional.
	let isCloud = $derived(data.edition === 'cloud');
</script>

<Seo
	title={isCloud
		? 'Create a Free Account | Chessstack Opening Trainer'
		: 'Create Account | Chessstack'}
	description={isCloud
		? `Sign up free and build your first chess opening repertoire in minutes, then drill it with spaced repetition. No credit card needed. Unlimited from ${monthlyPrice}/month.`
		: 'Create a Chessstack account to build and drill your chess opening repertoire.'}
	path="/register"
	noindex={!isCloud}
/>

<div class="register-page">
	<div class="register-card">
		<div class="logo">
			<img class="logo-icon" src={logoIcon} alt="Chessstack logo" />
			<span class="logo-text">Chessstack</span>
		</div>
		<h1>Create account</h1>

		<form method="POST">
			{#if data.redirectTo}
				<input type="hidden" name="redirectTo" value={data.redirectTo} />
			{/if}
			{#if form?.error}
				<p class="error" role="alert">{form.error}</p>
			{/if}

			<div class="field">
				<label for="username">Username</label>
				<input
					id="username"
					type="text"
					name="username"
					required
					minlength="3"
					maxlength="30"
					pattern="[a-zA-Z0-9_-]+"
					autocomplete="username"
				/>
				<span class="hint">3–30 characters. Letters, numbers, hyphens, underscores.</span>
			</div>

			<div class="field">
				<label for="email">
					Email
					{#if !isCloud}<span class="label-optional">(optional)</span>{/if}
				</label>
				<input
					id="email"
					type="email"
					name="email"
					required={isCloud}
					maxlength="254"
					autocomplete="email"
				/>
				<span class="hint">Used for account recovery. One email per account.</span>
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					type="password"
					name="password"
					required
					minlength="12"
					autocomplete="new-password"
				/>
				<span class="hint">{PASSWORD_HINT}</span>
			</div>

			<div class="field">
				<label for="confirmPassword">Confirm password</label>
				<input
					id="confirmPassword"
					type="password"
					name="confirmPassword"
					required
					minlength="12"
					autocomplete="new-password"
				/>
			</div>

			{#if isCloud}
				<div class="field">
					<label for="referralCode">
						Referral code
						<span class="label-optional">(optional)</span>
					</label>
					<input
						id="referralCode"
						type="text"
						name="referralCode"
						maxlength="8"
						autocomplete="off"
						style="text-transform: uppercase;"
						placeholder="e.g. AB2K9M7R"
						class:input-error={form?.referralCodeError}
					/>
					{#if form?.referralCodeError}
						<span class="error-inline" role="alert">{form.referralCodeError}</span>
					{:else}
						<span class="hint">Have a friend's code? Enter it here for 50% off annual.</span>
					{/if}
				</div>
			{/if}

			<button type="submit">Create account</button>
		</form>

		<p class="signin-link">
			Already have an account? <a href="{base}/login{redirectQuery}">Sign in</a>
		</p>
	</div>
</div>

<style>
	.register-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-base);
	}

	.register-card {
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
		color: var(--color-text-secondary);
		margin-bottom: var(--space-2);
	}

	input {
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

	input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.hint {
		display: block;
		font-size: 11px;
		color: var(--color-text-secondary);
		margin-top: var(--space-1);
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

	.signin-link {
		text-align: center;
		margin-top: var(--space-6);
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.signin-link a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.signin-link a:hover {
		text-decoration: underline;
	}

	.label-optional {
		font-weight: 400;
		font-size: 10px;
		opacity: 0.6;
		text-transform: none;
		letter-spacing: 0;
		margin-left: var(--space-1);
	}

	.input-error {
		border-color: var(--color-danger) !important;
	}

	.error-inline {
		display: block;
		font-size: 11px;
		color: var(--color-danger);
		margin-top: var(--space-1);
	}
</style>
