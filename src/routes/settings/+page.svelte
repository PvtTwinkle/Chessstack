<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll, goto } from '$app/navigation';
	import { resolveRoute } from '$app/paths';
	import { onDestroy } from 'svelte';
	import { tutorialStep } from '$lib/stores/tutorial';
	import { createSettingsState } from '$lib/components/settings/settingsState.svelte';
	import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
	import AppearanceSection from '$lib/components/settings/AppearanceSection.svelte';
	import AnalysisSection from '$lib/components/settings/AnalysisSection.svelte';
	import DrillSection from '$lib/components/settings/DrillSection.svelte';
	import TrainerSection from '$lib/components/settings/TrainerSection.svelte';
	import GameImportSection from '$lib/components/settings/GameImportSection.svelte';
	import TutorialSection from '$lib/components/settings/TutorialSection.svelte';
	import AccountSection from '$lib/components/settings/AccountSection.svelte';
	import SubscriptionSection from '$lib/components/settings/SubscriptionSection.svelte';
	import ReferralSection from '$lib/components/settings/ReferralSection.svelte';
	import DangerZoneSection from '$lib/components/settings/DangerZoneSection.svelte';

	let { data }: { data: PageData } = $props();

	// All settings state and save actions live in settingsState.svelte.ts.
	const settings = createSettingsState({
		invalidateAll,
		goToBuild: () => goto(resolveRoute('/build'))
	});

	// The controls save optimistically but follow the server: re-sync them
	// whenever the page data changes (including after each invalidateAll()).
	$effect(() => {
		settings.sync(data.settings, data.user?.email);
	});

	onDestroy(() => settings.destroy());
</script>

<div class="settings-page">
	<h1>Settings</h1>

	<div class="settings-content">
		<AppearanceSection {settings} />

		<AnalysisSection {settings} />

		<DrillSection {settings} />

		<TrainerSection {settings} />

		<GameImportSection {settings} />

		<!-- Self-hosted instances have no plans or referrals. -->
		{#if data.edition === 'cloud'}
			<SubscriptionSection
				tier={data.tier ?? 'free'}
				billingEnabled={data.billingEnabled}
				subscription={data.subscription}
				stripePriceIdAnnual={data.stripePriceIdAnnual ?? ''}
			/>
		{/if}

		{#if data.referralCode}
			<ReferralSection
				referralCode={data.referralCode}
				referralCount={data.referralCount}
				referralDiscountActive={data.referralDiscountActive}
				referralDiscountUsed={data.referralDiscountUsed}
			/>
		{/if}

		{#if $tutorialStep === null}
			<TutorialSection {settings} />
		{/if}

		<AccountSection {settings} />

		<SettingsSection title="Support">
			<div class="setting-row">
				<p class="setting-hint">
					Need help or have a question? Contact us at
					<a href="mailto:support@chessstack.app">support@chessstack.app</a>
				</p>
			</div>
		</SettingsSection>

		<DangerZoneSection />
	</div>
</div>

<style>
	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-body);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	.settings-page {
		max-width: 700px;
		margin: 0 auto;
	}

	.settings-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.settings-page {
			padding: 0;
		}

		.settings-content {
			gap: var(--space-3);
		}
	}
</style>
