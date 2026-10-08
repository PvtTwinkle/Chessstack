<!--
	PositionMoves — the saved moves from the current position.

	In build mode this is "YOUR MOVE" / "OPPONENT RESPONSES", with buttons to
	annotate or delete each move and a preview of its notes. In explore mode
	it's a plain "SAVED MOVES HERE" list, shown only when there are any.
	Hovering a move draws its arrow on the board.

	Props:
	  s — the Build Mode state from createBuildState()
	  highlightedIdx — the move picked with the ↑ / ↓ keys, or null

	Events:
	  onHover(san) — called with the hovered move's SAN, or null on leave
-->

<script lang="ts">
	import type { BuildState } from './buildState.svelte';
	import { notePreview } from './buildView';

	interface Props {
		s: BuildState;
		highlightedIdx: number | null;
		onHover: (san: string | null) => void;
	}

	let { s, highlightedIdx, onHover }: Props = $props();
</script>

{#if s.exploreMode}
	{#if s.movesFromCurrentPosition.length > 0}
		<div class="section">
			<div class="section-label">SAVED MOVES HERE</div>
			<div class="position-moves">
				{#each s.movesFromCurrentPosition as m, idx (m.id)}
					<div class="position-move-row">
						<button
							class="move-nav-btn"
							class:move-nav-btn--highlighted={highlightedIdx === idx}
							onclick={() => s.navigateTo(m)}
							onmouseenter={() => onHover(m.san)}
							onmouseleave={() => onHover(null)}
						>
							{m.san}
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
{:else}
	<div class="section">
		<div class="section-label">
			{s.isUserTurn ? 'YOUR MOVE' : 'OPPONENT RESPONSES'}
		</div>

		{#if s.movesFromCurrentPosition.length > 0}
			<div class="position-moves">
				{#each s.movesFromCurrentPosition as m, idx (m.id)}
					<div class="position-move-item">
						<div class="position-move-row">
							<button
								class="move-nav-btn"
								class:move-nav-btn--highlighted={highlightedIdx === idx}
								onclick={() => s.navigateTo(m)}
								onmouseenter={() => onHover(m.san)}
								onmouseleave={() => onHover(null)}
							>
								{m.san}
							</button>
							<button
								class="move-annotate-btn"
								onclick={() => s.openAnnotation(m)}
								title="Add or edit annotation"
								aria-label="Edit annotation for {m.san}"
							>
								✎
							</button>
							<button
								class="move-delete-btn"
								onclick={() => s.confirmDelete(m)}
								disabled={s.saving}
								title="Remove this move and all moves after it"
							>
								✕
							</button>
						</div>
						{#if m.notes}
							<p class="move-notes">{notePreview(m.notes)}</p>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-hint">
				{#if s.isUserTurn}
					No move saved yet — play one on the board.
				{:else}
					No responses yet — play an opponent move to add one.
				{/if}
			</p>
		{/if}
	</div>
{/if}

<style>
	/* ── Sections ────────────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		box-shadow: var(--shadow-surface);
	}

	.section-label {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	/* ── Moves from current position ─────────────────────────────────────────── */

	.position-moves {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.position-move-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.move-nav-btn {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.move-nav-btn:hover,
	.move-nav-btn--highlighted {
		border-color: var(--color-accent-dim);
		color: var(--color-accent);
		box-shadow: var(--glow-accent);
	}

	.move-delete-btn {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 11px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
		padding: 0;
	}

	.move-delete-btn:hover:not(:disabled) {
		border-color: rgba(248, 113, 113, 0.5);
		color: var(--color-danger);
	}

	.move-delete-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.empty-hint {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	/* ── Annotation UI ───────────────────────────────────────────────────────── */

	.position-move-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.move-notes {
		font-size: 11px;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0 0 0 var(--space-1);
		line-height: 1.4;
		word-break: break-word;
	}

	.move-annotate-btn {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 12px;
		cursor: pointer;
		padding: 0;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.move-annotate-btn:hover {
		border-color: var(--color-text-muted);
		color: var(--color-text-secondary);
	}
</style>
