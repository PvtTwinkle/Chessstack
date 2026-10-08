<!--
	NavControls — reset, undo and annotate buttons under the candidate moves.

	Undo is navigation only: it never deletes a saved move. In explore mode the
	annotate button is hidden, and "Add current line to repertoire" appears
	once the line has a move that isn't saved yet.

	Props:
	  s — the Build Mode state from createBuildState()
-->

<script lang="ts">
	import type { BuildState } from './buildState.svelte';

	let { s }: { s: BuildState } = $props();
</script>

<div class="nav-controls">
	<button
		class="nav-btn"
		onclick={s.handleReset}
		disabled={s.navHistory.length === 0 || s.saving}
		title="Return to the starting position"
	>
		⏮
	</button>
	<button
		class="nav-btn nav-btn--undo"
		onclick={s.handleUndo}
		disabled={s.navHistory.length === 0 || s.saving}
		title="Go back one move (does not delete from repertoire)"
	>
		← Undo
	</button>
	{#if !s.exploreMode}
		<button
			class="nav-btn nav-btn--annotate"
			onclick={s.annotateLastMove}
			disabled={s.navHistory.length === 0 || s.saving}
			title="Annotate the last move"
		>
			✎
		</button>
	{/if}
</div>

{#if s.exploreMode && s.hasUnsavedExploreMoves}
	<button
		class="save-line-btn"
		onclick={s.saveExploreLine}
		disabled={s.saving}
		title="Save all moves in the current line to your repertoire"
	>
		{s.saving ? 'Saving…' : 'Add current line to repertoire'}
	</button>
{/if}

<style>
	/* ── Navigation controls ─────────────────────────────────────────────────── */

	.nav-controls {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.nav-btn {
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.nav-btn:hover:not(:disabled) {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
	}

	.nav-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.nav-btn--undo {
		flex: 1;
	}

	.nav-btn--annotate {
		flex-shrink: 0;
	}

	/* ── Save explore line button ───────────────────────────────────────────── */

	.save-line-btn {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-explore-glow);
		border: 1px solid rgba(103, 232, 249, 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-explore);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.save-line-btn:hover:not(:disabled) {
		border-color: var(--color-explore);
		background: rgba(103, 232, 249, 0.2);
	}

	.save-line-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
