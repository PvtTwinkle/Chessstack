<!--
	Admin → user list: search, one card per user with account actions, and
	pagination. The cloud-only parts of each card (subscription badges and gift
	actions) are separate components.
-->
<script lang="ts">
	import { invalidateAll, goto } from '$app/navigation';
	import { validatePassword } from '$lib/auth/password';
	import { formatDate, type AdminUser } from './admin-user';
	import SubscriptionBadges from './SubscriptionBadges.svelte';
	import GiftActions from './GiftActions.svelte';

	let {
		users,
		searchQuery,
		totalUsers,
		page,
		totalPages,
		currentUserId,
		isCloud
	}: {
		users: AdminUser[];
		searchQuery: string;
		totalUsers: number;
		page: number;
		totalPages: number;
		currentUserId: number | undefined;
		isCloud: boolean;
	} = $props();

	// ── Search ────────────────────────────────────────────────────────────
	let searchInput = $state(getInitialQuery());
	function getInitialQuery() {
		return searchQuery;
	}
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	function onSearchInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const params = new URLSearchParams();
			if (searchInput.trim()) params.set('q', searchInput.trim());
			// Reset to page 1 on new search
			goto(`?${params.toString()}`, { invalidateAll: true }); // eslint-disable-line svelte/no-navigation-without-resolve
		}, 300);
	}

	function clearSearch() {
		searchInput = '';
		goto('?', { invalidateAll: true }); // eslint-disable-line svelte/no-navigation-without-resolve
	}

	// ── Toggle Enabled ─────────────────────────────────────────────────────
	async function toggleEnabled(userId: number, currentEnabled: boolean) {
		await fetch(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !currentEnabled })
		});
		await invalidateAll();
	}

	// ── Toggle Role ────────────────────────────────────────────────────────
	async function toggleRole(userId: number, currentRole: string) {
		const newRole = currentRole === 'admin' ? 'user' : 'admin';
		const res = await fetch(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role: newRole })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			alert(err.message ?? 'Failed to change role');
			return;
		}
		await invalidateAll();
	}

	// ── Verify Email ──────────────────────────────────────────────────────
	async function verifyEmail(userId: number) {
		const res = await fetch(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ emailVerified: true })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			alert(err.message ?? 'Failed to verify email');
			return;
		}
		await invalidateAll();
	}

	// ── Rename User ────────────────────────────────────────────────────────
	let renameUserId = $state<number | null>(null);
	let renameUsername = $state('');
	let renameError = $state('');

	async function renameUser() {
		if (!renameUserId) return;
		renameError = '';
		const trimmed = renameUsername.trim();
		if (trimmed.length < 3 || trimmed.length > 30) {
			renameError = 'Username must be 3–30 characters.';
			return;
		}
		const res = await fetch(`/api/admin/users/${renameUserId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: trimmed })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			renameError = err.message ?? 'Failed to rename user';
			return;
		}
		renameUserId = null;
		renameUsername = '';
		await invalidateAll();
	}

	// ── Reset Password ─────────────────────────────────────────────────────
	let resetUserId = $state<number | null>(null);
	let resetPassword = $state('');
	let resetError = $state('');

	async function resetUserPassword() {
		if (!resetUserId) return;
		resetError = '';
		const pwErr = validatePassword(resetPassword);
		if (pwErr) {
			resetError = pwErr;
			return;
		}
		const res = await fetch(`/api/admin/users/${resetUserId}/reset-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newPassword: resetPassword })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			resetError = err.message ?? 'Failed to reset password';
			return;
		}
		resetUserId = null;
		resetPassword = '';
	}

	// ── Delete User ────────────────────────────────────────────────────────
	let confirmDeleteId = $state<number | null>(null);

	async function deleteUser(userId: number) {
		const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			alert(err.message ?? 'Failed to delete user');
			confirmDeleteId = null;
			return;
		}
		confirmDeleteId = null;
		await invalidateAll();
	}

	// ── Gift subscription picker (only one open at a time) ────────────────
	let giftPickerUserId = $state<number | null>(null);

	// ── Pagination ─────────────────────────────────────────────────────────
	function goToPage(target: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		if (searchQuery) params.set('q', searchQuery);
		if (target > 1) params.set('page', String(target));
		goto(`?${params.toString()}`, { invalidateAll: true }); // eslint-disable-line svelte/no-navigation-without-resolve
	}
</script>

<div class="users-panel">
	<!-- Search Bar -->
	<div class="search-bar">
		<input
			type="text"
			placeholder="Search by username or email..."
			bind:value={searchInput}
			oninput={onSearchInput}
		/>
		{#if searchInput}
			<button class="search-clear" onclick={clearSearch}>&times;</button>
		{/if}
	</div>
	{#if searchQuery}
		<p class="search-status">
			{totalUsers} result{totalUsers === 1 ? '' : 's'} for "{searchQuery}"
		</p>
	{/if}

	<div class="user-list">
		{#each users as u (u.id)}
			<div class="user-card" class:disabled={!u.enabled}>
				<div class="user-info">
					<div class="user-header">
						<span class="user-name">{u.username}</span>
						<span class="role-badge" class:role-admin={u.role === 'admin'}>{u.role}</span>
						{#if !u.enabled}
							<span class="status-badge disabled-badge">disabled</span>
						{/if}
						{#if u.email && !u.emailVerified}
							<span class="status-badge unverified-badge">unverified</span>
							<button
								class="action-btn action-grant"
								title="Manually mark email as verified"
								onclick={() => verifyEmail(u.id)}
							>
								Verify
							</button>
						{/if}
						{#if isCloud}
							<SubscriptionBadges user={u} />
						{/if}
					</div>
					<div class="user-meta">
						{#if u.email}
							<span class="user-email">{u.email}</span>
							<span class="meta-sep">·</span>
						{/if}
						<span class="user-date">Created {formatDate(u.createdAt)}</span>
						{#if isCloud && u.tier === 'paid' && u.currentPeriodEnd && !u.isGifted}
							<span class="meta-sep">·</span>
							<span class="user-date">
								{u.cancelAtPeriodEnd ? 'Ends' : 'Renews'}
								{formatDate(u.currentPeriodEnd)}
							</span>
						{/if}
					</div>
				</div>

				<div class="user-actions">
					{#if isCloud}
						<GiftActions user={u} bind:openPickerFor={giftPickerUserId} />
					{/if}

					<!-- Toggle enabled -->
					{#if u.id !== currentUserId}
						<button
							class="action-btn"
							class:action-danger={u.enabled}
							title={u.enabled ? 'Disable account' : 'Enable account'}
							onclick={() => toggleEnabled(u.id, u.enabled)}
						>
							{u.enabled ? 'Disable' : 'Enable'}
						</button>
					{/if}

					<!-- Toggle role -->
					{#if u.id !== currentUserId}
						<button
							class="action-btn"
							title={u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
							onclick={() => toggleRole(u.id, u.role)}
						>
							{u.role === 'admin' ? 'Demote' : 'Promote'}
						</button>
					{/if}

					<!-- Rename -->
					{#if renameUserId === u.id}
						<div class="inline-form">
							<input
								type="text"
								placeholder="New username"
								bind:value={renameUsername}
								minlength="3"
								maxlength="30"
							/>
							<button class="action-btn" onclick={renameUser}>Set</button>
							<button
								class="action-btn"
								onclick={() => {
									renameUserId = null;
									renameError = '';
								}}
							>
								Cancel
							</button>
							{#if renameError}
								<span class="error-inline">{renameError}</span>
							{/if}
						</div>
					{:else}
						<button
							class="action-btn"
							onclick={() => {
								renameUserId = u.id;
								renameUsername = u.username;
								renameError = '';
							}}
						>
							Rename
						</button>
					{/if}

					<!-- Reset password -->
					{#if resetUserId === u.id}
						<div class="inline-form">
							<input
								type="password"
								placeholder="New password"
								bind:value={resetPassword}
								minlength="12"
							/>
							<button class="action-btn" onclick={resetUserPassword}>Set</button>
							<button
								class="action-btn"
								onclick={() => {
									resetUserId = null;
									resetError = '';
								}}
							>
								Cancel
							</button>
							{#if resetError}
								<span class="error-inline">{resetError}</span>
							{/if}
						</div>
					{:else}
						<button
							class="action-btn"
							onclick={() => {
								resetUserId = u.id;
								resetPassword = '';
								resetError = '';
							}}
						>
							Reset PW
						</button>
					{/if}

					<!-- Delete -->
					{#if u.id !== currentUserId}
						{#if confirmDeleteId === u.id}
							<span class="confirm-delete">
								Delete all data?
								<button class="action-btn action-danger" onclick={() => deleteUser(u.id)}
									>Yes</button
								>
								<button class="action-btn" onclick={() => (confirmDeleteId = null)}>No</button>
							</span>
						{:else}
							<button class="action-btn action-danger" onclick={() => (confirmDeleteId = u.id)}>
								Delete
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/each}

		{#if users.length === 0}
			<p class="empty-msg">
				{searchQuery ? 'No users match your search.' : 'No users found.'}
			</p>
		{/if}
	</div>

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="pagination">
			<button class="action-btn" disabled={page <= 1} onclick={() => goToPage(page - 1)}>
				Previous
			</button>
			<span class="page-info">Page {page} of {totalPages}</span>
			<button class="action-btn" disabled={page >= totalPages} onclick={() => goToPage(page + 1)}>
				Next
			</button>
		</div>
	{/if}
</div>

<style>
	/* Layout-neutral wrapper that scopes the shared button and inline-form styles
	   below, which also apply to the buttons inside GiftActions. */
	.users-panel {
		display: contents;
	}

	/* ── Search Bar ──────────────────────────────────────────────── */

	.search-bar {
		position: relative;
		margin-bottom: var(--space-4);
		max-width: 400px;
	}

	.search-bar input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		padding-right: var(--space-8);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		box-sizing: border-box;
	}

	.search-bar input::placeholder {
		color: var(--color-text-muted);
	}

	.search-bar input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.search-clear {
		position: absolute;
		right: var(--space-2);
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 18px;
		cursor: pointer;
		padding: var(--space-1) var(--space-2);
		line-height: 1;
	}

	.search-clear:hover {
		color: var(--color-text-primary);
	}

	.search-status {
		font-size: 12px;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-3);
	}

	/* ── User List ────────────────────────────────────────────────── */

	.user-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.user-card {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.user-card:hover {
		border-color: var(--color-accent-dim);
	}

	.user-card.disabled {
		opacity: 0.6;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.user-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.user-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.role-badge {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.role-badge.role-admin {
		background: var(--color-accent-glow);
		color: var(--color-accent);
		border-color: var(--color-accent-dim);
	}

	.status-badge {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.disabled-badge {
		background: rgba(248, 113, 113, 0.1);
		color: var(--color-danger);
		border: 1px solid rgba(248, 113, 113, 0.3);
	}

	.unverified-badge {
		background: rgba(251, 191, 36, 0.1);
		color: rgb(251, 191, 36);
		border: 1px solid rgba(251, 191, 36, 0.3);
	}

	/* ── User Meta (email, dates) ────────────────────────────────── */

	.user-meta {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-wrap: wrap;
	}

	.user-email {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.user-date {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	.meta-sep {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	.empty-msg {
		font-size: 13px;
		color: var(--color-text-muted);
		text-align: center;
		padding: var(--space-6) 0;
	}

	/* ── User Actions ─────────────────────────────────────────────── */

	.user-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		flex-shrink: 0;
	}

	.users-panel :global(.action-btn) {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 11px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.users-panel :global(.action-btn:hover:not(:disabled)) {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
	}

	.users-panel :global(.action-btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.users-panel :global(.action-btn.action-danger) {
		color: var(--color-danger);
		border-color: rgba(248, 113, 113, 0.3);
	}

	.users-panel :global(.action-btn.action-danger:hover:not(:disabled)) {
		background: rgba(248, 113, 113, 0.1);
		border-color: var(--color-danger);
	}

	.users-panel :global(.action-btn.action-grant) {
		color: var(--color-success);
		border-color: rgba(74, 222, 128, 0.3);
	}

	.users-panel :global(.action-btn.action-grant:hover:not(:disabled)) {
		background: rgba(74, 222, 128, 0.1);
		border-color: var(--color-success);
	}

	.confirm-delete {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 12px;
		color: var(--color-danger);
	}

	.users-panel :global(.inline-form) {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.users-panel :global(.inline-form input) {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 12px;
		width: 150px;
	}

	.users-panel :global(.inline-form input:focus) {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.error-inline {
		font-size: 11px;
		color: var(--color-danger);
	}

	/* ── Pagination ───────────────────────────────────────────────── */

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}

	.page-info {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	/* ── Responsive ───────────────────────────────────────────────── */

	@media (max-width: 767px) {
		.user-card {
			flex-direction: column;
		}

		.user-actions {
			width: 100%;
		}

		.search-bar {
			max-width: none;
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.user-card {
			padding: var(--space-3);
		}

		.users-panel :global(.action-btn) {
			min-height: 44px;
			padding: var(--space-2) var(--space-3);
		}

		.users-panel :global(.inline-form input) {
			width: 100%;
			font-size: 16px; /* prevents iOS auto-zoom */
		}

		.users-panel :global(.inline-form) {
			flex-direction: column;
		}
	}
</style>
