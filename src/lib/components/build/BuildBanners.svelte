<!--
	BuildBanners — status messages under the Build / Explore toggle.

	In build mode: whose turn it is, and a warning when the user tries a second
	move where they already have one. In both modes: save errors, and a notice
	when the position transposes into a line that's already in the repertoire.

	Props:
	  s — the Build Mode state from createBuildState()
-->

<script lang="ts">
	import type { BuildState } from './buildState.svelte';

	let { s }: { s: BuildState } = $props();
</script>

{#if s.exploreMode}
	<div class="banner banner--explore">Explore mode — moves are not saved to repertoire</div>
{:else}
	<!-- Turn indicator -->
	<div class="turn-indicator" class:user-turn={s.isUserTurn} class:opp-turn={!s.isUserTurn}>
		<span class="turn-dot"></span>
		{#if s.isUserTurn}
			YOUR TURN <span class="turn-hint">— play a move on the board</span>
		{:else}
			OPPONENT'S TURN <span class="turn-hint">— play their move to add a response</span>
		{/if}
	</div>

	<!-- Conflict warning -->
	{#if s.conflictSan}
		<div class="banner banner--warn">
			You already have <strong>{s.conflictSan}</strong> here. Remove it first to change your move.
			<button class="banner-dismiss" aria-label="Dismiss" onclick={() => s.dismissConflict()}
				>✕</button
			>
		</div>
	{/if}
{/if}

<!-- Error message -->
{#if s.errorMsg}
	<div class="banner banner--error">
		{s.errorMsg}
		<button class="banner-dismiss" aria-label="Dismiss" onclick={() => s.dismissError()}>✕</button>
	</div>
{/if}

<!-- Transposition notice -->
{#if s.transpositionExists && !s.transpositionDismissed}
	<div class="banner banner--info">
		<strong>Transposition</strong> — this position is already in your repertoire via a different
		move order. Your existing preparation applies here.
		<button class="banner-dismiss" aria-label="Dismiss" onclick={() => s.dismissTransposition()}
			>✕</button
		>
	</div>
{/if}

<style>
	/* ── Turn indicator ──────────────────────────────────────────────────────── */

	.turn-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
	}

	.turn-indicator.user-turn {
		background: var(--color-accent-glow);
		border-color: rgba(91, 127, 164, 0.3);
		color: var(--color-accent);
	}

	.turn-indicator.opp-turn {
		background: rgba(139, 139, 160, 0.08);
		border-color: rgba(139, 139, 160, 0.2);
		color: var(--color-text-secondary);
	}

	.turn-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
		background: currentColor;
	}

	.turn-hint {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		opacity: 0.7;
	}

	/* ── Banners (conflict / error / info) ──────────────────────────────────── */

	.banner {
		position: relative;
		padding: var(--space-3) var(--space-8) var(--space-3) var(--space-3);
		border-radius: var(--radius-md);
		font-size: 12px;
		line-height: 1.5;
	}

	.banner--warn {
		background: rgba(91, 127, 164, 0.08);
		border: 1px solid rgba(91, 127, 164, 0.25);
		color: var(--color-accent);
	}

	.banner--error {
		background: rgba(248, 113, 113, 0.08);
		border: 1px solid rgba(248, 113, 113, 0.25);
		color: var(--color-danger);
	}

	.banner--info {
		background: rgba(139, 139, 160, 0.08);
		border: 1px solid rgba(139, 139, 160, 0.2);
		color: var(--color-text-secondary);
	}

	.banner--explore {
		background: var(--color-explore-glow);
		border: 1px solid rgba(103, 232, 249, 0.3);
		color: var(--color-explore);
		font-weight: 500;
	}

	.banner-dismiss {
		position: absolute;
		top: 50%;
		right: var(--space-2);
		transform: translateY(-50%);
		background: none;
		border: none;
		color: currentColor;
		opacity: 0.5;
		cursor: pointer;
		font-size: 12px;
		padding: 2px 4px;
		line-height: 1;
	}

	.banner-dismiss:hover {
		opacity: 1;
	}
</style>
