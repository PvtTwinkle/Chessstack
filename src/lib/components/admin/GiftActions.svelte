<!--
	Admin user card → grant or revoke a gifted paid subscription (cloud only).
	Only one gift picker is open at a time across the list: `openPickerFor` is the
	id of the user whose picker is open, shared by all cards. Button styles come
	from UserList.
-->
<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { AdminUser } from './admin-user';

	let {
		user,
		openPickerFor = $bindable()
	}: {
		user: AdminUser;
		openPickerFor: number | null;
	} = $props();

	let loading = $state(false);

	async function giftSubscription(duration: '1_month' | '1_year' | 'lifetime') {
		loading = true;
		openPickerFor = null;
		try {
			const res = await fetch(`/api/admin/users/${user.id}/subscription`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'grant', duration })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed' }));
				alert(err.message ?? 'Failed to gift subscription');
				return;
			}
			await invalidateAll();
		} finally {
			loading = false;
		}
	}

	async function revokeGift() {
		loading = true;
		try {
			const res = await fetch(`/api/admin/users/${user.id}/subscription`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'revoke' })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed' }));
				alert(err.message ?? 'Failed to revoke gift');
				return;
			}
			await invalidateAll();
		} finally {
			loading = false;
		}
	}
</script>

<!-- Gift subscription -->
{#if user.isGifted}
	<button
		class="action-btn action-danger"
		title="Revoke gifted subscription"
		disabled={loading}
		onclick={() => revokeGift()}
	>
		{loading ? '...' : 'Revoke Gift'}
	</button>
{:else if user.tier === 'free'}
	{#if openPickerFor === user.id}
		<div class="inline-form">
			<button
				class="action-btn action-grant"
				disabled={loading}
				onclick={() => giftSubscription('1_month')}
			>
				1 Month
			</button>
			<button
				class="action-btn action-grant"
				disabled={loading}
				onclick={() => giftSubscription('1_year')}
			>
				1 Year
			</button>
			<button
				class="action-btn action-grant"
				disabled={loading}
				onclick={() => giftSubscription('lifetime')}
			>
				Lifetime
			</button>
			<button class="action-btn" onclick={() => (openPickerFor = null)}> Cancel </button>
		</div>
	{:else}
		<button
			class="action-btn action-grant"
			title="Gift a paid subscription"
			disabled={loading}
			onclick={() => (openPickerFor = user.id)}
		>
			{loading ? '...' : 'Gift Sub'}
		</button>
	{/if}
{/if}
