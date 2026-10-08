<!--
	Drill → the moves played so far in the current line ("1. e4 e5 2. Nf3 …").
-->
<script lang="ts">
	import type { NavEntry } from '$lib/drill/types';

	let { navHistory }: { navHistory: NavEntry[] } = $props();
</script>

{#if navHistory.length > 0}
	<div class="section">
		<div class="section-label">CURRENT LINE</div>
		<div class="move-list">
			{#each navHistory as entry, i (i)}
				{#if i % 2 === 0}
					<span class="move-num">{Math.floor(i / 2) + 1}.</span>
				{/if}
				<span class="move-san move-san--auto">{entry.san}</span>
			{/each}
		</div>
	</div>
{/if}

<style>
	.move-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: 0.85rem;
	}

	.move-num {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.move-san--auto {
		color: var(--color-text-secondary);
	}
</style>
