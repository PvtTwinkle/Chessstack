<!--
	Drill → repertoire name and colour, with the sound and blindfold toggles.
-->
<script lang="ts">
	import type { DrillState } from './drillState.svelte';

	let { drill, name, color }: { drill: DrillState; name: string; color: string } = $props();
</script>

<div class="rep-header">
	<span class="rep-icon"
		><span class="color-dot {color === 'WHITE' ? 'color-dot--white' : 'color-dot--black'}"
		></span></span
	>
	<span class="rep-name">{name}</span>
	<span
		class="color-badge"
		class:badge-white={color === 'WHITE'}
		class:badge-black={color === 'BLACK'}
	>
		{color === 'WHITE' ? 'White' : 'Black'}
	</span>
	<button
		class="mute-btn"
		class:muted={!drill.soundEnabled}
		onclick={drill.toggleSound}
		title={drill.soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
		aria-label={drill.soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
	>
		{drill.soundEnabled ? '🔊' : '🔇'}
	</button>
	<button
		class="mute-btn"
		class:muted={drill.blindfoldEnabled}
		onclick={drill.toggleBlindfold}
		title={drill.blindfoldEnabled ? 'Disable blindfold' : 'Enable blindfold'}
		aria-label={drill.blindfoldEnabled ? 'Disable blindfold' : 'Enable blindfold'}
	>
		{drill.blindfoldEnabled ? '🙈' : '👁️'}
	</button>
</div>

<style>
	.rep-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.rep-icon {
		font-size: 1.2rem;
		line-height: 1;
	}

	.rep-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text-primary);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-sm);
		font-family: var(--font-body);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		flex-shrink: 0;
	}

	.badge-white {
		background: var(--color-surface);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.badge-black {
		background: var(--color-base);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	/* ── Mute toggle button ───────────────────────────────────────────────────── */

	.mute-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0.1rem var(--space-1);
		border-radius: var(--radius-sm);
		opacity: 0.6;
		transition: opacity var(--dur-fast) var(--ease-snap);
		flex-shrink: 0;
	}

	.mute-btn:hover {
		opacity: 1;
	}

	.mute-btn.muted {
		opacity: 0.35;
	}
</style>
