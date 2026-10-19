<!--
	PuzzleInfo — the current puzzle's id, rating, opening, themes and game link.
	The themes can be hidden so they don't give the answer away; that choice
	lasts for the session, so it is bound to the page rather than kept here.
-->

<script lang="ts">
	import type { Puzzle } from './puzzlesState.svelte';
	import { formatFamily, formatThemeLabel, splitThemes } from '$lib/puzzles/solution';

	interface Props {
		puzzle: Puzzle;
		hideThemes: boolean;
	}

	let { puzzle, hideThemes = $bindable() }: Props = $props();
</script>

<div class="puzzle-info">
	<div class="puzzle-header">
		<span class="puzzle-id">Puzzle #{puzzle.puzzleId}</span>
		<span class="puzzle-rating">Rating {puzzle.rating}</span>
	</div>
	<div class="puzzle-opening">{formatFamily(puzzle.openingFamily)}</div>
	{#if puzzle.themes}
		<div class="themes-row">
			<button
				class="hide-tags-btn"
				class:tags-hidden={hideThemes}
				onclick={() => (hideThemes = !hideThemes)}
				aria-pressed={hideThemes}
				title={hideThemes ? 'Show puzzle themes' : 'Hide puzzle themes'}
			>
				{hideThemes ? 'Show Tags' : 'Hide Tags'}
			</button>
			{#if !hideThemes}
				<div class="puzzle-themes">
					{#each splitThemes(puzzle.themes) as theme (theme)}
						<span class="theme-tag">{formatThemeLabel(theme)}</span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	{#if puzzle.gameUrl}
		<a href={puzzle.gameUrl} target="_blank" rel="noopener" class="game-link">
			View game on Lichess
		</a>
	{/if}
</div>

<style>
	/* ── Puzzle info ──────────────────────────────────────────────────────────── */

	.puzzle-info {
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		box-shadow: var(--shadow-surface);
	}

	.puzzle-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.puzzle-id {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.puzzle-rating {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-accent);
		background: var(--color-accent-glow);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
	}

	.puzzle-opening {
		font-size: 0.9rem;
		color: var(--color-text-primary);
		font-weight: 500;
	}

	.puzzle-themes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.theme-tag {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-alt);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
	}

	.themes-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.hide-tags-btn {
		align-self: flex-end;
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 0.7rem;
		cursor: pointer;
		padding: 0;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.hide-tags-btn:hover {
		color: var(--color-text-secondary);
	}

	.hide-tags-btn.tags-hidden {
		color: var(--color-accent);
	}

	.game-link {
		font-size: 0.78rem;
		color: var(--color-accent);
		text-decoration: none;
	}

	.game-link:hover {
		text-decoration: underline;
	}
</style>
