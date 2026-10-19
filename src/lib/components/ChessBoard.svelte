<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { Chessground } from '@lichess-org/chessground';
	import { Chess } from 'chess.js';
	import type { Square } from 'chess.js';
	import type { Api } from '@lichess-org/chessground/api';
	import type { Key } from '@lichess-org/chessground/types';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { BoardMoveHandler } from '$lib/board/types';
	import { describePositionChange } from '$lib/board/describe';
	import { prefersReducedMotion } from '$lib/motion';

	// Chessground base CSS (layout + positioning) is always needed.
	// Board square colors come from our generated theme CSS (class-scoped),
	// and the cburnett piece set is the default (piece set selection deferred).
	import '@lichess-org/chessground/assets/chessground.base.css';
	import '$lib/themes/board-themes.css';
	import '@lichess-org/chessground/assets/chessground.cburnett.css';

	// ---------------------------------------------------------------------------
	// Props
	// ---------------------------------------------------------------------------

	interface Props {
		/** FEN string for the position to display. Defaults to the starting position. */
		fen?: string;
		/** Which colour appears at the bottom of the board. */
		orientation?: 'white' | 'black';
		/** Board color theme name (matches a .board-theme-{name} CSS class). */
		boardTheme?: string;
		/**
		 * When true, the player whose turn it is can drag/click their pieces.
		 * Set to false during opponent auto-play in drill mode.
		 */
		interactive?: boolean;
		/**
		 * Highlight a move on the board (e.g. the last move played).
		 * Pass [fromSquare, toSquare], e.g. ['e2', 'e4'].
		 */
		lastMove?: [string, string];
		/**
		 * Called after the user makes a legal move (see BoardMoveHandler). To
		 * reject it, leave `fen` unchanged and the piece goes back.
		 */
		onMove?: BoardMoveHandler;
		/**
		 * Programmatic arrows/dots to draw on the board (e.g. repertoire move arrows
		 * in build mode). Uses Chessground's autoShapes — these are distinct from
		 * user-drawn right-click arrows. Defaults to an empty array (no shapes).
		 */
		autoShapes?: DrawShape[];
	}

	const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

	let {
		fen = STARTING_FEN,
		orientation = 'white',
		boardTheme = 'brown',
		interactive = true,
		lastMove = undefined,
		onMove = undefined,
		autoShapes = []
	}: Props = $props();

	// ---------------------------------------------------------------------------
	// Internal state
	// ---------------------------------------------------------------------------

	// boardEl: the div that Chessground attaches its DOM tree into.
	// set by Svelte's bind:this once the div is in the DOM.
	let boardEl: HTMLElement;

	// The Chessground API handle — lets us call cg.set() to update the board later.
	let cg: Api | undefined;

	// A reactive flag that flips to true inside onMount once Chessground is ready.
	// The $effect below watches this so it knows when it is safe to call cg.set().
	let initialized = $state(false);

	// A pawn dropped on the last rank, waiting for the user to pick a piece.
	let pendingPromotion = $state<{ orig: Key; dest: Key; color: 'white' | 'black' } | null>(null);
	let promotionPicker = $state<HTMLElement>();

	// The last FEN the board was synced to, so a re-sync for autoShapes or
	// `interactive` alone doesn't throw away a promotion being picked.
	let syncedFen: string | null = null;

	// What the visually hidden live region reads out after the position changes.
	let announcement = $state('');

	// ---------------------------------------------------------------------------
	// Helper functions
	// ---------------------------------------------------------------------------

	/**
	 * Build the legal-move destinations map that Chessground uses to draw the
	 * green dots when a piece is selected.
	 *
	 * Returns a Map<fromSquare, toSquare[]>.  Chessground calls this the "dests"
	 * map.  We compute it from Chess.js because Chessground itself has no idea
	 * which moves are legal — it is purely a visual component.
	 *
	 * Deduplication: when a pawn can promote, Chess.js returns 4 separate moves
	 * (one per promotion piece) to the same destination square.  We deduplicate
	 * so Chessground only sees one destination per square.
	 */
	function buildDests(chess: Chess): Map<Key, Key[]> {
		// A plain Map: it is handed to Chessground and never read reactively.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dests = new Map<Key, Key[]>();
		for (const move of chess.moves({ verbose: true })) {
			const from = move.from as Key;
			const to = move.to as Key;
			if (!dests.has(from)) dests.set(from, []);
			const arr = dests.get(from)!;
			// Only add the destination once (promotion generates duplicates)
			if (!arr.includes(to)) arr.push(to);
		}
		return dests;
	}

	/** Translate Chess.js 'w'/'b' to Chessground 'white'/'black'. */
	function toColor(chess: Chess): 'white' | 'black' {
		return chess.turn() === 'w' ? 'white' : 'black';
	}

	// ---------------------------------------------------------------------------
	// Move handler
	// ---------------------------------------------------------------------------

	/**
	 * Puts the board back to the props: the position, whose turn it is, the
	 * legal moves and the highlights. Undoes a move the parent rejected.
	 */
	function syncBoard(): void {
		if (!cg) return;
		const chess = new Chess(fen);
		cg.set({
			fen,
			orientation,
			turnColor: toColor(chess),
			movable: {
				color: interactive ? toColor(chess) : undefined,
				dests: interactive ? buildDests(chess) : new Map()
			},
			lastMove: lastMove as [Key, Key] | undefined,
			drawable: {
				autoShapes
			}
		});
	}

	/**
	 * Called by Chessground after the user drags or clicks a piece to a new square.
	 *
	 * At this point Chessground has already moved the piece visually. A pawn
	 * reaching the last rank first asks which piece to promote to; every other
	 * move goes straight to completeMove().
	 */
	function handleAfterMove(orig: Key, dest: Key): void {
		const chess = new Chess(fen);
		// Cast to Square: Chessground's Key includes the sentinel 'a0', but after()
		// is only ever called with real board squares, so this cast is safe.
		const piece = chess.get(orig as Square);
		const isPromotion =
			piece?.type === 'p' &&
			((piece.color === 'w' && dest[1] === '8') || (piece.color === 'b' && dest[1] === '1'));

		if (isPromotion) {
			pendingPromotion = { orig, dest, color: piece.color === 'w' ? 'white' : 'black' };
			// Nothing else moves until a piece is picked or the choice is cancelled.
			cg?.set({ movable: { color: undefined } });
			tick().then(() => promotionPicker?.querySelector('button')?.focus());
			return;
		}
		completeMove(orig, dest);
	}

	/**
	 * Validates the move through Chess.js (for the SAN and new FEN), updates
	 * Chessground's legal moves for the next ply and tells the parent.
	 */
	function completeMove(orig: Key, dest: Key, promotion?: string): void {
		const before = fen;
		const chess = new Chess(fen);
		let result;
		try {
			result = chess.move({ from: orig as Square, to: dest as Square, promotion });
		} catch {
			result = null;
		}
		if (!result) {
			// Should not happen because dests come from Chess.js, but snap back.
			syncBoard();
			return;
		}

		// Update the board's turn colour and legal-move map for the next ply.
		// The FEN too, so a promoted pawn shows as the piece that was picked.
		cg?.set({
			fen: chess.fen(),
			turnColor: toColor(chess),
			movable: {
				color: interactive ? toColor(chess) : undefined,
				dests: interactive ? buildDests(chess) : new Map()
			}
		});

		// Tell the parent what happened. `result.captured` is set when a piece
		// was taken — pass it as a boolean so the parent can pick the right sound.
		const outcome = onMove?.(orig, dest, result.san, chess.fen(), !!result.captured, promotion);
		void settleMove(before, outcome);
	}

	/**
	 * Once the parent has handled a move (waiting for it if it saves first),
	 * puts the piece back when the parent left `fen` where it was. That's how a
	 * parent rejects a move, so it never has to remount the board.
	 */
	async function settleMove(before: string, outcome: void | Promise<unknown>): Promise<void> {
		try {
			await outcome;
		} catch {
			// A failed handler rejected the move as surely as one that said no.
		}
		await tick();
		if (fen === before) syncBoard();
	}

	function choosePromotion(piece: 'q' | 'r' | 'b' | 'n'): void {
		if (!pendingPromotion) return;
		const { orig, dest } = pendingPromotion;
		pendingPromotion = null;
		completeMove(orig, dest, piece);
	}

	function cancelPromotion(): void {
		if (!pendingPromotion) return;
		pendingPromotion = null;
		syncBoard();
	}

	const PROMOTION_PIECES = [
		{ piece: 'q', role: 'queen' },
		{ piece: 'n', role: 'knight' },
		{ piece: 'r', role: 'rook' },
		{ piece: 'b', role: 'bishop' }
	] as const;

	// Where the picker goes: on the promotion square's file, starting at the
	// board edge and running toward the middle, like Lichess.
	const promotionLayout = $derived.by(() => {
		if (!pendingPromotion) return null;
		const file = pendingPromotion.dest.charCodeAt(0) - 'a'.charCodeAt(0);
		const column = orientation === 'white' ? file : 7 - file;
		const atTop = (pendingPromotion.dest[1] === '8') === (orientation === 'white');
		return { column, atTop };
	});

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	onMount(() => {
		const chess = new Chess(fen);

		cg = Chessground(boardEl, {
			fen,
			orientation,
			turnColor: toColor(chess),
			movable: {
				// free: false means only allow squares listed in `dests` (i.e. legal moves).
				// If free were true, any piece could move anywhere — no rules enforced.
				free: false,
				color: interactive ? toColor(chess) : undefined,
				dests: interactive ? buildDests(chess) : new Map(),
				events: {
					after: handleAfterMove
				}
			},
			highlight: {
				lastMove: true, // yellow tint on origin and destination of last move
				check: true // red tint on the king when in check
			},
			animation: {
				// Chessground animates from script, which the global reduced-motion
				// CSS rule can't reach.
				enabled: !prefersReducedMotion(),
				duration: 200 // milliseconds for piece movement animation
			},
			lastMove: lastMove as [Key, Key] | undefined
		});

		// Signal the $effect below that the board is ready.
		initialized = true;

		// Cleanup: called by Svelte when this component is removed from the DOM.
		return () => {
			cg?.destroy();
		};
	});

	/**
	 * Keep the board in sync with props.
	 *
	 * This effect re-runs whenever `initialized`, `fen`, `orientation`,
	 * `interactive`, or `lastMove` change.  The `initialized` guard means it
	 * is a no-op until onMount has finished setting up the board.
	 *
	 * Why not put all of this in onMount?  Because onMount runs once.  We need
	 * the board to update whenever the parent passes a new FEN (e.g. after an
	 * opponent move is played in drill mode, or when the user navigates to a
	 * different position in build mode).
	 */
	$effect(() => {
		if (!initialized || !cg) return;

		syncBoard();
		if (fen !== syncedFen) {
			// A new position from the parent ends any promotion being picked.
			untrack(() => (pendingPromotion = null));
			syncedFen = fen;
		}
	});

	// Announce each new position: the move that led to it, when one did, and
	// whose turn it is. The first position isn't announced, as nothing changed.
	let announcedFen: string | null = null;
	$effect(() => {
		const current = fen;
		if (announcedFen !== null && current !== announcedFen) {
			announcement = describePositionChange(announcedFen, current);
		}
		announcedFen = current;
	});
</script>

<!--
	boardEl is bound to this div.  Chessground appends its own child elements
	(cg-container, cg-board, piece elements, square elements) inside here, and
	adds the `cg-wrap` CSS class automatically.

	The width is controlled by the parent — set a width on the parent element
	and the board will fill it.  Height is kept equal to width via aspect-ratio.
-->
<div class="board-outer" role="group" aria-label="Chess board">
	<div bind:this={boardEl} class="board-wrap board-theme-{boardTheme}"></div>

	{#if pendingPromotion && promotionLayout}
		<!-- The picker sits over the board. Its own class is cg-wrap so the
		     piece set's images (scoped to .cg-wrap piece) apply to it. Clicking
		     beside it or pressing Escape cancels the move. -->
		<div
			class="promotion cg-wrap"
			role="presentation"
			onclick={cancelPromotion}
			onkeydown={(e) => e.key === 'Escape' && cancelPromotion()}
		>
			<div
				bind:this={promotionPicker}
				class="promotion-choices"
				role="group"
				aria-label="Promote to"
				style:left="{promotionLayout.column * 12.5}%"
				style:top={promotionLayout.atTop ? '0' : '50%'}
				style:flex-direction={promotionLayout.atTop ? 'column' : 'column-reverse'}
			>
				{#each PROMOTION_PIECES as { piece, role } (piece)}
					<button
						type="button"
						class="promotion-choice"
						aria-label="Promote to {role}"
						onclick={(e) => {
							e.stopPropagation();
							choosePromotion(piece);
						}}
					>
						<piece class="{role} {pendingPromotion.color}"></piece>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<p class="visually-hidden" aria-live="polite">{announcement}</p>
</div>

<style>
	/*
		The board must always be a perfect square.
		aspect-ratio: 1/1 means height = width automatically.

		Chessground's base CSS positions its child elements absolutely inside
		the .cg-wrap wrapper (which Chessground adds to this div), so the
		wrapper must have explicit pixel dimensions — percentage heights alone
		would not work without this trick.
	*/
	.board-outer {
		position: relative;
		width: 100%;
	}

	.board-wrap {
		width: 100%;
		aspect-ratio: 1 / 1;
		/* Prevent browser from hijacking touch events for scroll/zoom —
		   Chessground handles its own touch events internally. */
		touch-action: none;
	}

	/* ── Promotion picker ────────────────────────────────────────────────── */

	.promotion.cg-wrap {
		position: absolute;
		inset: 0;
		z-index: 20;
		background: rgba(0, 0, 0, 0.35);
	}

	.promotion-choices {
		position: absolute;
		width: 12.5%;
		height: 50%;
		display: flex;
	}

	.promotion-choice {
		flex: 1;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--color-surface-alt);
		cursor: pointer;
	}

	.promotion-choice:hover,
	.promotion-choice:focus-visible {
		background: var(--color-accent);
	}

	.promotion-choice:focus-visible {
		outline: 2px solid var(--color-text-primary);
		outline-offset: -2px;
	}

	.promotion-choice piece {
		position: static;
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	/* Shrink coordinate labels on small phones — --bp-sm */
	@media (max-width: 479px) {
		.board-wrap :global(coords) {
			font-size: 9px !important;
		}
	}
</style>
