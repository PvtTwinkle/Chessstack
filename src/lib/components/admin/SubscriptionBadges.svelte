<!--
	Admin user card → plan, gift and Stripe subscription status badges (cloud only).
	Rendered inside the card header's badge row.
-->
<script lang="ts">
	import { formatDate, isLifetimeGift, type AdminUser } from './admin-user';

	let { user }: { user: AdminUser } = $props();
</script>

<!-- Tier badge -->
<span class="tier-badge" class:tier-paid={user.tier === 'paid'}>
	{user.tier === 'paid' ? 'Paid' : 'Free'}
</span>
{#if user.isGifted}
	<span class="gift-badge">
		{isLifetimeGift(user.giftExpiry)
			? 'Gifted · Lifetime'
			: `Gifted · Expires ${formatDate(user.giftExpiry)}`}
	</span>
{/if}
<!-- Subscription status -->
{#if user.subscriptionStatus === 'past_due'}
	<span class="sub-status sub-past-due">Past Due</span>
{:else if user.subscriptionStatus === 'canceled'}
	<span class="sub-status sub-canceled">Canceled</span>
{/if}

<style>
	/* ── Tier & Subscription Badges ──────────────────────────────── */

	.tier-badge {
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

	.tier-badge.tier-paid {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border-color: rgba(74, 222, 128, 0.3);
	}

	.gift-badge {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: rgba(251, 191, 36, 0.1);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
	}

	.sub-status {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.sub-past-due {
		background: rgba(251, 191, 36, 0.1);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
	}

	.sub-canceled {
		background: rgba(248, 113, 113, 0.1);
		color: var(--color-danger);
		border: 1px solid rgba(248, 113, 113, 0.3);
	}
</style>
