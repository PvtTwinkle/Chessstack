<!--
	Settings → Refer a Friend (cloud only): the user's referral code, how many
	friends have verified their email with it, and the referral discount status.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import SettingsSection from './SettingsSection.svelte';

	let {
		referralCode,
		referralCount,
		referralDiscountActive,
		referralDiscountUsed
	}: {
		referralCode: string;
		referralCount: number;
		referralDiscountActive: boolean;
		referralDiscountUsed: boolean;
	} = $props();

	let copyLabel = $state('Copy');
	let resetTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(resetTimer));

	function showCopyResult(label: string) {
		copyLabel = label;
		clearTimeout(resetTimer);
		resetTimer = setTimeout(() => (copyLabel = 'Copy'), 2000);
	}

	async function copyReferralCode() {
		try {
			await navigator.clipboard.writeText(referralCode);
			showCopyResult('Copied!');
		} catch {
			showCopyResult('Error');
		}
	}
</script>

<SettingsSection title="Refer a Friend">
	<div class="setting-row">
		<span class="setting-label">Your referral code</span>
		<div class="username-input-row">
			<input class="username-input referral-code" type="text" readonly value={referralCode} />
			<button class="btn-save" onclick={copyReferralCode}>{copyLabel}</button>
		</div>
		<p class="setting-hint">
			Share this with a friend. When they create a free account and verify their email, you both get
			50% off the annual plan for your first year.
		</p>
	</div>

	<div class="setting-row">
		<span class="setting-label">Friends invited</span>
		<span>{referralCount} {referralCount === 1 ? 'person' : 'people'}</span>
	</div>

	<div class="setting-row">
		<span class="setting-label">Referral discount</span>
		{#if referralDiscountActive && referralDiscountUsed}
			<span class="status-badge">Used</span>
			<p class="setting-hint">Your 50% referral discount has already been applied.</p>
		{:else if referralDiscountActive}
			<span class="status-badge status-active">Active</span>
			<p class="setting-hint">
				50% off will be applied the next time you subscribe to the annual plan.
			</p>
		{:else}
			<span class="status-badge">Not active</span>
		{/if}
	</div>
</SettingsSection>

<style>
	/* Scoped under the row so it outranks the generic .username-input rule from SettingsSection. */
	.username-input-row .referral-code {
		font-family: monospace;
		letter-spacing: 0.12em;
	}

	/* Same pill style as the plan badge in the Subscription section. */
	.status-badge {
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

	.status-active {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border-color: rgba(74, 222, 128, 0.3);
	}
</style>
