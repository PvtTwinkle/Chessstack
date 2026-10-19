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
		<label class="setting-label" for="account-email">Email</label>
		<p class="setting-hint" id="account-email-hint">
			Used for account recovery. One email per account. Changing it needs your current password.
		</p>
		<!-- Forms, so Enter submits and password managers recognise the fields. -->
		<form
			class="email-form"
			onsubmit={(e) => {
				e.preventDefault();
				settings.saveEmail();
			}}
		>
			<input
				id="account-email"
				type="email"
				placeholder="your@email.com"
				autocomplete="email"
				maxlength="254"
				aria-describedby="account-email-hint"
				bind:value={settings.email}
			/>
			<input
				type="password"
				placeholder="Current password"
				autocomplete="current-password"
				aria-label="Current password, to confirm the email change"
				bind:value={settings.emailPassword}
			/>
			<button type="submit" class="btn-primary" disabled={settings.savingEmail}>
				{settings.savingEmail ? 'Saving...' : 'Save Email'}
			</button>
		</form>
		{#if settings.emailError}
			<p class="error-msg" role="alert">{settings.emailError}</p>
		{/if}
		<p class="success-msg" role="status">{settings.emailStatus}</p>
	</div>

	<div class="setting-row">
		<span class="setting-label" id="change-password-label">Change Password</span>

		<form
			class="password-form"
			aria-labelledby="change-password-label"
			onsubmit={(e) => {
				e.preventDefault();
				settings.changePassword();
			}}
		>
			<label class="visually-hidden" for="current-password">Current password</label>
			<input
				id="current-password"
				type="password"
				placeholder="Current password"
				autocomplete="current-password"
				bind:value={settings.currentPassword}
			/>
			<label class="visually-hidden" for="new-password">New password</label>
			<input
				id="new-password"
				type="password"
				placeholder="New password (min 12 characters)"
				autocomplete="new-password"
				bind:value={settings.newPassword}
			/>
			<label class="visually-hidden" for="confirm-password">Confirm new password</label>
			<input
				id="confirm-password"
				type="password"
				placeholder="Confirm new password"
				autocomplete="new-password"
				bind:value={settings.confirmPassword}
			/>
			<button type="submit" class="btn-primary" disabled={settings.changingPassword}>
				{settings.changingPassword ? 'Changing...' : 'Change Password'}
			</button>
		</form>

		{#if settings.passwordError}
			<p class="error-msg" role="alert">{settings.passwordError}</p>
		{/if}
		<p class="success-msg" role="status">{settings.passwordStatus}</p>
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
		flex-wrap: wrap;
		gap: var(--space-3);
		max-width: 420px;
		align-items: center;
	}

	.email-form input {
		flex: 1 1 180px;
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

	.success-msg:empty {
		margin: 0;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	/* ── Tablets and phones (< 768px) ── --bp-md */
	@media (max-width: 767px) {
		.password-form {
			max-width: 100%;
		}

		.password-form input,
		.email-form input {
			font-size: 16px; /* prevents iOS auto-zoom on focus */
		}
	}
</style>
