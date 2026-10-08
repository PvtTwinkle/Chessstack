<!--
	ManageRepertoireModal.svelte
	────────────────────────────
	Full-screen modal overlay for creating, renaming, and deleting repertoires.
	Extracted from RepertoireSelector so each component has a single job.

	Props:
	  open      — two-way bound boolean that controls visibility
	  repertoires — the current list of repertoires (read-only, for display)
	  onchange  — callback fired after any successful create/rename/delete
	              so the parent can reload data (e.g. invalidateAll())
-->

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { downloadTextFile } from '$lib/download';
	import { TIER_LIMITS } from '$lib/stripe/tiers';
	import type { Tier } from '$lib/stripe/tiers';

	interface Repertoire {
		id: number;
		userId: number;
		name: string;
		color: string;
		createdAt: Date | string | number;
	}

	let {
		open = $bindable(false),
		repertoires = [],
		onchange = () => {},
		tier = 'free' as Tier,
		lockedRepertoireIds = []
	}: {
		open: boolean;
		repertoires: Repertoire[];
		onchange?: () => void;
		tier?: Tier;
		lockedRepertoireIds?: number[];
	} = $props();

	const lockedSet = $derived(new Set(lockedRepertoireIds));

	const atLimit = $derived(
		TIER_LIMITS[tier].maxRepertoires !== Infinity &&
			repertoires.length >= TIER_LIMITS[tier].maxRepertoires
	);

	// ── Create form state ────────────────────────────────────────────────────────
	let newName = $state('');
	let newColor = $state<'WHITE' | 'BLACK'>('WHITE');

	// ── Rename state (tracks which row is being edited inline) ───────────────────
	let editingId = $state<number | null>(null);
	let editingName = $state('');

	// ── Delete confirmation state ────────────────────────────────────────────────
	let confirmDeleteId = $state<number | null>(null);

	// ── Export state ─────────────────────────────────────────────────────────────
	let exportingId = $state<number | null>(null);
	let exportMsg = $state('');

	// ── Request-in-flight guard (prevents double-clicks) ────────────────────────
	let busy = $state(false);
	let errorMsg = $state('');

	// CSS class for the color dot indicator.
	function colorDotClass(color: string): string {
		return color === 'WHITE' ? 'color-dot color-dot--white' : 'color-dot color-dot--black';
	}

	// ── Create a new repertoire ──────────────────────────────────────────────────
	async function createRepertoire() {
		if (!newName.trim() || busy) return;
		busy = true;
		errorMsg = '';

		try {
			const res = await fetch('/api/repertoires', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName.trim(), color: newColor })
			});

			if (!res.ok) {
				errorMsg = 'Failed to create repertoire.';
				return;
			}

			const created: Repertoire = await res.json();
			// Automatically switch to the new repertoire — if you created it,
			// you almost certainly want to start using it immediately.
			await fetch('/api/repertoires/active', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: created.id })
			});
			newName = '';
			newColor = 'WHITE';

			await invalidateAll();
			onchange();
		} catch {
			errorMsg = 'Network error — could not create repertoire.';
		} finally {
			busy = false;
		}
	}

	// ── Start editing a repertoire name inline ───────────────────────────────────
	function startEdit(rep: Repertoire) {
		editingId = rep.id;
		editingName = rep.name;
		confirmDeleteId = null;
	}

	function cancelEdit() {
		editingId = null;
		editingName = '';
	}

	// ── Save a rename ────────────────────────────────────────────────────────────
	async function saveRename(id: number) {
		if (!editingName.trim() || busy) return;
		busy = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/repertoires/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: editingName.trim() })
			});

			if (!res.ok) {
				errorMsg = 'Failed to rename repertoire.';
				return;
			}

			editingId = null;
			editingName = '';
			await invalidateAll();
			onchange();
		} catch {
			errorMsg = 'Network error — could not rename repertoire.';
		} finally {
			busy = false;
		}
	}

	// ── Delete flow — ask first, confirm to proceed ──────────────────────────────
	function askDelete(id: number) {
		confirmDeleteId = id;
		editingId = null;
	}

	function cancelDelete() {
		confirmDeleteId = null;
	}

	async function confirmDelete(id: number) {
		if (busy) return;
		busy = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/repertoires/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				errorMsg = 'Failed to delete repertoire.';
				return;
			}

			confirmDeleteId = null;
			await invalidateAll();
			onchange();
		} catch {
			errorMsg = 'Network error — could not delete repertoire.';
		} finally {
			busy = false;
		}
	}

	// ── Export a repertoire as PGN ────────────────────────────────────────────────
	let exportMsgTimeout: ReturnType<typeof setTimeout> | undefined;

	async function handleExport(id: number) {
		if (exportingId) return;
		exportingId = id;
		exportMsg = '';
		try {
			const res = await fetch(`/api/repertoires/${id}/export`);
			if (!res.ok) throw new Error('Export failed');
			const { pgn, filename } = await res.json();
			downloadTextFile(pgn, filename);
			exportMsg = 'Downloaded!';
			clearTimeout(exportMsgTimeout);
			exportMsgTimeout = setTimeout(() => (exportMsg = ''), 2000);
		} catch {
			exportMsg = 'Export failed';
			clearTimeout(exportMsgTimeout);
			exportMsgTimeout = setTimeout(() => (exportMsg = ''), 3000);
		} finally {
			exportingId = null;
		}
	}

	onDestroy(() => {
		clearTimeout(exportMsgTimeout);
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="backdrop"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
	>
		<div class="modal" role="dialog" aria-modal="true" aria-label="Manage repertoires">
			<!-- Header -->
			<div class="modal-header">
				<h2>Manage Repertoires</h2>
				<button class="close-btn" onclick={() => (open = false)} aria-label="Close">✕</button>
			</div>

			<!-- Existing repertoires list -->
			<div class="rep-list">
				{#each repertoires as rep (rep.id)}
					<div class="rep-row">
						{#if confirmDeleteId === rep.id}
							<!-- Delete confirmation banner replaces the row content -->
							<div class="confirm-zone">
								<span class="confirm-msg">
									Delete "<strong>{rep.name}</strong>"? This removes all moves and review history.
								</span>
								<div class="confirm-actions">
									<button class="btn-danger" onclick={() => confirmDelete(rep.id)} disabled={busy}>
										Delete forever
									</button>
									<button class="btn-ghost" onclick={cancelDelete} disabled={busy}>Cancel</button>
								</div>
							</div>
						{:else if editingId === rep.id}
							<!-- Inline rename input replaces the name label -->
							<span class="row-icon"><span class={colorDotClass(rep.color)}></span></span>
							<input
								class="rename-input"
								type="text"
								bind:value={editingName}
								onkeydown={(e) => {
									if (e.key === 'Enter') saveRename(rep.id);
									if (e.key === 'Escape') cancelEdit();
								}}
							/>
							<div class="row-actions">
								<button class="btn-primary" onclick={() => saveRename(rep.id)} disabled={busy}>
									Save
								</button>
								<button class="btn-ghost" onclick={cancelEdit} disabled={busy}>Cancel</button>
							</div>
						{:else}
							<!-- Normal row -->
							<span class="row-icon"><span class={colorDotClass(rep.color)}></span></span>
							<span class="row-name">{rep.name}</span>
							{#if lockedSet.has(rep.id)}
								<span class="locked-badge">Read-only</span>
							{/if}
							<span
								class="color-badge"
								class:badge-white={rep.color === 'WHITE'}
								class:badge-black={rep.color === 'BLACK'}
							>
								{rep.color === 'WHITE' ? 'White' : 'Black'}
							</span>
							<div class="row-actions">
								<button
									class="btn-ghost"
									onclick={() => handleExport(rep.id)}
									disabled={exportingId === rep.id}
								>
									{exportingId === rep.id ? 'Exporting…' : 'Export'}
								</button>
								{#if !lockedSet.has(rep.id)}
									<button class="btn-ghost" onclick={() => startEdit(rep)}>Rename</button>
								{/if}
								<button class="btn-ghost btn-ghost--danger" onclick={() => askDelete(rep.id)}>
									Delete
								</button>
							</div>
						{/if}
					</div>
				{/each}

				{#if repertoires.length === 0}
					<p class="empty-hint">No repertoires yet — create one below.</p>
				{/if}
			</div>

			{#if lockedRepertoireIds.length > 0}
				<p class="upgrade-hint">
					<a href="/settings#subscription" onclick={() => (open = false)}>Upgrade</a> to unlock {lockedRepertoireIds.length}
					read-only repertoire{lockedRepertoireIds.length > 1 ? 's' : ''}.
				</p>
			{/if}

			{#if errorMsg}
				<p class="error-msg">{errorMsg}</p>
			{/if}

			{#if exportMsg}
				<p class="export-msg">{exportMsg}</p>
			{/if}

			<!-- Create new repertoire form -->
			<div class="create-section">
				<h3>Create New Repertoire</h3>

				{#if atLimit}
					<p class="upgrade-hint">
						<a href="/settings#subscription" onclick={() => (open = false)}>Upgrade</a> to create additional
						repertoires.
					</p>
				{:else}
					<div class="form-row">
						<input
							class="text-input"
							type="text"
							placeholder="e.g. White — e4 lines or Black vs d4"
							bind:value={newName}
							onkeydown={(e) => {
								if (e.key === 'Enter') createRepertoire();
							}}
						/>
					</div>

					<div class="color-row">
						<label class="color-label">
							<input type="radio" name="rep-color" value="WHITE" bind:group={newColor} />
							<span class="color-opt"><span class="color-dot color-dot--white"></span> White</span>
						</label>
						<label class="color-label">
							<input type="radio" name="rep-color" value="BLACK" bind:group={newColor} />
							<span class="color-opt"><span class="color-dot color-dot--black"></span> Black</span>
						</label>
					</div>

					<button
						class="btn-primary btn-create"
						onclick={createRepertoire}
						disabled={!newName.trim() || busy}
					>
						{busy ? 'Creating…' : 'Create Repertoire'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Modal backdrop + panel ─────────────────────────────────────────────── */

	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		justify-content: center;
		overflow-y: auto;
		z-index: 1000;
	}

	.modal {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: 540px;
		max-width: calc(100vw - var(--space-8));
		max-height: calc(100vh - var(--space-16));
		overflow-y: auto;
		padding: var(--space-6);
		box-shadow: var(--shadow-elevated);
		/* margin: auto centers vertically when shorter than viewport,
		   and scrolls naturally from the top when taller. */
		margin: auto;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-5);
	}

	.modal-header h2 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.1rem;
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 1rem;
		cursor: pointer;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		transition: color var(--dur-fast) var(--ease-snap);
		line-height: 1;
	}

	.close-btn:hover {
		color: var(--color-text-primary);
	}

	/* ── Repertoire list ────────────────────────────────────────────────────── */

	.rep-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-6);
	}

	.rep-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		min-height: 44px;
	}

	.row-icon {
		font-size: 1.1rem;
		flex-shrink: 0;
		line-height: 1;
	}

	.row-name {
		flex: 1;
		font-size: 0.9rem;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		flex-shrink: 0;
		font-size: 11px;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
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

	.locked-badge {
		flex-shrink: 0;
		font-size: 10px;
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: rgba(248, 113, 113, 0.1);
		color: var(--color-danger);
		border: 1px solid rgba(248, 113, 113, 0.2);
	}

	.row-actions {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	/* ── Confirm delete zone ────────────────────────────────────────────────── */

	.confirm-zone {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
	}

	.confirm-msg {
		font-size: 0.85rem;
		color: var(--color-danger);
		line-height: 1.4;
	}

	.confirm-actions {
		display: flex;
		gap: var(--space-2);
	}

	/* ── Rename input ───────────────────────────────────────────────────────── */

	.rename-input {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.875rem;
	}

	.rename-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	/* ── Empty state ────────────────────────────────────────────────────────── */

	.upgrade-hint {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		text-align: center;
		padding: var(--space-4);
		margin: 0;
	}

	.upgrade-hint a {
		color: var(--color-accent);
		text-decoration: underline;
	}

	.empty-hint {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		text-align: center;
		padding: var(--space-4);
		margin: 0;
	}

	/* ── Create section ─────────────────────────────────────────────────────── */

	.create-section {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-5);
	}

	.create-section h3 {
		margin: 0 0 var(--space-3);
		font-size: 11px;
		color: var(--color-text-muted);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.form-row {
		margin-bottom: var(--space-3);
	}

	.text-input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.9rem;
		box-sizing: border-box;
	}

	.text-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.color-row {
		display: flex;
		gap: var(--space-6);
		margin-bottom: var(--space-4);
	}

	.color-label {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		cursor: pointer;
		font-size: 0.9rem;
		color: var(--color-text-secondary);
	}

	.color-label input[type='radio'] {
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	.btn-create {
		width: 100%;
		padding: var(--space-3);
		font-size: 0.9rem;
	}

	/* ── Shared button styles ───────────────────────────────────────────────── */

	.btn-primary {
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-base);
		font-family: var(--font-body);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--dur-fast) var(--ease-snap);
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.88;
		box-shadow: var(--glow-accent);
	}

	.btn-primary:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.btn-ghost {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.btn-ghost:hover:not(:disabled) {
		border-color: var(--color-text-secondary);
		color: var(--color-text-primary);
	}

	.btn-ghost--danger:hover:not(:disabled) {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.btn-ghost:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.btn-danger {
		padding: var(--space-2) var(--space-3);
		background: rgba(248, 113, 113, 0.1);
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-danger);
		font-family: var(--font-body);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.btn-danger:hover:not(:disabled) {
		background: rgba(248, 113, 113, 0.2);
	}

	.btn-danger:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.error-msg {
		font-size: 0.8rem;
		color: var(--color-danger);
		text-align: center;
		margin: 0 0 var(--space-3);
	}

	.export-msg {
		font-size: 0.8rem;
		color: var(--color-success);
		text-align: center;
		margin: 0 0 var(--space-3);
	}

	/* ── Mobile touch targets ── --bp-md */
	@media (max-width: 767px) {
		.btn-ghost {
			min-height: 44px;
		}

		.btn-primary {
			min-height: 44px;
		}

		.btn-danger {
			min-height: 44px;
		}

		.close-btn {
			min-width: 44px;
			min-height: 44px;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.rep-row {
			flex-wrap: wrap;
		}

		.row-actions {
			width: 100%;
			justify-content: flex-end;
		}
	}

	/* ── Full-screen modal on narrow phones ── --bp-sm */
	@media (max-width: 479px) {
		.modal {
			position: fixed;
			inset: 0;
			width: 100%;
			max-width: 100%;
			max-height: 100%;
			border-radius: 0;
			padding-top: var(--space-8);
		}
	}
</style>
