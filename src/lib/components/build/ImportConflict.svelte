<!--
	One import conflict: the position on a board with an arrow per candidate
	move, and a button per move to keep. Used by the PGN import modal and the
	opening guides' "Add to my repertoire".
-->
<script lang="ts">
	import { Chess } from 'chess.js';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import type { ImportConflict } from '$lib/pgn/detectConflicts';

	let {
		conflict,
		repertoireColor,
		/** Tag for moves that aren't already saved, e.g. "PGN". */
		newLabel,
		/** What a clash inside the imported lines is called, e.g. "PGN has multiple options". */
		internalNote,
		onChoose
	}: {
		conflict: ImportConflict;
		repertoireColor: 'WHITE' | 'BLACK';
		newLabel: string;
		internalNote: string;
		onChoose: (san: string) => void;
	} = $props();

	// Green for the first, blue for the second, red for the third, etc.
	const ARROW_COLORS = ['green', 'blue', 'red', 'yellow'];

	const arrows = $derived.by<DrawShape[]>(() => {
		try {
			const chess = new Chess(conflict.fromFen);
			const shapes: DrawShape[] = [];
			for (let i = 0; i < conflict.alternatives.length; i++) {
				chess.load(conflict.fromFen);
				const result = chess.move(conflict.alternatives[i]);
				if (result) {
					shapes.push({
						orig: result.from,
						dest: result.to,
						brush: ARROW_COLORS[i % ARROW_COLORS.length]
					});
				}
			}
			return shapes;
		} catch {
			return [];
		}
	});

	let turn = $derived(conflict.fromFen.split(' ')[1] === 'w' ? 'White' : 'Black');
</script>

<div class="conflict-card">
	<p class="conflict-context">
		{turn} to move
		{#if conflict.source === 'REPERTOIRE_VS_PGN'}
			— your repertoire has a different move
		{:else}
			— {internalNote}
		{/if}
	</p>

	<div class="conflict-body">
		<div class="conflict-board">
			{#key conflict.fromFen}
				<ChessBoard
					fen={conflict.fromFen}
					orientation={repertoireColor === 'WHITE' ? 'white' : 'black'}
					interactive={false}
					autoShapes={arrows}
				/>
			{/key}
		</div>

		<div class="conflict-choices">
			{#each conflict.alternatives as alt, i (alt)}
				<button
					class="choice-btn"
					class:choice-existing={alt === conflict.existingMove}
					onclick={() => onChoose(alt)}
				>
					<span class="choice-row">
						<span class="arrow-dot" style:background={ARROW_COLORS[i % ARROW_COLORS.length]}></span>
						<span class="choice-san">{alt}</span>
					</span>
					<span class="choice-tag">{alt === conflict.existingMove ? 'current' : newLabel}</span>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.conflict-card {
		padding: var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.conflict-context {
		margin: 0 0 var(--space-2);
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		line-height: 1.4;
	}

	.conflict-body {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.conflict-board {
		width: 200px;
		flex-shrink: 0;
	}

	.conflict-choices {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1;
	}

	.choice-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-3);
		background: var(--color-surface-alt);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		cursor: pointer;
		transition:
			border-color var(--dur-fast),
			background var(--dur-fast);
	}

	.choice-btn:hover {
		border-color: var(--color-accent);
		background: var(--color-surface);
	}

	.choice-existing {
		border-color: var(--color-success);
	}

	.choice-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.arrow-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.choice-san {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-body);
	}

	.choice-tag {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	/* ── Mobile touch targets ── --bp-md */
	@media (max-width: 767px) {
		.choice-btn {
			min-height: 44px;
		}
	}

	/* ── Stack the board on narrow phones ── --bp-sm */
	@media (max-width: 479px) {
		.conflict-body {
			flex-direction: column;
		}

		.conflict-board {
			width: 100%;
		}
	}
</style>
