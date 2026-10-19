<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { base, resolveRoute } from '$app/paths';
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import PrepDialog from '$lib/components/prep/PrepDialog.svelte';
	import { fetchErrorMessage, parseInWorker, postJson, uploadPrepMoves } from '$lib/prep/pipeline';

	let { data }: { data: PageData } = $props();

	// ── New Prep form state ──────────────────────────────────────────────
	let showForm = $state(false);
	let opponentUsername = $state('');
	let platform = $state<'LICHESS' | 'CHESSCOM'>('LICHESS');
	let timeWindow = $state('3m');
	let maxGames = $state(500);

	// ── Pipeline state ───────────────────────────────────────────────────
	let loading = $state(false);
	let statusMessage = $state('');
	let progressCompleted = $state(0);
	let progressTotal = $state(0);
	let errorMessage = $state('');

	// Stops a parse still running in the worker when the page is left.
	const leaving = new AbortController();
	onDestroy(() => leaving.abort());

	// ── Delete confirmation ──────────────────────────────────────────────
	let deletingId = $state<number | null>(null);
	const deletedIds = new SvelteSet<number>();
	const preps = $derived(data.preps.filter((p) => !deletedIds.has(p.id)));

	function resetForm() {
		showForm = false;
		opponentUsername = '';
		platform = 'LICHESS';
		timeWindow = '3m';
		loading = false;
		statusMessage = '';
		progressCompleted = 0;
		progressTotal = 0;
		errorMessage = '';
	}

	async function handleSubmit() {
		if (!opponentUsername.trim()) return;

		loading = true;
		errorMessage = '';
		statusMessage = 'Fetching games...';

		try {
			// Step 1: Fetch PGNs from server
			const fetchRes = await fetch(`${base}/api/prep/fetch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					opponentUsername: opponentUsername.trim(),
					platform,
					timeWindow,
					maxGames
				})
			});

			if (!fetchRes.ok) throw new Error(await fetchErrorMessage(fetchRes));

			const { pgns, gameCount, hasMore } = await fetchRes.json();

			if (gameCount === 0) {
				errorMessage = 'No games found for this user in the selected time window.';
				loading = false;
				statusMessage = '';
				return;
			}

			const moreNote = hasMore ? ` (capped at ${maxGames})` : '';
			statusMessage = `Downloaded ${gameCount} games${moreNote}. Parsing...`;

			// Step 2: Parse PGNs in Web Worker
			const result = await parseInWorker(
				pgns,
				opponentUsername.trim(),
				(completed, total) => {
					progressCompleted = completed;
					progressTotal = total;
					statusMessage = `Parsing games... ${completed}/${total}`;
				},
				leaving.signal
			);

			statusMessage = 'Saving prep...';

			// Step 3: Create the prep as a pending upload, then send its moves
			// and publish it in one step
			const prep = await postJson<{ id: number }>(
				`${base}/api/prep`,
				{
					opponentName: opponentUsername.trim(),
					platform,
					platformUsername: opponentUsername.trim(),
					timeWindow,
					gamesAsWhite: result.gamesAsWhite,
					gamesAsBlack: result.gamesAsBlack
				},
				'Save failed'
			);
			const prepId = await uploadPrepMoves(base, prep.id, result, timeWindow, (batch, total) => {
				statusMessage = `Saving moves... ${batch}/${total}`;
			});

			// Step 4: Navigate to the new prep
			await goto(resolveRoute('/prep/[id]', { id: String(prepId) }));
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			loading = false;
			statusMessage = '';
		}
	}

	async function deletePrep(id: number) {
		try {
			const res = await fetch(`${base}/api/prep/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Delete failed');
			// Hide it here rather than reload the page (or write to the data prop).
			deletedIds.add(id);
			deletingId = null;
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			deletingId = null;
		}
	}

	function formatDate(date: string | Date): string {
		return new Date(date).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function platformLabel(p: string): string {
		return p === 'LICHESS' ? 'Lichess' : 'Chess.com';
	}
</script>

<svelte:head>
	<title>Prep | Chessstack</title>
</svelte:head>

<div class="prep-page">
	<header class="prep-header">
		<h1>Opponent Prep</h1>
		{#if !showForm}
			<button class="new-prep-btn" onclick={() => (showForm = true)}>New Prep</button>
		{/if}
	</header>

	{#if showForm}
		<div class="prep-form-card">
			<h2>Prepare for an opponent</h2>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
			>
				<div class="form-field">
					<label for="opponentUsername">Opponent username</label>
					<input
						id="opponentUsername"
						type="text"
						bind:value={opponentUsername}
						placeholder="e.g. DrNykterstein"
						disabled={loading}
						maxlength={50}
					/>
				</div>

				<div class="form-row">
					<div class="form-field">
						<label for="platform">Platform</label>
						<select id="platform" bind:value={platform} disabled={loading}>
							<option value="LICHESS">Lichess</option>
							<option value="CHESSCOM">Chess.com</option>
						</select>
					</div>

					<div class="form-field">
						<label for="timeWindow">Time window</label>
						<select id="timeWindow" bind:value={timeWindow} disabled={loading}>
							<option value="1m">Last month</option>
							<option value="3m">Last 3 months</option>
							<option value="6m">Last 6 months</option>
							<option value="1y">Last year</option>
							<option value="all">All time</option>
						</select>
					</div>

					<div class="form-field">
						<label for="maxGames">Max games</label>
						<input
							id="maxGames"
							type="number"
							bind:value={maxGames}
							min={50}
							max={5000}
							step={50}
							disabled={loading}
						/>
					</div>
				</div>

				{#if loading}
					<div class="progress-section">
						<p class="status-text" role="status">{statusMessage}</p>
						{#if progressTotal > 0}
							<div class="progress-bar">
								<div
									class="progress-fill"
									style="width: {Math.round((progressCompleted / progressTotal) * 100)}%"
								></div>
							</div>
						{/if}
					</div>
				{/if}

				{#if errorMessage}
					<p class="error-text" role="alert">{errorMessage}</p>
				{/if}

				<div class="form-actions">
					<button type="submit" class="submit-btn" disabled={loading || !opponentUsername.trim()}>
						{loading ? 'Working...' : 'Fetch & Analyze'}
					</button>
					<button type="button" class="cancel-btn" onclick={resetForm} disabled={loading}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	{/if}

	{#if preps.length === 0 && !showForm}
		<div class="empty-state">
			<p>No opponent preps yet.</p>
			<p class="empty-hint">
				Create a prep to download an opponent's games and build targeted preparation.
			</p>
		</div>
	{:else}
		<div class="prep-grid">
			{#each preps as prep (prep.id)}
				<a class="prep-card" href="{base}/prep/{prep.id}">
					<div class="prep-card-header">
						<span class="opponent-name">{prep.opponentName}</span>
						<span class="platform-badge" class:lichess={prep.platform === 'LICHESS'}>
							{platformLabel(prep.platform)}
						</span>
					</div>
					<div class="prep-card-stats">
						<span>{prep.gamesAsWhite + prep.gamesAsBlack} games</span>
						<span class="stat-separator">&middot;</span>
						<span>{prep.gamesAsWhite}W / {prep.gamesAsBlack}B</span>
					</div>
					<div class="prep-card-footer">
						<span class="prep-date">Fetched {formatDate(prep.lastFetchedAt)}</span>
						<button
							class="delete-btn"
							onclick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								deletingId = prep.id;
							}}
							title="Delete prep"
							aria-label="Delete prep against {prep.opponentName}"
						>
							&times;
						</button>
					</div>
				</a>
			{/each}
		</div>
	{/if}

	{#if deletingId !== null}
		<PrepDialog title="Delete Prep" onClose={() => (deletingId = null)}>
			<div class="modal-content">
				<p>Delete this opponent prep and all associated moves? This cannot be undone.</p>
				<div class="modal-actions">
					<button class="delete-confirm-btn" onclick={() => deletePrep(deletingId!)}>
						Delete
					</button>
					<button class="cancel-btn" onclick={() => (deletingId = null)}>Cancel</button>
				</div>
			</div>
		</PrepDialog>
	{/if}
</div>

<style>
	.prep-page {
		max-width: 800px;
		margin: 0 auto;
		padding: var(--space-4);
	}

	.prep-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.prep-header h1 {
		font-size: 1.4rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.new-prep-btn {
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--dur-fast) var(--ease-snap);
	}

	.new-prep-btn:hover {
		opacity: 0.9;
	}

	/* ── Form ─────────────────────────────────────────────────────────── */

	.prep-form-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		margin-bottom: var(--space-4);
	}

	.prep-form-card h2 {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-3) 0;
	}

	.form-field {
		margin-bottom: var(--space-3);
	}

	.form-field label {
		display: block;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		margin-bottom: var(--space-1);
	}

	.form-field input,
	.form-field select {
		width: 100%;
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font-family: var(--font-body);
		font-size: 0.85rem;
		box-sizing: border-box;
	}

	.form-field input:focus,
	.form-field select:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.form-row {
		display: flex;
		gap: var(--space-3);
	}

	.form-row .form-field {
		flex: 1;
	}

	.form-actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	.submit-btn {
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cancel-btn {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-body);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.cancel-btn:hover {
		color: var(--color-text-secondary);
		border-color: var(--color-text-muted);
	}

	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Progress ─────────────────────────────────────────────────────── */

	.progress-section {
		margin: var(--space-3) 0;
	}

	.status-text {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-1) 0;
	}

	.progress-bar {
		height: 6px;
		background: var(--color-surface-alt);
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		border-radius: 3px;
		transition: width 0.2s ease-out;
	}

	.error-text {
		color: var(--color-eval-blunder);
		font-size: 0.8rem;
		margin: var(--space-2) 0;
	}

	/* ── Empty state ──────────────────────────────────────────────────── */

	.empty-state {
		text-align: center;
		padding: var(--space-8) var(--space-4);
		color: var(--color-text-muted);
	}

	.empty-state p {
		margin: 0;
	}

	.empty-hint {
		font-size: 0.85rem;
		margin-top: var(--space-2) !important;
	}

	/* ── Prep cards grid ──────────────────────────────────────────────── */

	.prep-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}

	.prep-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		text-decoration: none;
		color: inherit;
		transition: border-color var(--dur-fast) var(--ease-snap);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.prep-card:hover {
		border-color: var(--color-accent);
	}

	.prep-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.opponent-name {
		font-weight: 600;
		font-size: 1rem;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.platform-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.platform-badge.lichess {
		color: var(--color-text-primary);
	}

	.prep-card-stats {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}

	.stat-separator {
		margin: 0 var(--space-1);
	}

	.prep-card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.prep-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.delete-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0 var(--space-1);
		line-height: 1;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.delete-btn:hover {
		color: var(--color-eval-blunder);
	}

	/* ── Delete modal ─────────────────────────────────────────────────── */

	.modal-content p {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-3) 0;
	}

	.modal-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.delete-confirm-btn {
		background: var(--color-eval-blunder);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* ── Responsive ───────────────────────────────────────────────────── */

	@media (max-width: 479px) {
		.prep-page {
			padding: var(--space-2);
		}

		.form-row {
			flex-direction: column;
			gap: 0;
		}

		.prep-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
