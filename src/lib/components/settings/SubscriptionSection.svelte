<!--
	Settings → Subscription (cloud only): current plan, upgrade via Stripe
	Checkout, billing portal, and admin-granted gifts. Hidden when billing is
	not configured and the user has no gift.
-->
<script lang="ts">
	import { page } from '$app/state';
	import SettingsSection from './SettingsSection.svelte';

	interface SubscriptionInfo {
		status: string;
		stripePriceId: string | null;
		currentPeriodEnd: Date | string | null;
		cancelAtPeriodEnd: boolean;
		giftExpiry: Date | string | null;
	}

	let {
		tier,
		billingEnabled,
		subscription,
		stripePriceIdAnnual
	}: {
		tier: 'free' | 'paid';
		billingEnabled: boolean;
		subscription: SubscriptionInfo | null;
		stripePriceIdAnnual: string;
	} = $props();

	// Gift subscription detection — derived so it updates when data changes.
	const isGifted = $derived(
		subscription?.giftExpiry != null && new Date(subscription.giftExpiry) > new Date()
	);
	const isLifetimeGift = $derived(
		isGifted && new Date(subscription!.giftExpiry!).getFullYear() >= 9999
	);

	let upgrading = $state(false);
	let managingBilling = $state(false);
	let billingError = $state('');

	// Post-checkout feedback from the ?checkout= query parameter.
	const checkoutResult = $derived(page.url.searchParams.get('checkout'));

	// Format a date for display, e.g. "Mar 16, 2026".
	function formatDate(d: Date | string | null): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	async function handleUpgrade(plan: 'monthly' | 'annual') {
		upgrading = true;
		billingError = '';
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plan })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				billingError = body?.message ?? 'Failed to start checkout';
				return;
			}
			const { url } = await res.json();
			window.location.href = url;
		} catch {
			billingError = 'Network error — please try again';
		} finally {
			upgrading = false;
		}
	}

	async function handleManageBilling() {
		managingBilling = true;
		billingError = '';
		try {
			const res = await fetch('/api/billing/portal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				billingError = body?.message ?? 'Failed to open billing portal';
				return;
			}
			const { url } = await res.json();
			window.location.href = url;
		} catch {
			billingError = 'Network error — please try again';
		} finally {
			managingBilling = false;
		}
	}
</script>

{#if billingEnabled || isGifted}
	<SettingsSection title="Subscription" id="subscription">
		{#if checkoutResult === 'success' && tier === 'free'}
			<div class="billing-banner billing-info">
				Your upgrade is being processed. This page will update shortly.
			</div>
		{:else if checkoutResult === 'success'}
			<div class="billing-banner billing-success">
				Upgrade successful! Your account has been upgraded.
			</div>
		{/if}

		<div class="setting-row">
			<span class="setting-label">Current Plan</span>
			<span class="plan-badge" class:plan-paid={tier === 'paid'}>
				{#if isGifted}
					Gift
				{:else if tier === 'paid'}
					{subscription?.stripePriceId === stripePriceIdAnnual ? 'Annual' : 'Monthly'}
				{:else}
					Free
				{/if}
			</span>
		</div>

		{#if isGifted}
			<p class="setting-hint">
				Your paid access was gifted by an administrator.
				{#if isLifetimeGift}
					Your gift has no expiration date.
				{:else}
					Your gift expires on {formatDate(subscription?.giftExpiry ?? null)}.
				{/if}
			</p>
		{:else if tier === 'paid' && subscription}
			{#if subscription.status === 'past_due'}
				<div class="billing-banner billing-warning">
					Your last payment failed. Please update your payment method.
				</div>
			{/if}

			{#if subscription.cancelAtPeriodEnd}
				<div class="billing-banner billing-warning">
					Your plan will cancel on {formatDate(subscription.currentPeriodEnd)}.
				</div>
			{:else if subscription.currentPeriodEnd}
				<div class="setting-row">
					<span class="setting-label">Next billing date</span>
					<span class="billing-date">{formatDate(subscription.currentPeriodEnd)}</span>
				</div>
			{/if}

			<div class="setting-row">
				<button class="btn-primary" onclick={handleManageBilling} disabled={managingBilling}>
					{managingBilling ? 'Opening...' : 'Manage Billing'}
				</button>
				<p class="setting-hint">Update payment method, view invoices, or cancel.</p>
			</div>
		{:else if billingEnabled}
			<p class="setting-hint">Unlock unlimited repertoires.</p>
			<div class="plan-cards">
				<div class="plan-card">
					<div class="plan-card-name">Monthly</div>
					<div class="plan-card-price">$1<span class="plan-card-period">/month</span></div>
					<button class="btn-primary" onclick={() => handleUpgrade('monthly')} disabled={upgrading}>
						{upgrading ? 'Redirecting...' : 'Choose Monthly'}
					</button>
				</div>
				<div class="plan-card plan-card-highlight">
					<div class="plan-card-badge">Save 17%</div>
					<div class="plan-card-name">Annual</div>
					<div class="plan-card-price">$10<span class="plan-card-period">/year</span></div>
					<div class="plan-card-detail">$0.83/month</div>
					<button class="btn-primary" onclick={() => handleUpgrade('annual')} disabled={upgrading}>
						{upgrading ? 'Redirecting...' : 'Choose Annual'}
					</button>
				</div>
			</div>
		{/if}

		{#if tier === 'free' && !isGifted}
			<div class="self-host-callout">
				<p class="self-host-heading">Prefer to own your data?</p>
				<p class="self-host-description">
					Chessstack is open-source. Self-host for free with Docker — no subscription, no limits, no
					data leaving your network.
				</p>
				<a
					href="https://github.com/PvtTwinkle/Chessstack"
					target="_blank"
					rel="noopener noreferrer"
					class="btn-primary self-host-link"
				>
					Self-Hosting Guide
				</a>
			</div>
		{/if}

		{#if billingError}
			<p class="error-msg">{billingError}</p>
		{/if}
	</SettingsSection>
{/if}

<style>
	/* ── Billing ───────────────────────────────────────────────────── */

	.plan-badge {
		display: inline-block;
		padding: var(--space-1) var(--space-3);
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.plan-badge.plan-paid {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border-color: rgba(74, 222, 128, 0.3);
	}

	.billing-date {
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.billing-banner {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-sm);
		font-size: 13px;
		margin-bottom: var(--space-4);
	}

	.billing-success {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border: 1px solid rgba(74, 222, 128, 0.3);
	}

	.billing-warning {
		background: rgba(251, 191, 36, 0.1);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
	}

	.billing-info {
		background: rgba(96, 165, 250, 0.1);
		color: #60a5fa;
		border: 1px solid rgba(96, 165, 250, 0.3);
	}

	.plan-cards {
		display: flex;
		gap: var(--space-4);
		margin-top: var(--space-3);
	}

	.plan-card {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface-alt);
		position: relative;
	}

	.plan-card-highlight {
		border-color: var(--color-accent);
	}

	.plan-card-badge {
		position: absolute;
		top: calc(-1 * var(--space-2));
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-1) var(--space-2);
		border-radius: 999px;
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.plan-card-name {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.plan-card-price {
		font-size: 28px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.plan-card-period {
		font-size: 14px;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.plan-card-detail {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	/* ── Self-host callout ───────────────────────────────────────── */

	.self-host-callout {
		margin-top: var(--space-8);
		padding: var(--space-6);
		text-align: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
	}

	.self-host-heading {
		font-size: 15px;
		font-weight: 600;
		margin: 0 0 var(--space-2) 0;
		color: var(--color-text-primary);
	}

	.self-host-description {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-4) 0;
		line-height: 1.6;
	}

	/* Scoped under the callout so it outranks the generic .btn-primary rule from SettingsSection. */
	.self-host-callout .self-host-link {
		display: inline-block;
		font-size: 0.875rem;
	}
</style>
