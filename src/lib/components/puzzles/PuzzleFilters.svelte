<!--
	PuzzleFilters — colour, opening, rating and theme filters for the next puzzle.
-->

<script lang="ts">
	import type { PuzzlesState } from './puzzlesState.svelte';
	import { formatFamily, formatThemeLabel } from '$lib/puzzles/solution';

	interface Props {
		puzzles: PuzzlesState;
		families: string[];
		themes: string[];
		repertoireColor: string | null;
	}

	let { puzzles, families, themes, repertoireColor }: Props = $props();
</script>

<details class="filters" open>
	<summary class="filters-title">Filters</summary>

	{#if repertoireColor}
		<div class="filter-group">
			<label class="color-filter-label">
				<input type="checkbox" bind:checked={puzzles.myColorOnly} />
				<span>My color only ({repertoireColor === 'WHITE' ? 'White' : 'Black'})</span>
			</label>
		</div>
	{/if}

	<div class="filter-group">
		<label class="filter-label" for="opening-filter">Opening</label>
		<select
			id="opening-filter"
			class="filter-select"
			bind:value={puzzles.selectedFamilies}
			multiple
		>
			{#each families as family (family)}
				<option value={family}>{formatFamily(family)}</option>
			{/each}
		</select>
		<span class="filter-hint">Hold Ctrl/Cmd to select multiple. Empty = all.</span>
	</div>

	<div class="filter-group">
		<label class="filter-label" for="min-rating">Rating Range</label>
		<div class="rating-inputs">
			<input
				id="min-rating"
				type="number"
				class="filter-input"
				placeholder="Min"
				bind:value={puzzles.minRating}
			/>
			<span class="rating-sep">–</span>
			<input
				id="max-rating"
				type="number"
				class="filter-input"
				placeholder="Max"
				aria-label="Maximum rating"
				bind:value={puzzles.maxRating}
			/>
		</div>
	</div>

	{#if themes.length > 0}
		<fieldset class="filter-group">
			<legend class="filter-label">Themes</legend>
			<div class="theme-checkboxes">
				{#each themes as theme (theme)}
					<label class="theme-checkbox-label">
						<input
							type="checkbox"
							value={theme}
							checked={puzzles.selectedThemes.includes(theme)}
							onchange={(e) => puzzles.toggleTheme(theme, e.currentTarget.checked)}
						/>
						<span>{formatThemeLabel(theme)}</span>
					</label>
				{/each}
			</div>
			<span class="filter-hint">Empty = all themes. Checked = match any.</span>
		</fieldset>
	{/if}
</details>

<style>
	/* ── Filters ──────────────────────────────────────────────────────────────── */

	.filters {
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	.filters-title {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-weight: 500;
		margin-bottom: var(--space-2);
	}

	.filter-group {
		margin-top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.filter-label {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.filter-select {
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1);
		font-family: var(--font-body);
		font-size: 0.82rem;
		min-height: 80px;
	}

	.filter-select option {
		padding: var(--space-1) var(--space-2);
	}

	.filter-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.rating-inputs {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		min-width: 0;
	}

	.filter-input {
		flex: 1;
		min-width: 0;
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-body);
		font-size: 0.82rem;
	}

	.filter-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.filter-input::placeholder {
		color: var(--color-text-muted);
	}

	.rating-sep {
		color: var(--color-text-muted);
	}

	/* ── Color filter ────────────────────────────────────────────────────────── */

	.color-filter-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.82rem;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.color-filter-label input[type='checkbox'] {
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	/* ── Theme checkboxes ────────────────────────────────────────────────────── */

	.theme-checkboxes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		max-height: 200px;
		overflow-y: auto;
		padding: var(--space-1) 0;
	}

	.theme-checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		white-space: nowrap;
	}

	.theme-checkbox-label input[type='checkbox'] {
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	fieldset.filter-group {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
	}

	legend.filter-label {
		padding: 0;
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.filter-input {
			font-size: 16px; /* prevents iOS auto-zoom on focus */
		}

		.theme-checkbox-label {
			min-height: 44px;
			align-items: center;
		}

		.color-filter-label {
			min-height: 44px;
		}
	}
</style>
