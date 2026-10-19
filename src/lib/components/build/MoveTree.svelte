<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { tick } from 'svelte';
	import MoveTreeLine from './MoveTreeLine.svelte';
	import type { RepertoireMove } from './buildState.svelte';
	import { buildMoveTree, buildNodeIndex, fenKey } from './moveTreeBuilder';
	import { scrollBehavior } from '$lib/motion';

	interface Props {
		moves: RepertoireMove[];
		currentFen: string;
		startFen: string | null;
		onNavigateToLine: (sans: string[]) => void;
	}

	let { moves, currentFen, startFen, onNavigateToLine }: Props = $props();

	let sectionOpen = $state(false);
	let expanded = new SvelteSet<string>();
	let treeContainer: HTMLDivElement | undefined = $state();

	// Build the tree reactively
	const treeRoots = $derived(buildMoveTree(moves, startFen));

	// Build a lookup from fenKey -> TreeNode for finding current position in tree
	const nodeByFenKey = $derived(buildNodeIndex(treeRoots));

	const currentFenKey = $derived(fenKey(currentFen));

	// Auto-expand branches to make the current position visible
	$effect(() => {
		const targetNode = nodeByFenKey.get(currentFenKey);
		if (!targetNode) return;
		expandAncestors(targetNode.pathSans);
	});

	function expandAncestors(pathSans: string[]) {
		// Walk the tree following pathSans to find branch points that need expanding
		let nodes = treeRoots;
		for (let i = 0; i < pathSans.length; i++) {
			const san = pathSans[i];
			if (nodes.length === 0) break;

			const idx = nodes.findIndex((n) => n.san === san);
			if (idx < 0) break;

			const node = nodes[idx];

			// If this isn't the mainline (first child), it's a branch — expand it
			if (idx > 0) {
				// Branch key format matches MoveTreeLine: parentToFenKey|branchSan
				// The parent's toFen is this node's fromFen
				const bk = `${fenKey(node.fromFen)}|${san}`;
				expanded.add(bk);
			}

			nodes = node.children;
		}
	}

	// Auto-scroll to current position
	$effect(() => {
		// Read currentFenKey to establish dependency
		void currentFenKey;
		tick().then(() => {
			if (!treeContainer) return;
			const current = treeContainer.querySelector('.is-current');
			if (current) {
				current.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
			}
		});
	});

	function toggleBranch(key: string) {
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
	}
</script>

<div class="section">
	<button class="section-label tree-toggle" onclick={() => (sectionOpen = !sectionOpen)}>
		{sectionOpen ? '▾' : '▸'} REPERTOIRE TREE
	</button>
	{#if sectionOpen}
		{#if treeRoots.length === 0}
			<div class="tree-empty">No moves yet. Play a move on the board to start building.</div>
		{:else}
			<div class="tree-container" bind:this={treeContainer}>
				{#each treeRoots as rootNode, i (rootNode.toFenKey)}
					{#if i > 0}
						{@const bk = `${fenKey(rootNode.fromFen)}|${rootNode.san}`}
						<button
							class="branch-toggle"
							aria-label="Toggle branch"
							onclick={() => toggleBranch(bk)}>{expanded.has(bk) ? '▾' : '▸'}</button
						>
						{#if expanded.has(bk)}
							<div class="branch-indent">
								<MoveTreeLine
									node={rootNode}
									{currentFenKey}
									{expanded}
									onToggle={toggleBranch}
									{onNavigateToLine}
									isFirstInBranch={true}
								/>
							</div>
						{/if}
					{:else}
						<MoveTreeLine
							node={rootNode}
							{currentFenKey}
							{expanded}
							onToggle={toggleBranch}
							{onNavigateToLine}
						/>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.tree-toggle {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		text-align: left;
		user-select: none;
		font-family: var(--font-body);
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.tree-toggle:hover {
		color: var(--color-accent);
	}

	.tree-container {
		max-height: 300px;
		overflow-y: auto;
		font-size: 12px;
		line-height: 1.7;
		padding: var(--space-1) 0;
	}

	.tree-empty {
		color: var(--color-text-muted);
		font-size: 12px;
		font-style: italic;
	}

	.branch-toggle {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 10px;
		cursor: pointer;
		padding: 0 2px;
		font-family: var(--font-body);
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.branch-toggle:hover {
		color: var(--color-accent);
	}

	.branch-indent {
		display: block;
		margin-left: var(--space-4);
		padding-left: var(--space-3);
		border-left: 1px solid var(--color-border);
	}
</style>
