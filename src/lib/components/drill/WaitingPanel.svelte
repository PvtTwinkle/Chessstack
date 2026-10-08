<!--
	Drill → the user's turn: turn indicator, tempo countdown and hint (card
	mode), the line so far, and the opponent's move note.
-->
<script lang="ts">
	import DrillLineDisplay from './DrillLineDisplay.svelte';
	import DrillNote from './DrillNote.svelte';
	import RevealedMove from './RevealedMove.svelte';
	import type { DrillState } from './drillState.svelte';

	let { drill }: { drill: DrillState } = $props();
</script>

<div class="turn-indicator user-turn">
	<span class="turn-dot"></span>
	YOUR TURN <span class="turn-hint">— play your move</span>
</div>

<!-- Tempo countdown bar (card mode only) -->
{#if drill.drillType === 'card' && drill.tempoEnabled}
	<div class="tempo-bar-wrap">
		<div
			class="tempo-bar-fill"
			class:tempo-warning={drill.tempoFraction <= 0.5 && drill.tempoFraction > 0.2}
			class:tempo-danger={drill.tempoFraction <= 0.2}
			style="width: {drill.tempoFraction * 100}%"
		></div>
		<span class="tempo-label">{drill.tempoRemaining}s</span>
	</div>
{/if}

<!-- Hint button / hint-active indicator (card mode only) -->
{#if drill.drillType === 'card'}
	{#if !drill.hintUsed}
		<button class="hint-btn" onclick={drill.showHint}>💡 Hint</button>
	{:else}
		<div class="hint-active">
			<span>💡 Hint active — piece highlighted</span>
			<span class="hint-penalty">Move will be graded Forgot</span>
		</div>
	{/if}
{/if}

<!-- Current line display -->
<DrillLineDisplay navHistory={drill.navHistory} />

<!-- Revealed correct move (line mode: shown briefly on wrong answer) -->
{#if drill.drillType === 'line' && drill.revealedSan}
	<RevealedMove san={drill.revealedSan} />
{/if}

<!-- Note on the opponent's last move (the move that reached this position) -->
{#if drill.drillType === 'card' && drill.currentPositionNote}
	<DrillNote text={drill.currentPositionNote} />
{/if}

<style>
	/* ── Turn indicator ───────────────────────────────────────────────────────── */

	.turn-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
	}

	.turn-indicator.user-turn {
		background: rgba(91, 127, 164, 0.1);
		border-color: rgba(91, 127, 164, 0.3);
		color: var(--color-accent);
	}

	.turn-dot {
		width: var(--space-2);
		height: var(--space-2);
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	.turn-hint {
		font-weight: 400;
		font-size: 0.75rem;
		opacity: 0.8;
	}

	/* ── Tempo timer bar ─────────────────────────────────────────────────────── */

	.tempo-bar-wrap {
		position: relative;
		height: 6px;
		background: var(--color-surface-alt);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: var(--space-3);
	}

	.tempo-bar-fill {
		height: 100%;
		border-radius: 3px;
		background: var(--color-success);
		transition:
			width 0.1s linear,
			background 0.3s ease;
	}

	.tempo-bar-fill.tempo-warning {
		background: var(--color-accent);
	}

	.tempo-bar-fill.tempo-danger {
		background: var(--color-danger);
	}

	.tempo-label {
		position: absolute;
		right: 0;
		top: -18px;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* ── Hint button ──────────────────────────────────────────────────────────── */

	.hint-btn {
		width: 100%;
		padding: 0.45rem;
		border-radius: var(--radius-md);
		border: 1px solid rgba(91, 127, 164, 0.35);
		background: rgba(91, 127, 164, 0.08);
		color: var(--color-accent);
		font-size: 0.8rem;
		font-family: var(--font-body);
		cursor: pointer;
		transition: filter var(--dur-fast) var(--ease-snap);
	}

	.hint-btn:hover {
		filter: brightness(1.2);
		box-shadow: var(--glow-accent);
	}

	.hint-active {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid rgba(91, 127, 164, 0.25);
		background: rgba(91, 127, 164, 0.06);
		font-size: 0.78rem;
		color: var(--color-accent-dim);
	}

	.hint-penalty {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		font-style: italic;
	}
</style>
