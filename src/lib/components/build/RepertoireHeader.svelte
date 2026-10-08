<!--
	RepertoireHeader — the Build sidebar's top row.

	Shows the repertoire's name and colour, plus a "⋯" overflow menu with
	Import PGN and Export PGN (hidden in explore mode). After an export the
	menu offers Download .pgn and Copy to clipboard.

	Props:
	  name, color — the repertoire being edited
	  showMenu — false hides the overflow menu (explore mode)
	  pgnExport — export state from createPgnExport()

	Events:
	  onImport() — called when the user picks Import PGN
-->

<script lang="ts">
	import type { PgnExport } from './buildExport.svelte';

	interface Props {
		name: string;
		color: string;
		showMenu: boolean;
		pgnExport: PgnExport;
		onImport: () => void;
	}

	let { name, color, showMenu, pgnExport, onImport }: Props = $props();

	let overflowOpen = $state(false);
</script>

<svelte:window
	onclick={(e) => {
		if (overflowOpen && !(e.target as HTMLElement).closest('.overflow-wrap')) {
			overflowOpen = false;
		}
	}}
/>

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
	{#if showMenu}
		<div class="overflow-wrap">
			<button
				class="overflow-btn"
				onclick={() => (overflowOpen = !overflowOpen)}
				aria-label="More actions"
				title="Import / Export PGN"
			>
				⋯
			</button>
			{#if overflowOpen}
				<div class="overflow-menu">
					<button
						class="overflow-item"
						onclick={() => {
							overflowOpen = false;
							onImport();
						}}
					>
						Import PGN
					</button>
					<button
						class="overflow-item"
						onclick={() => {
							pgnExport.exportPgn();
						}}
						disabled={pgnExport.exporting}
					>
						{pgnExport.exporting ? 'Exporting…' : 'Export PGN'}
					</button>
					{#if pgnExport.ready}
						<button class="overflow-item" onclick={pgnExport.download}>Download .pgn</button>
						<button class="overflow-item" onclick={pgnExport.copy}>Copy to clipboard</button>
					{/if}
				</div>
			{/if}
			{#if pgnExport.message}
				<span class="export-msg">{pgnExport.message}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ── Repertoire header ───────────────────────────────────────────────────── */

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
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 10px;
		padding: 2px var(--space-2);
		border-radius: 3px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		flex-shrink: 0;
	}

	.badge-white {
		background: var(--color-surface-alt);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.badge-black {
		background: var(--color-base);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	/* ── Overflow menu (Import / Export PGN) ────────────────────────────── */

	.overflow-wrap {
		position: relative;
		flex-shrink: 0;
	}

	.overflow-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 2px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.overflow-btn:hover {
		border-color: var(--color-accent-dim);
		color: var(--color-accent);
	}

	.overflow-menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		z-index: 20;
		min-width: 160px;
		box-shadow: var(--shadow-elevated);
	}

	.overflow-item {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		text-align: left;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.overflow-item:last-child {
		border-bottom: none;
	}

	.overflow-item:hover {
		background: var(--color-surface-alt);
		color: var(--color-accent);
	}

	.overflow-item:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.export-msg {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		font-size: 11px;
		color: var(--color-success);
		white-space: nowrap;
	}
</style>
