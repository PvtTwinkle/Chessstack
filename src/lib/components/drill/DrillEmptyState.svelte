<!--
	Drill → "nothing to drill" message, with optional ✓ icon and action links.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		hint,
		icon = false,
		children
	}: { title: string; hint: string; icon?: boolean; children?: Snippet } = $props();
</script>

<div class="empty-state">
	{#if icon}
		<div class="empty-icon">✓</div>
	{/if}
	<p class="empty-title">{title}</p>
	<p class="empty-hint">{hint}</p>
	{@render children?.()}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) 0;
	}

	.empty-icon {
		font-size: 2rem;
		color: var(--color-success);
	}

	.empty-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.empty-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.5;
	}
</style>
