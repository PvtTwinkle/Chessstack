<!--
	TrainSetupPanel — pre-game configuration: starting position (repertoire,
	custom or saved), move source and rating bracket, depth limit, and
	rated/unrated, then the Start button.
-->

<script lang="ts">
	import { RATING_BRACKETS } from '$lib/ratings';
	import type { TrainState } from './trainState.svelte';

	let { s }: { s: TrainState } = $props();
</script>

<div class="section">
	<div class="section-label">Starting Position</div>
	<div class="tab-row">
		<button
			class="tab-btn"
			class:active={s.setupMode === 'repertoire'}
			onclick={() => s.switchSetupMode('repertoire')}
		>
			Repertoire
		</button>
		<button
			class="tab-btn"
			class:active={s.setupMode === 'custom'}
			onclick={() => s.switchSetupMode('custom')}
		>
			Custom
		</button>
		<button
			class="tab-btn"
			class:active={s.setupMode === 'saved'}
			onclick={() => s.switchSetupMode('saved')}
		>
			Saved
		</button>
	</div>

	{#if s.setupMode === 'repertoire'}
		<p class="setup-desc">Training starts from your repertoire's configured start position.</p>
	{:else if s.setupMode === 'custom'}
		<p class="setup-desc">Make moves on the board to reach your desired starting position.</p>
		<div class="custom-actions">
			<button class="btn btn-secondary btn-sm" onclick={s.resetCustomPosition}>
				Reset Board
			</button>
		</div>
		<!-- Save this position -->
		<div class="save-position-row">
			<input
				type="text"
				class="save-position-input"
				placeholder="Position name..."
				maxlength="100"
				bind:value={s.savePositionName}
			/>
			<button
				class="btn btn-secondary btn-sm"
				onclick={s.saveCurrentPosition}
				disabled={s.savingPosition || !s.savePositionName.trim()}
			>
				Save
			</button>
		</div>
	{:else if s.setupMode === 'saved'}
		{#if s.savedPositions.length === 0}
			<p class="setup-desc">No saved positions yet. Use the Custom tab to save one.</p>
		{:else}
			<div class="saved-row">
				<select
					class="bracket-select"
					value={s.selectedSavedId ?? ''}
					onchange={(e) => {
						const val = (e.target as HTMLSelectElement).value;
						if (val) s.selectSavedPosition(Number(val));
					}}
				>
					<option value="" disabled>Select a position...</option>
					{#each s.savedPositions as pos (pos.id)}
						<option value={pos.id}>{pos.name}</option>
					{/each}
				</select>
				{#if s.selectedSavedId !== null}
					<button
						class="btn btn-secondary btn-sm saved-delete-btn"
						onclick={() => {
							if (s.selectedSavedId !== null) s.deleteSavedPosition(s.selectedSavedId);
						}}
						title="Delete saved position"
						aria-label="Delete saved position"
					>
						&times;
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<div class="section">
	<div class="section-label">Move Source</div>
	<div class="tab-row">
		<button
			class="tab-btn"
			class:active={s.moveSource === 'PLAYERS'}
			onclick={() => {
				s.moveSource = 'PLAYERS';
			}}
		>
			Players
		</button>
		<button
			class="tab-btn"
			class:active={s.moveSource === 'MASTERS'}
			onclick={() => {
				s.moveSource = 'MASTERS';
			}}
		>
			Masters
		</button>
	</div>
	{#if s.moveSource === 'PLAYERS'}
		<div class="bracket-row">
			<label class="bracket-label" for="bracket-select">Rating Bracket</label>
			<select id="bracket-select" class="bracket-select" bind:value={s.selectedBracket}>
				{#each RATING_BRACKETS as bracket (bracket.id)}
					<option value={bracket.id}>{bracket.label}</option>
				{/each}
			</select>
		</div>
		<p class="setup-desc">
			Computer plays moves from Lichess games in the {RATING_BRACKETS[s.selectedBracket].label} rating
			range.
		</p>
	{:else}
		<p class="setup-desc">Computer plays moves from master-level games (2500+ ELO).</p>
	{/if}
</div>

<div class="section">
	<div class="section-label">Depth Limit</div>
	<div class="depth-row">
		<input type="number" class="depth-input" min="0" max="200" bind:value={s.depthLimit} />
		<span class="depth-hint">
			{s.depthLimit === 0 ? 'No limit' : `${s.depthLimit} move${s.depthLimit === 1 ? '' : 's'}`}
		</span>
	</div>
	<p class="setup-desc">
		Training always stops when the database runs out of moves or the game ends. Set a number above 0
		to also stop at that many full moves.
	</p>
</div>

<div class="section">
	<div class="section-label">Session Type</div>
	<div class="tab-row">
		<button
			class="tab-btn"
			class:active={s.rated}
			onclick={() => {
				s.rated = true;
			}}
		>
			Rated
		</button>
		<button
			class="tab-btn"
			class:active={!s.rated}
			onclick={() => {
				s.rated = false;
			}}
		>
			Unrated
		</button>
	</div>
</div>

<button class="btn btn-primary btn-start" onclick={s.startTraining}> Start Training </button>

<style>
	/* ── Tab rows ────────────────────────────────────────────────────────────── */

	.tab-row {
		display: flex;
		gap: 2px;
		border-radius: var(--radius-md);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}

	.tab-btn {
		flex: 1;
		padding: var(--space-2) var(--space-2);
		border: none;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.78rem;
		font-weight: 600;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-snap);
	}

	.tab-btn.active {
		background: var(--color-accent);
		color: #fff;
	}

	.tab-btn:hover:not(.active) {
		background: rgba(91, 127, 164, 0.12);
	}

	/* ── Custom position ─────────────────────────────────────────────────────── */

	.custom-actions {
		display: flex;
		gap: var(--space-2);
	}

	.save-position-row {
		display: flex;
		gap: var(--space-2);
	}

	.save-position-input {
		flex: 1;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.78rem;
		font-family: var(--font-body);
	}

	/* ── Saved positions list ────────────────────────────────────────────────── */

	.saved-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* Padding and font size come from .btn-sm, which this button also has. */
	.saved-delete-btn {
		flex-shrink: 0;
		min-width: 36px;
		line-height: 1;
	}

	/* ── Depth input ─────────────────────────────────────────────────────────── */

	.depth-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.depth-input {
		width: 70px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
		font-family: var(--font-body);
	}

	.depth-hint {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
	}

	/* ── Bracket selector ────────────────────────────────────────────────────── */

	.bracket-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.bracket-label {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.bracket-select {
		flex: 1;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.82rem;
		font-family: var(--font-body);
		cursor: pointer;
	}
</style>
