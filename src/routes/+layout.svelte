<script lang="ts">
	import '$lib/styles/fonts.css';
	import manropeLatin from '$lib/assets/fonts/manrope/manrope-latin-wght-normal.woff2';
	import logoIcon from '$lib/assets/logo-icon.svg';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { onMount, type Snippet } from 'svelte';
	import { timeZoneCookieUpdate } from '$lib/dashboard/stats';
	import type { LayoutData } from './$types';
	import RepertoireSelector from '$lib/components/RepertoireSelector.svelte';
	import ManageRepertoireModal from '$lib/components/ManageRepertoireModal.svelte';
	import TutorialOverlay from '$lib/components/tutorial/TutorialOverlay.svelte';
	import { manageRepertoires } from '$lib/stores/manageRepertoires.svelte';
	import { tutorial } from '$lib/stores/tutorial.svelte';
	import { pageOwnsLandmarks } from '$lib/public-pages';

	// `data` comes from +layout.server.ts and includes `user`, `repertoires`,
	// and `activeRepertoireId`.
	// `children` is the content of the current page — rendered with {@render children()}.
	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// Seed the shared tutorial step from the server data. A pre-effect, so the
	// page renders with the step from the data it was loaded with.
	$effect.pre(() => {
		tutorial.sync(data.settings?.tutorialStep);
	});

	// Public pages render their own <main> between the public header and footer.
	const ownsLandmarks = $derived(pageOwnsLandmarks(page.route.id, !!data.user));

	// Tell the server the browser's time zone, so the dashboard's streak and
	// daily puzzle goal follow the player's own days rather than UTC.
	onMount(() => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!zone) return;
		const update = timeZoneCookieUpdate(document.cookie, zone);
		if (!update) return;
		document.cookie = update;
		// The dashboard on screen was counted without the zone; count it again.
		if (data.user && page.route.id === '/') void invalidateAll();
	});

	// Mobile hamburger menu state
	let mobileMenuOpen = $state(false);
	let hamburgerButton = $state<HTMLButtonElement>();

	function closeMenuOnEscape(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !mobileMenuOpen) return;
		mobileMenuOpen = false;
		hamburgerButton?.focus();
	}

	// Navigation link definitions — Admin link only shown for admin users.
	const navLinks = $derived([
		{ href: `${base}/`, label: 'Dashboard' },
		{ href: `${base}/build`, label: 'Build' },
		{ href: `${base}/drill`, label: 'Drill' },
		{ href: `${base}/train`, label: 'Train' },
		{ href: `${base}/puzzles`, label: 'Puzzles' },
		{ href: `${base}/review`, label: 'Review' },
		{ href: `${base}/report`, label: 'Report' },
		{ href: `${base}/prep`, label: 'Prep' },
		{ href: `${base}/settings`, label: 'Settings' },
		...(data.user?.role === 'admin' ? [{ href: `${base}/admin`, label: 'Admin' }] : [])
	]);

	// Determine if a nav link is the active page.
	// Dashboard matches exact "/", others match by prefix.
	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === `${base}/`) return path === `${base}/` || path === base;
		return path.startsWith(href);
	}
</script>

<!-- Canonical URLs and other SEO tags come from <Seo> on each public page. -->
<svelte:head>
	<!-- Start the font download with the HTML instead of after the CSS is parsed. -->
	<link rel="preload" href={manropeLatin} as="font" type="font/woff2" crossorigin="anonymous" />
	<!-- The mobile browser bar follows the app theme (visitors get the dark one). -->
	<meta name="theme-color" content={data.settings?.appTheme === 'light' ? '#dfe3e9' : '#0a1a2e'} />
</svelte:head>

<svelte:window onkeydown={closeMenuOnEscape} />

<!--
	Only show the nav bar when the user is logged in.
	On the /login page, data.user is null so the nav is hidden.
-->
<a class="skip-link" href="#main">Skip to content</a>

{#if data.user}
	<header class="app-header">
		<a href="{base}/" class="brand">
			<img class="brand-icon" src={logoIcon} alt="Chessstack logo" />
			<span class="brand-text">Chessstack</span>
		</a>

		<!-- Desktop nav links -->
		<nav class="nav-links" aria-label="Main">
			{#each navLinks as link (link.href)}
				<a
					href={link.href}
					class="nav-link"
					class:active={isActive(link.href)}
					aria-current={isActive(link.href) ? 'page' : undefined}>{link.label}</a
				>
			{/each}
		</nav>

		<!-- Repertoire selector between nav and user area -->
		<RepertoireSelector
			repertoires={data.repertoires}
			activeRepertoireId={data.activeRepertoireId}
			lockedRepertoireIds={data.lockedRepertoireIds}
		/>

		<!-- Sign-out (POST form prevents CSRF via crafted URL) -->
		<form method="POST" action="/api/auth/logout" class="signout-form">
			<span class="username" title={data.user.username}>{data.user.username}</span>
			<button type="submit" class="signout-btn">Sign out</button>
		</form>

		<!-- Mobile hamburger toggle -->
		<button
			bind:this={hamburgerButton}
			class="hamburger"
			onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			aria-label="Toggle navigation menu"
			aria-expanded={mobileMenuOpen}
			aria-controls="mobile-drawer"
		>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
		</button>
	</header>

	<!-- Mobile slide-down drawer -->
	{#if mobileMenuOpen}
		<nav id="mobile-drawer" class="mobile-drawer" aria-label="Main menu">
			{#each navLinks as link (link.href)}
				<a
					href={link.href}
					class="mobile-link"
					class:active={isActive(link.href)}
					aria-current={isActive(link.href) ? 'page' : undefined}
					onclick={() => (mobileMenuOpen = false)}>{link.label}</a
				>
			{/each}
			<!-- The header's sign-out form is hidden whenever this drawer is in use. -->
			<form method="POST" action="/api/auth/logout" class="mobile-signout">
				<span class="mobile-username">{data.user.username}</span>
				<button type="submit" class="signout-btn">Sign out</button>
			</form>
		</nav>
	{/if}
{/if}

<svelte:element
	this={ownsLandmarks ? 'div' : 'main'}
	id={ownsLandmarks ? undefined : 'main'}
	tabindex={ownsLandmarks ? undefined : -1}
	class={data.user ? 'app-main' : ''}
>
	<!-- Only worth nagging about when the email could actually recover the account,
	     which needs password reset emails (Loops) to be set up. In the page flow
	     rather than fixed, so it never covers the top of the page. -->
	{#if data.user && !data.user.email && data.passwordResetEnabled}
		<div class="email-banner">
			<span>Please add an email address to your account for recovery purposes.</span>
			<a href="{base}/settings">Go to Settings</a>
		</div>
	{/if}

	{@render children()}
</svelte:element>

<!-- Rendered outside the header so it's not trapped in the header's stacking context (z-index: 900). -->
{#if data.user}
	<ManageRepertoireModal
		bind:open={manageRepertoires.open}
		repertoires={data.repertoires}
		tier={data.tier}
		lockedRepertoireIds={data.lockedRepertoireIds}
	/>
	<TutorialOverlay />
{/if}

<style>
	@import '$lib/styles/tokens.css';

	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		background: var(--color-base);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(::selection) {
		background: var(--color-accent);
		color: #fff;
	}

	:global(:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	/* Scrollbar styling for Webkit browsers */
	:global(::-webkit-scrollbar) {
		width: 6px;
		height: 6px;
	}

	:global(::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(::-webkit-scrollbar-thumb) {
		background: var(--color-border);
		border-radius: 3px;
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background: var(--color-text-muted);
	}

	/* Respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		:global(*) {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.01ms !important;
		}
	}

	/* Hidden until a keyboard user tabs to it. */
	.skip-link {
		position: fixed;
		top: var(--space-2);
		left: var(--space-2);
		z-index: 1000;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: 14px;
		text-decoration: none;
		transform: translateY(-200%);
	}

	.skip-link:focus {
		transform: none;
	}

	/* The skip link focuses <main>; it needs no ring of its own. */
	:global(main:focus) {
		outline: none;
	}

	/* Page entry animation */
	@keyframes -global-fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ── Fixed top bar ─────────────────────────────────────────────────── */

	.app-header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 900;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: 0 var(--space-6);
		height: 56px;
		background: var(--color-header-bg);
		border-bottom: 1px solid var(--color-border);
		box-shadow: 0 1px 8px rgba(0, 0, 0, 0.15);
	}

	:global([data-theme='light']) .app-header {
		box-shadow: none;
	}

	/* ── Brand ─────────────────────────────────────────────────────────── */

	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		text-decoration: none;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.brand-icon {
		width: 48px;
		height: 48px;
		border-radius: 8px;
		background: var(--color-logo-bg);
		padding: 2px;
	}

	.brand-text {
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--color-text-primary);
		letter-spacing: -0.01em;
	}

	/* ── Desktop nav links ─────────────────────────────────────────────── */

	.nav-links {
		display: flex;
		gap: var(--space-1);
		flex: 1;
	}

	.nav-link {
		position: relative;
		color: var(--color-text-secondary);
		text-decoration: none;
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.nav-link:hover {
		color: var(--color-text-primary);
	}

	/* Accent underline on active link */
	.nav-link.active {
		color: var(--color-accent);
	}

	.nav-link.active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: var(--space-3);
		right: var(--space-3);
		height: 2px;
		background: var(--color-accent);
		border-radius: 1px;
		animation: navUnderline var(--dur-base) var(--ease-snap);
	}

	@keyframes navUnderline {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}

	/* ── Right side: user area ────────────────────────────────────────── */

	.signout-form {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-shrink: 0;
	}

	.username {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.signout-btn {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.signout-btn:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text-primary);
	}

	/* ── Hamburger (mobile only) ──────────────────────────────────────── */

	.hamburger {
		display: none;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		width: 36px;
		height: 36px;
		padding: 8px;
		background: none;
		border: none;
		cursor: pointer;
		margin-left: auto;
	}

	.hamburger-line {
		display: block;
		width: 100%;
		height: 2px;
		background: var(--color-text-secondary);
		border-radius: 1px;
		transition:
			transform var(--dur-fast) var(--ease-snap),
			opacity var(--dur-fast) var(--ease-snap);
	}

	.hamburger-line.open:nth-child(1) {
		transform: rotate(45deg) translate(4px, 4px);
	}

	.hamburger-line.open:nth-child(2) {
		opacity: 0;
	}

	.hamburger-line.open:nth-child(3) {
		transform: rotate(-45deg) translate(4px, -4px);
	}

	/* ── Mobile drawer ────────────────────────────────────────────────── */

	.mobile-drawer {
		display: none;
		position: fixed;
		top: 56px;
		left: 0;
		right: 0;
		z-index: 899;
		flex-direction: column;
		background: var(--color-header-bg-solid);
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-2) 0;
		animation: drawerSlide var(--dur-base) var(--ease-snap);
	}

	@keyframes drawerSlide {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.mobile-link {
		display: block;
		padding: var(--space-3) var(--space-6);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 14px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		transition:
			color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.mobile-link:hover {
		color: var(--color-text-primary);
		background: var(--color-surface-alt);
	}

	.mobile-link.active {
		color: var(--color-accent);
		border-left: 2px solid var(--color-accent);
	}

	.mobile-signout {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-2);
		padding: var(--space-3) var(--space-6) var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.mobile-username {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* ── Email banner ────────────────────────────────────────────────── */

	.email-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-2) var(--space-4);
		margin-bottom: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-warning-bg, rgba(250, 204, 21, 0.12));
		border: 1px solid var(--color-warning-border, rgba(250, 204, 21, 0.3));
		border-radius: var(--radius-md);
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.email-banner a {
		color: var(--color-accent);
		text-decoration: none;
		font-weight: 600;
	}

	.email-banner a:hover {
		text-decoration: underline;
	}

	/* ── Main content area ────────────────────────────────────────────── */

	.app-main {
		max-width: 1400px;
		margin: 0 auto;
		padding: var(--space-6);
		padding-top: calc(56px + var(--space-6));
		animation: fadeSlideIn var(--dur-base) var(--ease-snap);
	}

	/* ── Responsive ───────────────────────────────────────────────────── */

	/* The full header (brand, nine or ten links, repertoire selector, username,
	   Sign out) is about 1,450px wide, and it is fixed, so anything past the
	   viewport edge is unreachable. Below that it sheds the username, then the
	   brand text and some link padding, then switches to the hamburger. */
	@media (max-width: 1499px) {
		.username {
			display: none;
		}
	}

	@media (max-width: 1399px) {
		.brand-text {
			display: none;
		}

		.nav-link {
			padding-left: var(--space-2);
			padding-right: var(--space-2);
		}

		.nav-link.active::after {
			left: var(--space-2);
			right: var(--space-2);
		}
	}

	@media (max-width: 1199px) {
		.brand-text {
			display: inline;
		}

		.nav-links {
			display: none;
		}

		.signout-form {
			display: none;
		}

		.hamburger {
			display: flex;
		}

		.mobile-drawer {
			display: flex;
		}
	}

	@media (max-width: 768px) {
		.app-main {
			padding: var(--space-4);
			padding-top: calc(56px + var(--space-4));
		}
	}

	/* ── Landscape phones — shorter header, hide brand text ── */
	@media (max-width: 767px) and (orientation: landscape) {
		.app-header {
			height: 48px;
		}

		.app-main {
			padding-top: calc(48px + var(--space-3));
		}

		.mobile-drawer {
			top: 48px;
		}

		.brand-text {
			display: none;
		}

		.brand-icon {
			width: 36px;
			height: 36px;
		}
	}
</style>
