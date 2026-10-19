<!--
	EvalBar — vertical evaluation bar for Build Mode.

	Displays a thin vertical bar beside the chessboard showing the engine's
	position evaluation at a glance. White's portion is at the bottom (at the
	top when the board is flipped, so it always sits on White's side), with the
	numerical eval overlaid on the larger half. Screen readers get the eval as
	text with its sign spelled out, since the bar shows it by colour and side.
-->

<script lang="ts">
	import { describeEval } from '$lib/board/describe';

	interface Props {
		evalCp: number | null;
		evalMate: number | null;
		orientation: 'white' | 'black';
	}

	let { evalCp, evalMate, orientation }: Props = $props();

	/** Convert centipawns to a 0–100 percentage for white's portion. */
	function cpToPercent(cp: number): number {
		// Sigmoid curve: 0cp → 50%, ±200cp → ~73%, ±500cp → ~93%
		const pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
		return Math.max(2, Math.min(98, pct));
	}

	/** White's share of the bar as a percentage (0–100). */
	const whitePct = $derived.by(() => {
		if (evalCp === null && evalMate === null) return 50;
		if (evalMate !== null) return evalMate > 0 ? 98 : 2;
		return cpToPercent(evalCp!);
	});

	/** Format the eval as a human-readable string. */
	const evalText = $derived.by(() => {
		if (evalCp === null && evalMate === null) return '';
		if (evalMate !== null) {
			return evalMate > 0 ? `#${evalMate}` : `-#${Math.abs(evalMate)}`;
		}
		const pawns = Math.abs(evalCp!) / 100;
		return pawns.toFixed(1);
	});

	/** Whether the eval favors white (for label placement). */
	const whiteAdvantage = $derived(whitePct >= 50);

	/**
	 * Bar orientation matches the board: white at bottom when orientation='white'.
	 * Top portion is the opponent's color, bottom is the player's color.
	 *
	 * topIsBlack: true when orientation='white' (black on top, white on bottom)
	 */
	const topIsBlack = $derived(orientation === 'white');

	/** Height of the top portion. */
	const topPct = $derived(topIsBlack ? 100 - whitePct : whitePct);

	/** Label goes on whichever side has the advantage. */
	const labelOnTop = $derived(topIsBlack ? !whiteAdvantage : whiteAdvantage);
</script>

<div class="eval-bar" role="img" aria-label={describeEval(evalCp, evalMate)}>
	<div
		aria-hidden="true"
		class="eval-bar-top"
		class:is-white={!topIsBlack}
		class:is-black={topIsBlack}
		style="height: {topPct}%"
	>
		{#if evalText && labelOnTop}
			<span class="eval-label">{evalText}</span>
		{/if}
	</div>

	<div
		aria-hidden="true"
		class="eval-bar-bottom"
		class:is-white={topIsBlack}
		class:is-black={!topIsBlack}
		style="height: {100 - topPct}%"
	>
		{#if evalText && !labelOnTop}
			<span class="eval-label">{evalText}</span>
		{/if}
	</div>
</div>

<style>
	.eval-bar {
		width: 28px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-radius: 0;
		overflow: hidden;
		border: 1px solid var(--clr-border, #ccc);
	}

	.eval-bar-top,
	.eval-bar-bottom {
		display: flex;
		align-items: center;
		justify-content: center;
		transition: height 0.4s ease;
		overflow: hidden;
	}

	.is-white {
		background: #d4d4d4;
	}

	.is-black {
		background: #262626;
	}

	.eval-label {
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1;
		writing-mode: vertical-rl;
		text-orientation: mixed;
		transform: rotate(180deg);
		white-space: nowrap;
		user-select: none;
	}

	.is-white .eval-label {
		color: #262626;
	}

	.is-black .eval-label {
		color: #d4d4d4;
	}
</style>
