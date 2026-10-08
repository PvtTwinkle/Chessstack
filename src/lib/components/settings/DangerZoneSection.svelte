<!--
	Settings → Danger Zone: permanently delete the account after confirming the
	password. Any active Stripe subscription is cancelled by the API.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';

	let showDeleteModal = $state(false);
	let deletePassword = $state('');
	let deletingAccount = $state(false);
	let deleteError = $state('');

	function openDeleteModal() {
		deletePassword = '';
		deleteError = '';
		showDeleteModal = true;
	}

	async function confirmDeleteAccount() {
		if (!deletePassword) {
			deleteError = 'Please enter your password';
			return;
		}
		deletingAccount = true;
		deleteError = '';
		try {
			const res = await fetch('/api/auth/delete-account', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: deletePassword })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				deleteError = body?.message ?? 'Failed to delete account';
				return;
			}
			// Hard redirect to clear all client state.
			window.location.href = '/';
		} catch {
			deleteError = 'Network error — please try again';
		} finally {
			deletingAccount = false;
		}
	}
</script>

<SettingsSection title="Danger Zone" danger>
	<div class="setting-row">
		<span class="setting-label">Delete Account</span>
		<p class="setting-hint">
			Permanently delete your account and all associated data. This action cannot be undone.
		</p>
		<button class="btn-danger" onclick={openDeleteModal}>Delete My Account</button>
	</div>
</SettingsSection>

{#if showDeleteModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop"
		onkeydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		onclick={() => (showDeleteModal = false)}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div class="modal-content" onclick={(e) => e.stopPropagation()}>
			<h3 class="modal-title">Delete Account</h3>
			<p class="modal-warning">
				This will <strong>permanently delete</strong> your account, repertoires, drill history, and all
				other data. If you have an active subscription it will be cancelled.
			</p>
			<p class="modal-warning">This cannot be undone.</p>

			<label class="modal-label" for="delete-password">Enter your password to confirm</label>
			<input
				id="delete-password"
				type="password"
				autocomplete="current-password"
				placeholder="Password"
				bind:value={deletePassword}
				onkeydown={(e) => e.key === 'Enter' && confirmDeleteAccount()}
			/>

			{#if deleteError}
				<p class="error-msg">{deleteError}</p>
			{/if}

			<div class="modal-actions">
				<button class="btn-cancel" onclick={() => (showDeleteModal = false)}>Cancel</button>
				<button class="btn-danger" onclick={confirmDeleteAccount} disabled={deletingAccount}>
					{deletingAccount ? 'Deleting...' : 'Delete Account'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.btn-danger {
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-danger);
		color: #fff;
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		transition:
			opacity var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	.btn-danger:hover:not(:disabled) {
		opacity: 0.9;
	}

	.btn-danger:active:not(:disabled) {
		transform: scale(0.97);
	}

	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Delete account modal ─────────────────────────────────────── */

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal-content {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		max-width: 420px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.modal-title {
		margin: 0 0 var(--space-4);
		font-size: 16px;
		font-weight: 600;
		color: var(--color-danger);
	}

	.modal-warning {
		margin: 0 0 var(--space-3);
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.modal-label {
		display: block;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
		margin-top: var(--space-4);
	}

	.modal-content input[type='password'] {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		box-sizing: border-box;
	}

	.modal-content input[type='password']:focus {
		outline: none;
		border-color: var(--color-danger);
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
	}

	.modal-actions {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		margin-top: var(--space-5);
	}

	.btn-cancel {
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-alt);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-cancel:hover {
		border-color: var(--color-text-muted);
	}

	.error-msg {
		margin: var(--space-2) 0 0;
		font-size: 13px;
		color: var(--color-danger);
	}
</style>
