<!--
	Settings → Danger Zone: permanently delete the account after confirming the
	password. Any active Stripe subscription is cancelled by the API.
-->
<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
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

<Modal bind:open={showDeleteModal} title="Delete Account" danger dismissible={!deletingAccount}>
	<p class="modal-warning">
		This will <strong>permanently delete</strong> your account, repertoires, drill history, and all other
		data. If you have an active subscription it will be cancelled.
	</p>
	<p class="modal-warning">This cannot be undone.</p>

	<!-- A form, so Enter submits and password managers recognise the field. -->
	<form
		class="delete-form"
		onsubmit={(e) => {
			e.preventDefault();
			confirmDeleteAccount();
		}}
	>
		<label class="modal-label" for="delete-password">Enter your password to confirm</label>
		<input
			id="delete-password"
			type="password"
			autocomplete="current-password"
			placeholder="Password"
			bind:value={deletePassword}
		/>

		{#if deleteError}
			<p class="modal-error" role="alert">{deleteError}</p>
		{/if}

		<div class="modal-actions">
			<button
				type="button"
				class="modal-btn modal-btn--cancel"
				onclick={() => (showDeleteModal = false)}
				disabled={deletingAccount}>Cancel</button
			>
			<button type="submit" class="modal-btn modal-btn--danger" disabled={deletingAccount}>
				{deletingAccount ? 'Deleting...' : 'Delete Account'}
			</button>
		</div>
	</form>
</Modal>

<style>
	.btn-danger {
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-danger-fill);
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

	.modal-warning {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.delete-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.modal-label {
		display: block;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.delete-form input[type='password'] {
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

	.delete-form input[type='password']:focus {
		outline: none;
		border-color: var(--color-danger);
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
	}

	.delete-form .modal-actions {
		margin-top: var(--space-2);
	}
</style>
