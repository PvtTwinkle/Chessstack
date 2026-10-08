<!--
	ModeToggle — Build / Explore switch at the top of the Build sidebar.

	Props:
	  exploreMode — true while exploring (moves are not saved)

	Events:
	  onToggle() — called when the user picks the mode that isn't active
-->

<script lang="ts">
	interface Props {
		exploreMode: boolean;
		onToggle: () => void;
	}

	let { exploreMode, onToggle }: Props = $props();
</script>

<div class="mode-toggle">
	<button
		class="mode-btn"
		class:mode-btn--active={!exploreMode}
		onclick={() => {
			if (exploreMode) onToggle();
		}}
	>
		Build
	</button>
	<button
		class="mode-btn"
		class:mode-btn--active={exploreMode}
		onclick={() => {
			if (!exploreMode) onToggle();
		}}
	>
		Explore
	</button>
</div>

<style>
	/* ── Mode toggle ────────────────────────────────────────────────────────── */

	.mode-toggle {
		display: flex;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.mode-btn {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.mode-btn:hover:not(.mode-btn--active) {
		color: var(--color-text-secondary);
		background: var(--color-surface-alt);
	}

	.mode-btn--active {
		background: var(--color-surface-alt);
		color: var(--color-accent);
		font-weight: 600;
		cursor: default;
		box-shadow: inset 0 -2px 0 var(--color-accent);
	}

	.mode-btn + .mode-btn {
		border-left: 1px solid var(--color-border);
	}
</style>
