<!--
	Opening Trainer — /train
	────────────────────────
	Practice openings against a computer that plays moves weighted by real game
	statistics from the Lichess open database or masters database.

	The game logic and the setup → playing → ended state machine live in
	trainState.svelte.ts. This page syncs it from the server data, renders the
	board, and shows the sidebar panel for the current phase.
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import RatingSetup from '$lib/components/train/RatingSetup.svelte';
	import TrainSetupPanel from '$lib/components/train/TrainSetupPanel.svelte';
	import TrainPlayingPanel from '$lib/components/train/TrainPlayingPanel.svelte';
	import TrainEndPanel from '$lib/components/train/TrainEndPanel.svelte';
	import { createTrainState, type SavedPosition } from '$lib/components/train/trainState.svelte';
	import '$lib/components/train/train-ui.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { initSounds, setSoundEnabled } from '$lib/sounds';
	import { bracketForRating } from '$lib/ratings';

	let { data }: { data: PageData } = $props();

	const s = createTrainState(() => data);

	// ── Sync from server data on load ───────────────────────────────────────────

	$effect(() => {
		s.syncRating(data.trainerRating);
	});

	$effect(() => {
		s.syncSound(data.settings?.soundEnabled ?? true);
	});

	$effect(() => {
		s.syncSavedPositions(data.savedPositions as SavedPosition[]);
	});

	// Rating bracket for Players mode: defaults to bracket matching trainer rating
	$effect(() => {
		const rating = data.trainerRating;
		if (rating !== null) {
			s.syncBracket(bracketForRating(rating) ?? 7);
		} else {
			s.syncBracket(data.settings?.playersRatingBracket ?? 3);
		}
	});

	// ── Board resize ────────────────────────────────────────────────────────────

	function handleBoardResize(size: number) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ boardSize: size })
		});
	}

	// ── Sound ───────────────────────────────────────────────────────────────────

	onMount(() => {
		initSounds();
		setSoundEnabled(s.soundEnabled);
	});

	// ── Review handoff ──────────────────────────────────────────────────────────

	function reviewGame() {
		sessionStorage.setItem('chessstack:trainer-review', JSON.stringify(s.reviewHandoff()));
		goto('/review'); // eslint-disable-line svelte/no-navigation-without-resolve
	}
</script>

<div class="page train-ui">
	<!-- ── Board column ──────────────────────────────────────────────────────── -->
	<div class="board-col">
		<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={handleBoardResize}>
			<div class="board-wrap">
				{#key s.boardKey}
					<ChessBoard
						fen={s.currentFen}
						orientation={s.orientation}
						boardTheme={data.settings?.boardTheme ?? 'blue'}
						interactive={(s.phase === 'setup' && s.setupMode === 'custom') ||
							(s.phase === 'playing' && s.isUserTurn && !s.waitingForComputer)}
						lastMove={s.lastMove}
						onMove={s.phase === 'setup' ? s.handleSetupMove : s.handleMove}
					/>
				{/key}

				{#if s.phase === 'playing' && s.waitingForComputer}
					<div class="autoplay-badge">Thinking...</div>
				{/if}
			</div>
		</ResizableBoard>
	</div>

	<!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
	<div class="sidebar">
		<!-- Repertoire header -->
		<div class="rep-header">
			<span class="rep-icon"
				><span
					class="color-dot {data.repertoire.color === 'WHITE'
						? 'color-dot--white'
						: 'color-dot--black'}"
				></span></span
			>
			<span class="rep-name">{data.repertoire.name}</span>
			<span
				class="color-badge"
				class:badge-white={data.repertoire.color === 'WHITE'}
				class:badge-black={data.repertoire.color === 'BLACK'}
			>
				{data.repertoire.color === 'WHITE' ? 'White' : 'Black'}
			</span>
			<button
				class="mute-btn"
				class:muted={!s.soundEnabled}
				onclick={s.toggleSound}
				title={s.soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
				aria-label={s.soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
			>
				{s.soundEnabled ? '🔊' : '🔇'}
			</button>
		</div>

		<!-- Opening name -->
		<OpeningName currentFen={s.currentFen} fenHistory={s.gameMoves.map((m) => m.fen).reverse()} />

		<!-- Rating display -->
		{#if s.trainerRating !== null}
			<div class="rating-display">
				<span class="rating-label">Trainer Rating</span>
				<span class="rating-value">{s.trainerRating}</span>
			</div>
		{/if}

		{#if s.showRatingSetup}
			<RatingSetup {s} />
		{/if}

		{#if s.phase === 'setup' && !s.showRatingSetup}
			<TrainSetupPanel {s} />
		{:else if s.phase === 'playing'}
			<TrainPlayingPanel {s} />
		{:else if s.phase === 'ended'}
			<TrainEndPanel {s} onReview={reviewGame} />
		{/if}
	</div>
</div>

<style>
	/* ── Page layout ──────────────────────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.board-col {
		width: 100%;
	}

	.board-wrap {
		position: relative;
		width: 100%;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	@media (min-width: 768px) {
		.page {
			display: grid;
			grid-template-columns: auto 280px;
			gap: var(--space-4);
			align-items: start;
			justify-content: center;
			padding: 0;
		}
	}

	@media (min-width: 1024px) {
		.page {
			grid-template-columns: auto 340px;
			gap: var(--space-6);
			max-width: 1100px;
			margin: 0 auto;
		}
	}

	@media (max-width: 479px) {
		.page {
			padding: var(--space-2);
			gap: var(--space-2);
		}

		.sidebar {
			padding: var(--space-3);
			gap: var(--space-3);
		}
	}

	/* ── Repertoire header ───────────────────────────────────────────────────── */

	.rep-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.rep-icon {
		display: inline-flex;
	}

	.color-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.color-dot--white {
		background: #fff;
		border: 1px solid var(--color-border);
	}

	.color-dot--black {
		background: #333;
	}

	.rep-name {
		font-weight: 600;
		font-size: 0.95rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}

	.badge-white {
		background: rgba(255, 255, 255, 0.15);
		color: var(--color-text-secondary);
	}

	.badge-black {
		background: rgba(0, 0, 0, 0.25);
		color: var(--color-text-secondary);
	}

	.mute-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		padding: 0.15rem;
		opacity: 0.7;
		transition: opacity var(--dur-fast) var(--ease-snap);
	}

	.mute-btn:hover {
		opacity: 1;
	}

	.mute-btn.muted {
		opacity: 0.35;
	}

	/* ── Rating display ──────────────────────────────────────────────────────── */

	.rating-display {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: rgba(91, 127, 164, 0.08);
		border: 1px solid rgba(91, 127, 164, 0.2);
	}

	.rating-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
	}

	.rating-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-accent);
		font-variant-numeric: tabular-nums;
	}

	/* ── Autoplay badge ──────────────────────────────────────────────────────── */

	.autoplay-badge {
		position: absolute;
		top: var(--space-2);
		left: 50%;
		transform: translateX(-50%);
		padding: 0.2rem 0.7rem;
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
		border-radius: var(--radius-md);
		font-size: 0.72rem;
		font-weight: 600;
		pointer-events: none;
		z-index: 3;
	}
</style>
