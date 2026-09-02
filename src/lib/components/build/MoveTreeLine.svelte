<script module lang="ts">
	export interface TreeNode {
		san: string;
		fromFen: string;
		toFen: string;
		toFenKey: string; // pre-computed fenKey(toFen)
		ply: number;
		children: TreeNode[];
		pathSans: string[]; // full path from STARTING_FEN for navigation
		isTransposition?: boolean; // true when toFen was already reached via a different path
		transposesToFenKey?: string; // the fenKey this move converges into, when isTransposition is true
	}
</script>

<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import MoveTreeLine from './MoveTreeLine.svelte';

	interface Props {
		node: TreeNode;
		currentFenKey: string;
		expanded: SvelteSet<string>;
		onToggle: (branchKey: string) => void;
		onNavigateToLine: (sans: string[]) => void;
		isFirstInBranch?: boolean;
	}

	let {
		node,
		currentFenKey,
		expanded,
		onToggle,
		onNavigateToLine,
		isFirstInBranch = false
	}: Props = $props();

	// Walk the mainline: follow first child at each level
	const mainline = $derived.by(() => {
		const nodes: TreeNode[] = [];
		let current: TreeNode | undefined = node;
		while (current) {
			nodes.push(current);
			current = current.children[0];
		}
		return nodes;
	});

	function needsMoveNumber(n: TreeNode, idx: number): boolean {
		// White always gets a number
		if (n.ply % 2 === 1) return true;
		// Black gets a number only at the start of a branch
		if (idx === 0 && isFirstInBranch) return true;
		return false;
	}

	function moveNumber(ply: number): string {
		const num = Math.ceil(ply / 2);
		if (ply % 2 === 1) return `${num}.`;
		return `${num}...`;
	}

	function branchKey(parentToFenKey: string, branchSan: string): string {
		return `${parentToFenKey}|${branchSan}`;
	}
</script>

<span class="tree-line">
	{#each mainline as n, idx (n.toFenKey)}
		{#if needsMoveNumber(n, idx)}
			<span class="tree-num">{moveNumber(n.ply)}</span>
		{/if}
		<button
			class="tree-san"
			class:is-current={n.toFenKey === currentFenKey}
			onclick={() => onNavigateToLine(n.pathSans)}>{n.san}</button
		>
		{#if n.isTransposition}
			<span class="tree-transposition" title="Transpose vers une ligne déjà affichée">⇥</span>
		{/if}
		{#if n.children.length > 1}
			{#each n.children.slice(1) as branch (branch.toFenKey)}
				{@const bk = branchKey(n.toFenKey, branch.san)}
				<button class="branch-toggle" aria-label="Toggle branch" onclick={() => onToggle(bk)}
					>{expanded.has(bk) ? '▾' : '▸'}</button
				>
				{#if expanded.has(bk)}
					<div class="branch-indent">
						<MoveTreeLine
							node={branch}
							{currentFenKey}
							{expanded}
							{onToggle}
							{onNavigateToLine}
							isFirstInBranch={true}
						/>
					</div>
				{/if}
			{/each}
		{/if}
	{/each}
</span>

<style>
	.tree-line {
		display: inline;
	}

	.tree-num {
		color: var(--color-text-muted);
		font-size: 11px;
		user-select: none;
		margin-right: 1px;
	}

	.tree-san {
		background: none;
		border: none;
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		padding: 1px var(--space-1);
		border-radius: 2px;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.tree-san:hover {
		background: var(--color-surface-alt);
		color: var(--color-accent);
	}

	.tree-san.is-current {
		background: var(--color-surface-alt);
		color: var(--color-accent);
		font-weight: 600;
	}

	.tree-transposition {
		color: var(--color-text-muted);
		font-size: 11px;
		margin: 0 2px;
		user-select: none;
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
