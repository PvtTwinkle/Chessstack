<script lang="ts">
	import type { PageData } from './$types';
	import OnboardingWelcome from '$lib/components/OnboardingWelcome.svelte';
	import Dashboard from '$lib/components/Dashboard.svelte';
	import Landing from '$lib/components/landing/Landing.svelte';
	import type { LandingData } from '$lib/landing/landing.server';

	let { data }: { data: PageData } = $props();
	// Only the logged-out branch of the load returns the landing data.
	let landing = $derived(data as PageData & Partial<LandingData>);
</script>

<svelte:head>
	{#if data.user}
		<title>Dashboard | Chessstack</title>
	{/if}
</svelte:head>

{#if !data.user}
	<!-- ── Landing page (unauthenticated, cloud edition only) ─────────── -->
	<Landing
		guides={landing.guides ?? []}
		openings={landing.openings ?? []}
		registrationMode={data.registrationMode}
	/>
{:else if data.repertoires.length === 0}
	<!-- ── Onboarding (authenticated, no repertoires yet) ──────────────── -->
	<OnboardingWelcome />
{:else}
	<!-- ── Dashboard (authenticated) ──────────────────────────────────── -->
	<Dashboard {data} />
{/if}
