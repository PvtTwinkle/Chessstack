<!--
	Drill → the board with its overlays: correct/incorrect flash, blindfold
	move announcement and the auto-play badge.
-->
<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import type { DrillState } from './drillState.svelte';

	let {
		drill,
		boardSize,
		boardTheme,
		orientation,
		onResize
	}: {
		drill: DrillState;
		boardSize: number;
		boardTheme: string;
		orientation: 'white' | 'black';
		onResize: (size: number) => void;
	} = $props();
</script>

<ResizableBoard {boardSize} {onResize}>
	<div class="board-wrap" class:blindfold={drill.blindfoldEnabled}>
		{#key drill.boardKey}
			<ChessBoard
				fen={drill.currentFen}
				{orientation}
				{boardTheme}
				interactive={drill.phase === 'waiting'}
				lastMove={drill.blindfoldEnabled ? undefined : drill.lastMove}
				autoShapes={drill.boardShapes}
				onMove={drill.handleMove}
			/>
		{/key}

		<!-- Green/red flash overlay on correct/incorrect -->
		{#if drill.flashColor}
			<div
				class="flash-overlay"
				class:flash-correct={drill.flashColor === 'green'}
				class:flash-incorrect={drill.flashColor === 'red'}
			></div>
		{/if}

		<!-- Blindfold move announcement -->
		{#if drill.blindfoldAnnouncement}
			<div class="blindfold-announce">{drill.blindfoldAnnouncement}</div>
		{/if}

		<!-- Auto-play indicator -->
		{#if drill.phase === 'playing'}
			<div class="autoplay-badge">▶ Playing through…</div>
		{/if}
	</div>
</ResizableBoard>

<style>
	.board-wrap {
		position: relative; /* needed for overlays */
		width: 100%;
	}

	/* ── Board overlays ──────────────────────────────────────────────────────── */

	.flash-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: 2px;
		animation: flash-fade 0.6s ease-out forwards;
	}

	.flash-correct {
		background: rgba(74, 222, 128, 0.35);
	}

	.flash-incorrect {
		background: rgba(248, 113, 113, 0.35);
	}

	@keyframes flash-fade {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.autoplay-badge {
		position: absolute;
		bottom: var(--space-2);
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-family: var(--font-body);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		pointer-events: none;
		white-space: nowrap;
	}

	/* ── Blindfold mode ─────────────────────────────────────────────────────── */
	.board-wrap.blindfold :global(.cg-wrap piece) {
		opacity: 0 !important;
	}

	.board-wrap.blindfold :global(cg-board square.move-dest) {
		background: none !important;
	}

	.board-wrap.blindfold :global(cg-board square.oc.move-dest) {
		background: none !important;
	}

	.board-wrap.blindfold :global(cg-board square.selected) {
		background-color: transparent !important;
	}

	.blindfold-announce {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2.5rem;
		font-weight: 700;
		color: white;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
		pointer-events: none;
		z-index: 3;
	}
</style>
