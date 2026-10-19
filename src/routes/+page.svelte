<script lang="ts">
	import type { PageData } from './$types';
	import type { LandingData } from '$lib/landing/landing.server';

	let { data }: { data: PageData } = $props();
	// Only the logged-out branch of the load returns the landing data.
	let landing = $derived(data as PageData & Partial<LandingData>);
	// +page.ts loads only the component this visit needs.
	let view = $derived(data.view);
</script>

<svelte:head>
	{#if data.user}
		<title>Dashboard | Chessstack</title>
	{/if}
</svelte:head>

{#if view.kind === 'landing'}
	<!-- ── Landing page (unauthenticated, cloud edition only) ─────────── -->
	<view.component
		posts={landing.posts ?? []}
		openings={landing.openings ?? []}
		registrationMode={data.registrationMode}
	/>
{:else if view.kind === 'onboarding'}
	<!-- ── Onboarding (authenticated, no repertoires yet) ──────────────── -->
	<view.component />
{:else}
	<!-- ── Dashboard (authenticated) ──────────────────────────────────── -->
	<view.component {data} />
{/if}
