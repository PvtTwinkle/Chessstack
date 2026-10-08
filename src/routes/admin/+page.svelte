<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import UserList from '$lib/components/admin/UserList.svelte';

	let { data }: { data: PageData } = $props();
	// Self-hosted instances have no plans, and accounts there may have no email.
	let isCloud = $derived(data.edition === 'cloud');

	// ── Create User ────────────────────────────────────────────────────────
	let showCreateForm = $state(false);
	let newUsername = $state('');
	let newEmail = $state('');
	let newPassword = $state('');
	let createError = $state('');
	let creating = $state(false);

	async function createUser() {
		createError = '';
		if (!newUsername.trim() || (isCloud && !newEmail.trim()) || !newPassword) {
			createError = isCloud
				? 'Username, email, and password are required.'
				: 'Username and password are required.';
			return;
		}
		creating = true;
		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: newUsername.trim(),
					email: newEmail.trim(),
					password: newPassword
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to create user' }));
				createError = err.message ?? 'Failed to create user';
				return;
			}
			newUsername = '';
			newEmail = '';
			newPassword = '';
			showCreateForm = false;
			await invalidateAll();
		} catch {
			createError = 'Network error — please try again.';
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>Admin — Chessstack</title>
</svelte:head>

<div class="admin-page">
	<h1>User Management</h1>

	<div class="admin-content">
		<!-- ── Info Bar ────────────────────────────────────────────────── -->
		<section class="admin-section info-bar">
			<div class="info-item">
				<span class="info-label">Total Users</span>
				<span class="info-value">{data.totalUsers}</span>
			</div>
			<div class="info-item">
				<span class="info-label">Registration</span>
				<span class="info-value mode-badge" class:mode-open={data.registrationMode === 'open'}>
					{data.registrationMode}
				</span>
			</div>
		</section>

		<!-- ── Create User ────────────────────────────────────────────── -->
		<section class="admin-section">
			<h2>Create User</h2>
			{#if showCreateForm}
				<div class="create-form">
					<input
						type="text"
						placeholder="Username"
						bind:value={newUsername}
						minlength="3"
						maxlength="30"
					/>
					<input
						type="email"
						placeholder={isCloud ? 'Email' : 'Email (optional)'}
						bind:value={newEmail}
						maxlength="254"
					/>
					<input
						type="password"
						placeholder="Password (min 12 characters)"
						bind:value={newPassword}
						minlength="12"
					/>
					{#if createError}
						<p class="error-msg">{createError}</p>
					{/if}
					<div class="form-actions">
						<button class="btn-primary" onclick={createUser} disabled={creating}>
							{creating ? 'Creating...' : 'Create'}
						</button>
						<button
							class="btn-secondary"
							onclick={() => {
								showCreateForm = false;
								createError = '';
							}}
						>
							Cancel
						</button>
					</div>
				</div>
			{:else}
				<button class="btn-primary" onclick={() => (showCreateForm = true)}> + New User </button>
			{/if}
		</section>

		<!-- ── User List ──────────────────────────────────────────────── -->
		<section class="admin-section">
			<h2>Users</h2>

			<UserList
				users={data.users}
				searchQuery={data.searchQuery}
				totalUsers={data.totalUsers}
				page={data.page}
				totalPages={data.totalPages}
				currentUserId={data.user?.id}
				{isCloud}
			/>
		</section>
	</div>
</div>

<style>
	/* ── Page Layout ──────────────────────────────────────────────── */

	.admin-page {
		max-width: 820px;
		margin: 0 auto;
	}

	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-body);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

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

	.admin-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.admin-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		box-shadow: var(--shadow-surface);
	}

	/* ── Info Bar ─────────────────────────────────────────────────── */

	.info-bar {
		display: flex;
		gap: var(--space-8);
		padding: var(--space-4) var(--space-6);
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.info-label {
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
	}

	.info-value {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.mode-badge {
		text-transform: capitalize;
	}

	.mode-open {
		color: var(--color-success);
	}

	/* ── Create Form ──────────────────────────────────────────────── */

	.create-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 320px;
	}

	.create-form input {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
	}

	.create-form input::placeholder {
		color: var(--color-text-muted);
	}

	.create-form input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.form-actions {
		display: flex;
		gap: var(--space-3);
	}

	/* ── Buttons ──────────────────────────────────────────────────── */

	.btn-primary {
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: var(--color-base);
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		transition:
			box-shadow var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	.btn-primary:hover:not(:disabled) {
		box-shadow: var(--glow-accent);
	}

	.btn-primary:active:not(:disabled) {
		transform: scale(0.97);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
	}

	.btn-secondary:hover {
		border-color: var(--color-text-muted);
	}

	.error-msg {
		font-size: 13px;
		color: var(--color-danger);
	}

	/* ── Responsive ───────────────────────────────────────────────── */

	@media (max-width: 767px) {
		.info-bar {
			flex-direction: column;
			gap: var(--space-3);
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.admin-section {
			padding: var(--space-3);
		}
	}
</style>
