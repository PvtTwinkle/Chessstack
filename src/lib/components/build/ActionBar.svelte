<!--
	ActionBar — chip row at the bottom of the Build sidebar (build mode only).

	Chips: set or clear the repertoire's custom start position, drill every
	card from this position, and open the position on Lichess. A "Saving…"
	line shows below while a request is in flight.

	Props:
	  s — the Build Mode state from createBuildState()
	  orientation — board orientation, passed on to the Lichess link
-->

<script lang="ts">
	import type { BuildState } from './buildState.svelte';
	import { startPositionChip, drillHereUrl, lichessAnalysisUrl } from './buildView';

	interface Props {
		s: BuildState;
		orientation: 'white' | 'black';
	}

	let { s, orientation }: Props = $props();

	const startChip = $derived(
		startPositionChip({
			currentFen: s.currentFen,
			startFen: s.startFen,
			isStartPosition: s.isStartPosition,
			lineLength: s.navHistory.length
		})
	);
</script>

<div class="action-bar">
	{#if startChip === 'active'}
		<div class="action-chip action-chip--active">
			Start Position
			<button
				class="action-chip-x"
				onclick={s.clearStartPosition}
				disabled={s.saving}
				title="Reset to default (after first move)"
			>
				✕
			</button>
		</div>
	{:else if startChip === 'set'}
		<button
			class="action-chip"
			onclick={s.setStartPosition}
			disabled={s.saving}
			title="Set this position as the repertoire's starting point — moves before it won't be drilled"
		>
			Set Start
		</button>
	{:else if startChip === 'clear'}
		<button
			class="action-chip"
			onclick={s.clearStartPosition}
			disabled={s.saving}
			title="Reset to default (after first move)"
		>
			Clear Start
		</button>
	{/if}

	{#if s.navHistory.length > 0 && s.movesFromCurrentPosition.length > 0}
		<a
			href={drillHereUrl(s.currentFen)}
			class="action-chip"
			title="Drill all cards downstream from this position"
		>
			Drill here
		</a>
	{/if}

	<a
		href={lichessAnalysisUrl(s.currentFen, orientation)}
		target="_blank"
		rel="noopener"
		class="action-chip"
		title="Analyze this position on Lichess"
	>
		Lichess ↗
	</a>
</div>

<!-- Saving indicator -->
{#if s.saving}
	<div class="saving-indicator">Saving…</div>
{/if}

<style>
	/* ── Action toolbar (compact chip row) ──────────────────────────────── */

	.action-bar {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.action-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 11px;
		text-decoration: none;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.action-chip:hover {
		border-color: var(--color-accent-dim);
		color: var(--color-accent);
		background: rgba(59, 130, 246, 0.05);
	}

	.action-chip:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.action-chip--active {
		background: rgba(74, 222, 128, 0.08);
		border-color: rgba(74, 222, 128, 0.2);
		color: var(--color-success);
	}

	.action-chip--active:hover {
		border-color: rgba(74, 222, 128, 0.4);
	}

	.action-chip-x {
		background: none;
		border: none;
		color: inherit;
		opacity: 0.5;
		cursor: pointer;
		font-size: 10px;
		padding: 0 2px;
		margin-left: 2px;
		line-height: 1;
		transition:
			opacity var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.action-chip-x:hover:not(:disabled) {
		opacity: 1;
		color: var(--color-danger);
	}

	.action-chip-x:disabled {
		opacity: 0.2;
		cursor: default;
	}

	/* ── Saving indicator ────────────────────────────────────────────────────── */

	.saving-indicator {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
		text-align: center;
	}
</style>
