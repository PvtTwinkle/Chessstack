<!--
	Settings → Account: change the email address and the password.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import type { SettingsState } from './settingsState.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Account">
	<div class="setting-row">
		<span class="setting-label">Email</span>
		<p class="setting-hint">Used for account recovery. One email per account.</p>
		<div class="email-form">
			<input
				type="email"
				placeholder="your@email.com"
				autocomplete="email"
				maxlength="254"
				bind:value={settings.email}
			/>
			<button class="btn-primary" onclick={settings.saveEmail} disabled={settings.savingEmail}>
				{settings.savingEmail ? 'Saving...' : 'Save Email'}
			</button>
		</div>
		{#if settings.emailError}
			<p class="error-msg">{settings.emailError}</p>
		{/if}
		{#if settings.emailStatus}
			<p class="success-msg">{settings.emailStatus}</p>
		{/if}
	</div>

	<div class="setting-row">
		<span class="setting-label">Change Password</span>

		<div class="password-form">
			<input
				type="password"
				placeholder="Current password"
				autocomplete="current-password"
				bind:value={settings.currentPassword}
			/>
			<input
				type="password"
				placeholder="New password (min 12 characters)"
				autocomplete="new-password"
				bind:value={settings.newPassword}
			/>
			<input
				type="password"
				placeholder="Confirm new password"
				autocomplete="new-password"
				bind:value={settings.confirmPassword}
			/>
			<button
				class="btn-primary"
				onclick={settings.changePassword}
				disabled={settings.changingPassword}
			>
				{settings.changingPassword ? 'Changing...' : 'Change Password'}
			</button>
		</div>

		{#if settings.passwordError}
			<p class="error-msg">{settings.passwordError}</p>
		{/if}
		{#if settings.passwordStatus}
			<p class="success-msg">{settings.passwordStatus}</p>
		{/if}
	</div>
</SettingsSection>

<style>
	/* ── Password form ─────────────────────────────────────────────── */

	.password-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 320px;
	}

	.password-form input {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.password-form input::placeholder {
		color: var(--color-text-muted);
	}

	.password-form input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	/* ── Email form ────────────────────────────────────────────────── */

	.email-form {
		display: flex;
		gap: var(--space-3);
		max-width: 420px;
		align-items: center;
	}

	.email-form input {
		flex: 1;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.email-form input::placeholder {
		color: var(--color-text-muted);
	}

	.email-form input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.success-msg {
		margin: var(--space-2) 0 0;
		font-size: 13px;
		color: var(--color-success);
	}

	/* ── Tablets and phones (< 768px) ── --bp-md */
	@media (max-width: 767px) {
		.password-form {
			max-width: 100%;
		}

		.password-form input {
			font-size: 16px; /* prevents iOS auto-zoom on focus */
		}
	}
</style>
