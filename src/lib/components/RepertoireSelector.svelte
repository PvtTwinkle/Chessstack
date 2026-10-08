<!--
	RepertoireSelector.svelte
	─────────────────────────
	A compact button in the nav bar showing the active repertoire.
	Clicking it opens a dropdown listing all repertoires to switch between.

	The "Manage repertoires" option opens ManageRepertoireModal for
	creating, renaming, and deleting repertoires.

	After any change (create / rename / delete / switch) this component calls
	invalidateAll() from SvelteKit. That re-runs the layout's load function,
	which re-fetches the repertoire list from the database, and Svelte re-renders
	the nav with fresh data — without a full page reload.
-->

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { manageRepertoiresOpen } from '$lib/stores/manageRepertoires';

	// The shape of one repertoire row as returned by the server.
	interface Repertoire {
		id: number;
		userId: number;
		name: string;
		color: string; // "WHITE" or "BLACK"
		createdAt: Date | string | number;
	}

	let {
		repertoires = [],
		activeRepertoireId = null,
		lockedRepertoireIds = []
	}: {
		repertoires: Repertoire[];
		activeRepertoireId: number | null;
		lockedRepertoireIds: number[];
	} = $props();

	// Only show unlocked repertoires in the switcher dropdown.
	// Locked ones are accessible via the Manage modal for export/delete.
	const lockedSet = $derived(new Set(lockedRepertoireIds));
	const selectableRepertoires = $derived(repertoires.filter((r) => !lockedSet.has(r.id)));

	// ── UI state ────────────────────────────────────────────────────────────────
	let dropdownOpen = $state(false);

	// ── Request-in-flight guard (prevents double-clicks) ────────────────────────
	let busy = $state(false);

	// Derived: the repertoire object that is currently active (or null if none).
	const active = $derived(repertoires.find((r) => r.id === activeRepertoireId) ?? null);

	// CSS class for the color dot indicator.
	function colorDotClass(color: string): string {
		return color === 'WHITE' ? 'color-dot color-dot--white' : 'color-dot color-dot--black';
	}

	// ── Switch active repertoire ─────────────────────────────────────────────────
	async function switchTo(id: number) {
		if (busy || id === activeRepertoireId) {
			dropdownOpen = false;
			return;
		}
		busy = true;
		dropdownOpen = false;
		try {
			const res = await fetch('/api/repertoires/active', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!res.ok) {
				dropdownOpen = true;
				return;
			}
			await invalidateAll();
		} catch {
			// Re-open dropdown so the user sees their selection didn't stick.
			dropdownOpen = true;
		} finally {
			busy = false;
		}
	}

	// Close the dropdown when the user clicks anywhere outside this component.
	function handleWindowClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.repertoire-selector')) {
			dropdownOpen = false;
		}
	}
</script>

<svelte:window onclick={handleWindowClick} />

<!-- ── Selector button + dropdown ──────────────────────────────────────────── -->
<div class="repertoire-selector">
	<button
		class="selector-btn"
		onclick={() => (dropdownOpen = !dropdownOpen)}
		aria-haspopup="listbox"
		aria-expanded={dropdownOpen}
		title="Switch repertoire"
	>
		{#if active}
			<span class="color-icon"><span class={colorDotClass(active.color)}></span></span>
			<span class="rep-name">{active.name}</span>
		{:else}
			<span class="no-rep">No repertoire</span>
		{/if}
		<span class="chevron" class:open={dropdownOpen}>▾</span>
	</button>

	{#if dropdownOpen}
		<div class="dropdown" role="listbox">
			{#each selectableRepertoires as rep (rep.id)}
				<button
					class="dropdown-item"
					class:is-active={rep.id === activeRepertoireId}
					role="option"
					aria-selected={rep.id === activeRepertoireId}
					onclick={() => switchTo(rep.id)}
				>
					<span class="color-icon"><span class={colorDotClass(rep.color)}></span></span>
					<span class="item-name">{rep.name}</span>
					{#if rep.id === activeRepertoireId}
						<span class="check">✓</span>
					{/if}
				</button>
			{/each}

			{#if lockedRepertoireIds.length > 0}
				<p class="dropdown-locked-hint">{lockedRepertoireIds.length} locked — manage to export</p>
			{/if}

			{#if selectableRepertoires.length === 0 && lockedRepertoireIds.length === 0}
				<p class="dropdown-empty">No repertoires yet</p>
			{/if}

			<div class="dropdown-divider"></div>

			<button
				class="dropdown-action"
				onclick={() => {
					dropdownOpen = false;
					manageRepertoiresOpen.set(true);
				}}
			>
				⚙ Manage repertoires
			</button>
		</div>
	{/if}
</div>

<!-- Modal is now rendered at the layout root level to avoid header stacking context. -->

<style>
	/* ── Selector button ────────────────────────────────────────────────────── */

	.repertoire-selector {
		position: relative;
	}

	.selector-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
		max-width: 220px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.selector-btn:hover {
		border-color: var(--color-accent-dim);
	}

	.rep-name {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}

	.no-rep {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.chevron {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		transition: transform var(--dur-fast) var(--ease-snap);
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	/* ── Dropdown panel ─────────────────────────────────────────────────────── */

	.dropdown {
		position: absolute;
		top: calc(100% + var(--space-1));
		left: 0;
		min-width: 210px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-1) 0;
		z-index: 1000;
		box-shadow: var(--shadow-elevated);
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.dropdown-item:hover {
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
	}

	.dropdown-item.is-active {
		color: var(--color-accent);
	}

	.item-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.check {
		color: var(--color-accent);
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.dropdown-empty {
		padding: var(--space-2) var(--space-3);
		color: var(--color-text-muted);
		font-size: 12px;
		margin: 0;
	}

	.dropdown-locked-hint {
		padding: var(--space-1) var(--space-3);
		color: var(--color-text-muted);
		font-size: 11px;
		font-style: italic;
		margin: 0;
	}

	.dropdown-divider {
		height: 1px;
		background: var(--color-border);
		margin: var(--space-1) 0;
	}

	.dropdown-action {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		text-align: left;
		transition:
			color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.dropdown-action:hover {
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
	}
</style>
