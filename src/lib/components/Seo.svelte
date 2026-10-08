<!--
	Head tags for a public page: title, meta description, canonical URL,
	Open Graph and X (Twitter) previews, and JSON-LD structured data.

	Every public page renders exactly one <Seo>. Pages that should stay out of
	search results (password reset, error pages…) pass `noindex`, which drops
	the canonical link and the social tags.

	Usage:
		<Seo
			title={pageTitle('How to Memorize Chess Openings')}
			description="…"
			type="article"
			jsonLd={[organizationSchema(), articleSchema('BlogPosting', {…})]}
		/>
-->
<script lang="ts">
	import { page } from '$app/state';
	import { DEFAULT_SOCIAL_IMAGE, SITE_NAME, absoluteUrl } from '$lib/seo/site';
	import type { SocialImage } from '$lib/seo/site';
	import { serializeJsonLd } from '$lib/seo/jsonld';
	import type { JsonLdNode } from '$lib/seo/jsonld';

	interface Props {
		/** The full <title>. Use pageTitle() from $lib/seo/site to add the site name. */
		title: string;
		/** Meta description, ideally 120-160 characters. */
		description: string;
		/** Canonical path. Defaults to the current path, which drops query strings like ?fbclid=. */
		path?: string;
		image?: SocialImage;
		type?: 'website' | 'article';
		/** Keep the page out of search results. */
		noindex?: boolean;
		/** ISO 8601 dates for article pages. */
		publishedTime?: string;
		modifiedTime?: string;
		jsonLd?: JsonLdNode[];
	}

	let {
		title,
		description,
		path,
		image = DEFAULT_SOCIAL_IMAGE,
		type = 'website',
		noindex = false,
		publishedTime,
		modifiedTime,
		jsonLd = []
	}: Props = $props();

	const url = $derived(absoluteUrl(path ?? page.url.pathname));
	const imageUrl = $derived(absoluteUrl(image.src));
	// The script tag is assembled here because Svelte would treat a literal
	// <script> in the markup as component code.
	const jsonLdScript = $derived(
		jsonLd.length > 0
			? `<script type="application/ld+json">${serializeJsonLd(jsonLd)}</` + 'script>'
			: ''
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />

	{#if noindex}
		<meta name="robots" content="noindex" />
	{:else}
		<link rel="canonical" href={url} />

		<meta property="og:site_name" content={SITE_NAME} />
		<meta property="og:locale" content="en_US" />
		<meta property="og:type" content={type} />
		<meta property="og:title" content={title} />
		<meta property="og:description" content={description} />
		<meta property="og:url" content={url} />
		<meta property="og:image" content={imageUrl} />
		<meta property="og:image:width" content={String(image.width)} />
		<meta property="og:image:height" content={String(image.height)} />
		<meta property="og:image:alt" content={image.alt} />
		{#if type === 'article' && publishedTime}
			<meta property="article:published_time" content={publishedTime} />
			<meta property="article:modified_time" content={modifiedTime ?? publishedTime} />
		{/if}

		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:title" content={title} />
		<meta name="twitter:description" content={description} />
		<meta name="twitter:image" content={imageUrl} />
		<meta name="twitter:image:alt" content={image.alt} />

		<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-LD built by $lib/seo/jsonld from our own content; serializeJsonLd escapes < > & -->
		{@html jsonLdScript}
	{/if}
</svelte:head>
