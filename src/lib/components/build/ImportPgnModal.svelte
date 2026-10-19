<!--
	ImportPgnModal.svelte
	─────────────────────
	Multi-step modal for importing PGN with variations into a repertoire.

	Steps:
	  1. Input   — paste PGN or upload .pgn file
	  2. Preview — show what will be imported, resolve conflicts
	  3. Importing — spinner while batch insert runs
	  4. Done    — summary of what was imported

	Props:
	  open             — two-way bound boolean controlling visibility
	  repertoireId     — which repertoire to import into
	  repertoireColor  — 'WHITE' | 'BLACK' (for display context)
	  onComplete       — callback after successful import (triggers data reload)
-->

<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { ImportPreview } from '$lib/pgn/detectConflicts';
	import {
		buildImportRequest,
		openConflicts,
		sendImportInChunks,
		type ImportCounts
	} from '$lib/pgn/resolveImport';
	import ImportConflict from './ImportConflict.svelte';
	import { PGN_MAX_BYTES } from '$lib/validation-limits';

	let {
		open = $bindable(false),
		repertoireId,
		repertoireColor,
		onComplete = () => {}
	}: {
		open: boolean;
		repertoireId: number;
		repertoireColor: 'WHITE' | 'BLACK';
		onComplete?: () => void;
	} = $props();

	// ── State machine ────────────────────────────────────────────────────────

	type Step = 'input' | 'preview' | 'importing' | 'done';
	let step = $state<Step>('input');

	// ── Input state ──────────────────────────────────────────────────────────

	let pgnText = $state('');
	let parsing = $state(false);
	let parseError = $state('');

	// ── Preview state ────────────────────────────────────────────────────────

	let preview = $state<ImportPreview | null>(null);
	let resolvedConflicts = new SvelteMap<string, string>();

	// ── Result state ─────────────────────────────────────────────────────────

	let result = $state<{ inserted: number; replaced: number; skipped: number } | null>(null);
	let importError = $state('');

	// ── Derived ──────────────────────────────────────────────────────────────

	// Conflicts inside a line the user already turned down aren't asked about.
	const pending = $derived(preview ? openConflicts(preview, resolvedConflicts) : []);
	const unresolvedCount = $derived(pending.length);
	const currentConflict = $derived(pending[0] ?? null);
	const request = $derived(preview ? buildImportRequest(preview, resolvedConflicts) : null);

	const totalNewMoves = $derived(
		preview ? preview.newUserMoves.length + preview.newOpponentMoves.length : 0
	);

	// ── Close / reset ────────────────────────────────────────────────────────

	function close() {
		open = false;
		// Reset state for next open
		step = 'input';
		pgnText = '';
		parsing = false;
		parseError = '';
		preview = null;
		resolvedConflicts.clear();
		result = null;
		importError = '';
	}

	// ── File upload ──────────────────────────────────────────────────────────

	// The server's limit (schemas/import.ts).
	const MAX_PGN_SIZE = PGN_MAX_BYTES;

	function handleFileUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (file.size > MAX_PGN_SIZE) {
			parseError = 'File is too large — maximum size is 1 MB';
			input.value = '';
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			pgnText = reader.result as string;
		};
		reader.readAsText(file);

		// Reset input so the same file can be re-selected
		input.value = '';
	}

	// ── Parse ────────────────────────────────────────────────────────────────

	async function handleParse() {
		if (!pgnText.trim() || parsing) return;
		if (pgnText.length > MAX_PGN_SIZE) {
			parseError = 'PGN is too large — maximum size is 1 MB';
			return;
		}
		parsing = true;
		parseError = '';

		try {
			const res = await fetch('/api/import/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, pgn: pgnText })
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Parse failed' }));
				parseError = data.message || `Parse failed (${res.status})`;
				return;
			}

			preview = await res.json();
			resolvedConflicts.clear();

			// If no conflicts, go straight to preview summary
			step = 'preview';
		} catch (e) {
			parseError = e instanceof Error ? e.message : 'Network error';
		} finally {
			parsing = false;
		}
	}

	// ── Execute import ───────────────────────────────────────────────────────

	async function handleImport() {
		if (!preview || !request) return;
		step = 'importing';
		importError = '';

		// New moves and the resolved conflicts, minus anything in a line the user turned down.
		const { moves, replacements } = request;

		if (moves.length === 0) {
			step = 'done';
			result = { inserted: 0, replaced: 0, skipped: 0 };
			return;
		}

		try {
			// Sent in chunks so a big file stays under the request size limit.
			// Each move saves idempotently, so a retry after a failed chunk
			// just skips what the earlier chunks saved.
			result = await sendImportInChunks({ moves, replacements }, async (chunk) => {
				const res = await fetch('/api/import/execute', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ repertoireId, ...chunk })
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({ message: 'Import failed' }));
					throw new Error(data.message || `Import failed (${res.status})`);
				}
				return (await res.json()) as ImportCounts;
			});
			step = 'done';
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Network error';
			step = 'preview'; // go back to preview so user can retry
		}
	}

	// ── Done ─────────────────────────────────────────────────────────────────

	function handleDone() {
		onComplete();
		close();
	}
</script>

<!-- Can't be dismissed mid-import, so the result isn't lost. -->
<Modal
	bind:open
	title="Import PGN"
	width="600px"
	dismissible={step !== 'importing'}
	onclose={close}
>
	<!-- ── Step: Input ────────────────────────────────────────── -->
	{#if step === 'input'}
		<div class="step-input">
			<p class="hint">
				Paste a PGN with variations to import moves into your
				{repertoireColor === 'WHITE' ? 'White' : 'Black'} repertoire.
			</p>

			<textarea
				class="pgn-textarea"
				bind:value={pgnText}
				placeholder="1. d4 Nf6 2. Nc3 d5 3. Bf4 ..."
				rows="10"></textarea>

			<div class="input-actions">
				<label class="file-label">
					<input type="file" accept=".pgn,.txt" onchange={handleFileUpload} class="file-input" />
					Upload .pgn
				</label>

				<button
					class="modal-btn modal-btn--primary"
					onclick={handleParse}
					disabled={!pgnText.trim() || parsing}
				>
					{parsing ? 'Parsing...' : 'Parse & Preview'}
				</button>
			</div>

			{#if parseError}
				<p class="modal-error" role="alert">{parseError}</p>
			{/if}
		</div>

		<!-- ── Step: Preview ──────────────────────────────────────── -->
	{:else if step === 'preview'}
		{#if preview}
			<div class="step-preview">
				<!-- Summary stats -->
				<div class="stats">
					<div class="stat">
						<span class="stat-value">{preview.newUserMoves.length}</span>
						<span class="stat-label">your moves</span>
					</div>
					<div class="stat">
						<span class="stat-value">{preview.newOpponentMoves.length}</span>
						<span class="stat-label">opponent responses</span>
					</div>
					<div class="stat">
						<span class="stat-value">{preview.duplicates}</span>
						<span class="stat-label">already saved</span>
					</div>
					{#if preview.conflicts.length > 0}
						<div class="stat stat--warn">
							<span class="stat-value">{preview.conflicts.length}</span>
							<span class="stat-label">conflicts</span>
						</div>
					{/if}
				</div>

				<!-- Parse warnings -->
				{#if preview.parseErrors.length > 0}
					<div class="warnings">
						<p class="warnings-label">{preview.parseErrors.length} move(s) skipped:</p>
						{#each preview.parseErrors as err, i (i)}
							<p class="warning-item">{err}</p>
						{/each}
					</div>
				{/if}

				<!-- Import error from previous attempt -->
				{#if importError}
					<p class="modal-error" role="alert">{importError}</p>
				{/if}

				<!-- Conflict resolution -->
				{#if unresolvedCount > 0}
					<div class="conflict-section">
						<h3>
							Choose your move ({unresolvedCount} left)
						</h3>

						{#if currentConflict}
							<ImportConflict
								conflict={currentConflict}
								{repertoireColor}
								newLabel="PGN"
								internalNote="PGN has multiple options"
								onChoose={(san) => resolvedConflicts.set(currentConflict!.fromFen, san)}
							/>
						{/if}
					</div>
				{/if}

				<!-- Action buttons -->
				<div class="preview-actions">
					<button
						class="modal-btn modal-btn--cancel"
						onclick={() => {
							step = 'input';
						}}
					>
						Back
					</button>

					{#if totalNewMoves === 0 && preview.conflicts.length === 0}
						<p class="nothing-hint">Nothing to import — all moves already saved.</p>
					{:else}
						<button
							class="modal-btn modal-btn--primary"
							onclick={handleImport}
							disabled={unresolvedCount > 0}
						>
							{unresolvedCount > 0
								? `Resolve ${unresolvedCount} conflict${unresolvedCount > 1 ? 's' : ''}`
								: `Import ${request?.moves.length ?? 0} move${request?.moves.length !== 1 ? 's' : ''}`}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<!-- ── Step: Importing ────────────────────────────────────── -->
	{:else if step === 'importing'}
		<div class="step-importing">
			<div class="spinner"></div>
			<p>Importing moves...</p>
		</div>

		<!-- ── Step: Done ─────────────────────────────────────────── -->
	{:else if step === 'done'}
		<div class="step-done">
			{#if result}
				<h3>Import complete</h3>
				<div class="result-stats">
					{#if result.inserted > 0}
						<p>{result.inserted} move{result.inserted !== 1 ? 's' : ''} added</p>
					{/if}
					{#if result.replaced > 0}
						<p>{result.replaced} move{result.replaced !== 1 ? 's' : ''} replaced</p>
					{/if}
					{#if result.skipped > 0}
						<p>{result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped</p>
					{/if}
					{#if result.inserted === 0 && result.replaced === 0}
						<p>No changes made — all moves were already in your repertoire.</p>
					{/if}
				</div>
			{/if}

			<button class="modal-btn modal-btn--primary" onclick={handleDone}>Done</button>
		</div>
	{/if}
</Modal>

<style>
	/* ── Step: Input ──────────────────────────────────────────────────────── */

	.hint {
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		margin: 0 0 var(--space-3);
		line-height: 1.4;
	}

	.pgn-textarea {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.825rem;
		resize: vertical;
		box-sizing: border-box;
		line-height: 1.5;
	}

	.pgn-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.input-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-3);
		gap: var(--space-3);
	}

	.file-label {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			border-color var(--dur-fast),
			color var(--dur-fast);
	}

	.file-label:hover {
		border-color: var(--color-text-secondary);
		color: var(--color-text-primary);
	}

	.file-input {
		display: none;
	}

	/* ── Step: Preview ────────────────────────────────────────────────────── */

	.stats {
		display: flex;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
		flex-wrap: wrap;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		flex: 1;
		min-width: 80px;
	}

	.stat--warn {
		border-color: var(--color-accent-dim);
		background: var(--color-accent-glow);
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat--warn .stat-value {
		color: var(--color-accent);
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.warnings {
		padding: var(--space-2) var(--space-3);
		background: var(--color-accent-glow);
		border: 1px solid var(--color-accent-dim);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-4);
	}

	.warnings-label {
		margin: 0 0 var(--space-1);
		font-size: 0.8rem;
		color: var(--color-accent);
		font-weight: 600;
	}

	.warning-item {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		line-height: 1.4;
	}

	/* ── Conflict resolution ──────────────────────────────────────────────── */

	.conflict-section {
		margin-bottom: var(--space-4);
	}

	.conflict-section h3 {
		margin: 0 0 var(--space-3);
		font-size: 0.85rem;
		color: var(--color-accent);
		font-weight: 600;
	}

	/* ── Preview actions ──────────────────────────────────────────────────── */

	.preview-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.nothing-hint {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin: 0;
	}

	/* ── Step: Importing ──────────────────────────────────────────────────── */

	.step-importing {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-8) 0;
		color: var(--color-text-secondary);
		font-size: 0.9rem;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Step: Done ───────────────────────────────────────────────────────── */

	.step-done {
		text-align: center;
		padding: var(--space-4) 0;
	}

	.step-done h3 {
		margin: 0 0 var(--space-4);
		font-size: 1rem;
		color: var(--color-success);
		font-weight: 600;
	}

	.result-stats {
		margin-bottom: var(--space-5);
	}

	.result-stats p {
		margin: var(--space-1) 0;
		font-size: 0.9rem;
		color: var(--color-text-secondary);
	}
</style>
