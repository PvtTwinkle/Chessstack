<script lang="ts">
	import type { PageData } from './$types';
	import { base } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import { saveBoardSize } from '$lib/settings-client';
	import CandidateMoves from '$lib/components/CandidateMoves.svelte';
	import PrepDashboard from '$lib/components/prep/PrepDashboard.svelte';
	import PrepMovePanel from '$lib/components/prep/PrepMovePanel.svelte';
	import MoveTree from '$lib/components/build/MoveTree.svelte';
	import { createPrepState, type PrepMoveRow } from '$lib/components/prep/prepState.svelte';
	import PrepDialog from '$lib/components/prep/PrepDialog.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { onDestroy } from 'svelte';
	import { fetchErrorMessage, parseInWorker, postJson, uploadPrepMoves } from '$lib/prep/pipeline';

	let { data }: { data: PageData } = $props();

	const s = createPrepState({
		getPrepId: () => data.prep.id,
		getBaseUrl: () => base
	});

	/** The saved hidden moves; a damaged value hides nothing rather than breaking the page. */
	function parseExcluded(raw: string | null): string[] {
		if (!raw) return [];
		try {
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
		} catch {
			return [];
		}
	}

	// Sync state when page data loads
	$effect(() => {
		const excluded = parseExcluded(data.prep.excludedMoves);
		s.syncFromData(
			data.opponentMoves,
			data.prepMoves,
			data.repertoireCoverage,
			data.prep.minGames ?? 2,
			excluded
		);
	});

	// Board theme from layout data
	let boardTheme = $derived(data.settings?.boardTheme ?? 'blue');

	// ── Keyboard navigation ─────────────────────────────────────────────
	// Tracks which move is highlighted when cycling with Up/Down arrows.
	let highlightedIdx = $state<number | null>(null);

	// Reset highlight when position changes
	$effect(() => {
		// Reference currentFen to trigger on position change
		s.currentFen; // eslint-disable-line @typescript-eslint/no-unused-expressions
		highlightedIdx = null;
	});

	/** Get the list of moves available for cycling at the current position. */
	function getCyclableMoves(): { san: string; fen?: string }[] {
		if (!s.isUserTurn) {
			// Opponent's turn: cycle opponent moves
			return s.opponentMovesAtPosition.map((m) => ({ san: m.moveSan, fen: m.resultingFen }));
		}
		// User's turn: cycle prep moves first, then suggestions
		if (s.prepMovesAtPosition.length > 0) {
			return s.prepMovesAtPosition.map((m) => ({ san: m.san }));
		}
		return s.suggestionsAtPosition.map((m) => ({ san: m.moveSan, fen: m.resultingFen }));
	}

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		const tag = target?.tagName;
		if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
		// The board behind an open dialog doesn't move.
		if (target?.closest('dialog')) return;

		const moves = getCyclableMoves();

		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				s.handleUndo();
				break;

			case 'ArrowRight': {
				e.preventDefault();
				// Play the highlighted move, or the first one if nothing highlighted
				const idx = highlightedIdx ?? 0;
				const move = moves[idx];
				if (!move) break;
				if (!s.isUserTurn && move.fen) {
					s.clickOpponentMove(move.san, move.fen);
				} else {
					s.handleCandidateSelect(move.san);
				}
				break;
			}

			case 'ArrowDown':
				e.preventDefault();
				if (moves.length > 0) {
					highlightedIdx =
						highlightedIdx === null ? 0 : Math.min(highlightedIdx + 1, moves.length - 1);
				}
				break;

			case 'ArrowUp':
				e.preventDefault();
				if (moves.length > 0) {
					highlightedIdx =
						highlightedIdx === null ? moves.length - 1 : Math.max(highlightedIdx - 1, 0);
				}
				break;

			case 'Home':
				e.preventDefault();
				s.handleReset();
				break;
		}
	}

	// A filter change waiting to be saved goes out when the page is left.
	onDestroy(() => void s.flushFilters());

	// ── Deleting a prep move ─────────────────────────────────────────────
	// Asks first when moves after it would go too.
	let pendingDelete = $state<{ move: PrepMoveRow; following: number } | null>(null);

	function requestDelete(move: PrepMoveRow) {
		const following = s.followingMoveCount(move.id);
		if (following === 0) s.deletePrepMove(move.id);
		else pendingDelete = { move, following };
	}

	function confirmDelete() {
		if (!pendingDelete) return;
		s.deletePrepMove(pendingDelete.move.id);
		pendingDelete = null;
	}

	// ── Refresh flow ─────────────────────────────────────────────────────
	// Stops a parse still running in the worker when the page is left.
	const leaving = new AbortController();
	onDestroy(() => leaving.abort());

	let showRefreshConfirm = $state(false);
	let refreshing = $state(false);
	let refreshStatus = $state('');
	// eslint-disable-next-line svelte/prefer-writable-derived
	let refreshTimeWindow = $state('3m');
	let refreshMaxGames = $state(500);

	$effect(() => {
		refreshTimeWindow = data.prep.timeWindow ?? '3m';
	});

	async function refreshGames() {
		refreshing = true;
		refreshStatus = 'Downloading games from platform...';

		try {
			// Step 1: Fetch PGNs using selected time window
			const fetchRes = await fetch(`${base}/api/prep/${data.prep.id}/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'fetch',
					timeWindow: refreshTimeWindow,
					maxGames: refreshMaxGames
				})
			});

			if (!fetchRes.ok) throw new Error(await fetchErrorMessage(fetchRes));
			const { pgns, gameCount, hasMore } = await fetchRes.json();

			if (gameCount === 0) {
				refreshStatus = 'No games found in the selected time window.';
				setTimeout(() => {
					refreshing = false;
					refreshStatus = '';
				}, 2000);
				return;
			}

			const moreNote = hasMore
				? ` (capped at ${refreshMaxGames} — increase the limit or narrow the time window)`
				: '';
			refreshStatus = `Downloaded ${gameCount} games${moreNote}. Parsing...`;

			// Step 2: Parse in worker
			const result = await parseInWorker(
				pgns,
				data.prep.platformUsername,
				(completed, total) => {
					refreshStatus = `Parsing... ${completed}/${total}`;
				},
				leaving.signal
			);

			refreshStatus = 'Saving data...';

			// Step 3: Upload the new moves beside the old ones; the commit swaps
			// them in, so a failure here leaves the current data as it is.
			const { uploadId } = await postJson<{ uploadId: number }>(
				`${base}/api/prep/${data.prep.id}/refresh`,
				{ mode: 'merge-start' },
				'Merge start failed'
			);
			await uploadPrepMoves(base, uploadId, result, refreshTimeWindow, (batch, total) => {
				refreshStatus = `Saving moves... ${batch}/${total}`;
			});

			// Reload page data
			await invalidateAll();
			refreshStatus = `Refreshed with ${gameCount} games.${hasMore ? ` Note: ${refreshMaxGames} game limit reached.` : ''}`;
			setTimeout(() => {
				refreshing = false;
				refreshStatus = '';
			}, 2000);
		} catch (e) {
			refreshStatus = `Error: ${e instanceof Error ? e.message : String(e)}`;
			setTimeout(() => {
				refreshing = false;
				refreshStatus = '';
			}, 3000);
		}
	}

	// ── Add to existing repertoire ───────────────────────────────────────
	let showAddModal = $state(false);
	let addTargetRepId = $state<number | null>(null);
	let addPreviewing = $state(false);
	let addExecuting = $state(false);
	let addPreview = $state<{
		newMoves: number;
		connectingMoves: number;
		duplicates: number;
		conflicts: { fromFen: string; existingMove: string; prepMove: string }[];
	} | null>(null);
	let addReplacements = new SvelteSet<string>();
	let addResult = $state<{ inserted: number; replaced: number; skipped: number } | null>(null);
	let addError = $state('');

	// Filter repertoires to match the active prep color
	let matchingRepertoires = $derived(
		(data.repertoires ?? []).filter(
			(r) => r.color === (s.activeColor === 'white' ? 'WHITE' : 'BLACK')
		)
	);

	async function previewAdd() {
		if (!addTargetRepId) return;
		addPreviewing = true;
		addError = '';
		addPreview = null;
		addReplacements.clear();

		try {
			const res = await fetch(`${base}/api/prep/${data.prep.id}/add-to-repertoire`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'preview',
					repertoireId: addTargetRepId,
					color: s.activeColor
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => null);
				throw new Error(err?.message || `Preview failed (${res.status})`);
			}
			addPreview = await res.json();
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			addPreviewing = false;
		}
	}

	function toggleReplacement(fromFen: string, san: string) {
		const key = `${fromFen}|${san}`;
		if (addReplacements.has(key)) addReplacements.delete(key);
		else addReplacements.add(key);
	}

	async function executeAdd() {
		if (!addTargetRepId || !addPreview) return;
		addExecuting = true;
		addError = '';

		const replacements = addPreview.conflicts
			.filter((c) => addReplacements.has(`${c.fromFen}|${c.prepMove}`))
			.map((c) => ({ fromFen: c.fromFen, san: c.prepMove }));

		try {
			const res = await fetch(`${base}/api/prep/${data.prep.id}/add-to-repertoire`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'execute',
					repertoireId: addTargetRepId,
					color: s.activeColor,
					replacements
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => null);
				throw new Error(err?.message || `Import failed (${res.status})`);
			}
			addResult = await res.json();
			showAddModal = false;
			await invalidateAll();
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			addExecuting = false;
		}
	}

	function resetAddModal() {
		showAddModal = false;
		addTargetRepId = null;
		addPreview = null;
		addReplacements.clear();
		addResult = null;
		addError = '';
	}

	// ── Export to repertoire ──────────────────────────────────────────────
	let showExportConfirm = $state(false);
	let exporting = $state(false);
	let exportResult = $state<{ name: string; id: number } | null>(null);
	let exportError = $state('');

	async function exportAsRepertoire() {
		exporting = true;
		exportError = '';

		try {
			const res = await fetch(`${base}/api/prep/${data.prep.id}/export`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ color: s.activeColor })
			});

			if (!res.ok) {
				const err = await res.json().catch(() => null);
				throw new Error(err?.message || `Export failed (${res.status})`);
			}

			const result = await res.json();
			exportResult = result;
			showExportConfirm = false;
			await invalidateAll();
		} catch (e) {
			exportError = e instanceof Error ? e.message : String(e);
		} finally {
			exporting = false;
		}
	}
</script>

<svelte:head>
	<title>Prep | Chessstack</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="prep-detail">
	{#if showExportConfirm}
		<PrepDialog
			title="Export as Repertoire"
			onClose={() => (showExportConfirm = false)}
			busy={exporting}
		>
			<div class="modal-content">
				<p>
					This will create a new repertoire
					<strong
						>"Prep vs {data.prep.opponentName} — {s.activeColor === 'white'
							? 'White'
							: 'Black'}"</strong
					>
					with your prep moves. You can then drill it like any other repertoire.
				</p>
				<div class="modal-actions">
					<button class="submit-btn" onclick={exportAsRepertoire} disabled={exporting}>
						{exporting ? 'Exporting...' : 'Export'}
					</button>
					<button
						class="cancel-btn"
						onclick={() => (showExportConfirm = false)}
						disabled={exporting}
					>
						Cancel
					</button>
				</div>
				{#if exportError}
					<p class="export-error" role="alert">{exportError}</p>
				{/if}
			</div>
		</PrepDialog>
	{/if}

	{#if showRefreshConfirm}
		<PrepDialog title="Refresh Games" onClose={() => (showRefreshConfirm = false)}>
			<div class="modal-content">
				<p>
					This will <strong>replace all existing opponent move data</strong> with a fresh analysis of
					games from the selected time window. Your prep moves will be kept.
				</p>
				<p>
					Currently: {data.prep.gamesAsWhite + data.prep.gamesAsBlack} games. Refreshing with: {refreshTimeWindow ===
					'all'
						? 'all time'
						: refreshTimeWindow} (max {refreshMaxGames}).
				</p>
				<div class="modal-actions">
					<button
						class="submit-btn"
						onclick={() => {
							showRefreshConfirm = false;
							refreshGames();
						}}
					>
						Refresh
					</button>
					<button class="cancel-btn" onclick={() => (showRefreshConfirm = false)}>Cancel</button>
				</div>
			</div>
		</PrepDialog>
	{/if}

	{#if pendingDelete}
		<PrepDialog title="Delete {pendingDelete.move.san}?" onClose={() => (pendingDelete = null)}>
			<div class="modal-content">
				<p>
					This removes <strong>{pendingDelete.move.san}</strong> and
					<strong>{pendingDelete.following}</strong> prep {pendingDelete.following === 1
						? 'move'
						: 'moves'} after it that no other line reaches.
				</p>
				<div class="modal-actions">
					<button class="submit-btn" onclick={confirmDelete}>Delete</button>
					<button class="cancel-btn" onclick={() => (pendingDelete = null)}>Cancel</button>
				</div>
			</div>
		</PrepDialog>
	{/if}

	{#if showAddModal}
		<PrepDialog title="Add to Existing Repertoire" onClose={resetAddModal} wide busy={addExecuting}>
			<div class="modal-content">
				{#if !addPreview}
					<p>Select a {s.activeColor} repertoire to add your prep moves to.</p>
					<div class="form-field">
						<select
							class="time-window-select"
							bind:value={addTargetRepId}
							aria-label="Repertoire to add to"
						>
							<option value={null}>Select a repertoire...</option>
							{#each matchingRepertoires as rep (rep.id)}
								<option value={rep.id}>{rep.name}</option>
							{/each}
						</select>
					</div>
					{#if addError}
						<p class="export-error" role="alert">{addError}</p>
					{/if}
					<div class="modal-actions">
						<button
							class="submit-btn"
							onclick={previewAdd}
							disabled={!addTargetRepId || addPreviewing}
						>
							{addPreviewing ? 'Checking...' : 'Preview'}
						</button>
						<button class="cancel-btn" onclick={resetAddModal}>Cancel</button>
					</div>
				{:else}
					<p>
						<strong>{addPreview.newMoves}</strong> new moves to add,
						<strong>{addPreview.duplicates}</strong> already exist.
					</p>

					{#if addPreview.conflicts.length > 0}
						<div class="conflicts-section">
							<h4>Conflicts ({addPreview.conflicts.length})</h4>
							<p class="section-hint">
								At these positions your repertoire has a different move. Choose which to keep.
							</p>
							{#each addPreview.conflicts as conflict, i (i)}
								<div class="conflict-row">
									<span class="conflict-pos">Position {i + 1}:</span>
									<button
										class="conflict-choice"
										class:selected={!addReplacements.has(
											`${conflict.fromFen}|${conflict.prepMove}`
										)}
										onclick={() => {
											addReplacements.delete(`${conflict.fromFen}|${conflict.prepMove}`);
										}}
									>
										{conflict.existingMove} <span class="conflict-tag">current</span>
									</button>
									<span class="conflict-vs">vs</span>
									<button
										class="conflict-choice"
										class:selected={addReplacements.has(`${conflict.fromFen}|${conflict.prepMove}`)}
										onclick={() => toggleReplacement(conflict.fromFen, conflict.prepMove)}
									>
										{conflict.prepMove} <span class="conflict-tag">prep</span>
									</button>
								</div>
							{/each}
						</div>
					{/if}

					{#if addError}
						<p class="export-error" role="alert">{addError}</p>
					{/if}
					<div class="modal-actions">
						<button class="submit-btn" onclick={executeAdd} disabled={addExecuting}>
							{addExecuting ? 'Adding...' : `Add ${addPreview.newMoves} moves`}
						</button>
						<button class="cancel-btn" onclick={resetAddModal} disabled={addExecuting}
							>Cancel</button
						>
					</div>
				{/if}
			</div>
		</PrepDialog>
	{/if}

	<!-- Three-column layout: Dashboard | Board | Move Panel -->
	<div class="prep-workspace">
		<div class="dashboard-col">
			<a href="{base}/prep" class="back-link">&larr; All Preps</a>
			<h1 class="opponent-name">{data.prep.opponentName}</h1>
			<div class="meta-line">
				<span class="platform-tag">
					{data.prep.platform === 'LICHESS' ? 'Lichess' : 'Chess.com'}
				</span>
				<span class="game-count">
					{data.prep.gamesAsWhite + data.prep.gamesAsBlack} games
				</span>
			</div>

			<button class="color-toggle" onclick={() => s.toggleColor()} title="Switch prep color">
				{s.activeColor === 'white' ? 'Prepping as White' : 'Prepping as Black'}
			</button>

			<PrepDashboard state={s} />

			<div class="filter-controls">
				<label class="filter-label">
					Min games
					<input
						class="filter-input"
						type="number"
						value={s.minGames}
						onchange={(e) => s.setMinGames(parseInt((e.target as HTMLInputElement).value) || 2)}
						min={1}
						max={100}
					/>
				</label>
				{#if s.excludedKeys.size > 0}
					<div class="excluded-badge">
						<span>{s.excludedKeys.size} move{s.excludedKeys.size === 1 ? '' : 's'} hidden</span>
						<button class="restore-all-btn" onclick={() => s.restoreAllMoves()}>
							Restore all
						</button>
					</div>
				{/if}
			</div>

			<div class="sidebar-actions">
				<div class="refresh-row">
					<select
						class="time-window-select"
						bind:value={refreshTimeWindow}
						disabled={refreshing}
						aria-label="Time window to refresh"
					>
						<option value="1m">1 month</option>
						<option value="3m">3 months</option>
						<option value="6m">6 months</option>
						<option value="1y">1 year</option>
						<option value="all">All time</option>
					</select>
					<input
						class="max-games-input"
						type="number"
						bind:value={refreshMaxGames}
						min={50}
						max={5000}
						step={50}
						disabled={refreshing}
						title="Max games to fetch"
						aria-label="Max games to fetch"
					/>
				</div>
				<button
					class="refresh-btn"
					onclick={() => (showRefreshConfirm = true)}
					disabled={refreshing}
				>
					{refreshing ? 'Refreshing...' : 'Refresh Games'}
				</button>
				{#if refreshStatus}
					<p class="refresh-status" role="status">{refreshStatus}</p>
				{/if}

				<button class="export-btn" onclick={() => (showExportConfirm = true)}>
					Export as Repertoire
				</button>
				{#if matchingRepertoires.length > 0}
					<button class="export-btn" onclick={() => (showAddModal = true)}>
						Add to Repertoire
					</button>
				{/if}

				{#if exportResult}
					<p class="export-success">
						Created "{exportResult.name}".
					</p>
				{/if}
				{#if exportError}
					<p class="export-error">{exportError}</p>
				{/if}
				{#if addResult}
					<p class="export-success">
						Added {addResult.inserted} moves ({addResult.replaced} replaced).
					</p>
				{/if}
			</div>
		</div>

		<div class="board-col">
			{#if s.conflictSan}
				<div class="conflict-banner">
					<span
						>You already have <strong>{s.conflictSan}</strong> at this position. Delete it first to play
						a different move.</span
					>
					<button class="dismiss-btn" onclick={() => s.dismissConflict()} aria-label="Dismiss"
						>&times;</button
					>
				</div>
			{/if}
			<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={saveBoardSize}>
				<ChessBoard
					fen={s.currentFen}
					orientation={s.activeColor}
					{boardTheme}
					interactive={!s.saving}
					lastMove={s.lastMove}
					onMove={s.handlePlayMove}
				/>
			</ResizableBoard>

			<!-- Navigation controls -->
			<div class="nav-controls">
				<button
					onclick={() => s.handleReset()}
					disabled={s.navHistory.length === 0}
					title="Reset"
					aria-label="Back to the start position"
				>
					&#x23EE;
				</button>
				<button
					onclick={() => s.handleUndo()}
					disabled={s.navHistory.length === 0}
					title="Back"
					aria-label="Take back one move"
				>
					&#x25C0;
				</button>
			</div>

			<!-- Current line display -->
			{#if s.movePairs.length > 0}
				<div class="current-line">
					{#each s.movePairs as [white, black], i (i)}
						<span class="move-number">{i + 1}.</span>
						<button class="line-move" onclick={() => s.navigateToHistoryIdx(i * 2)}>
							{white.san}
						</button>
						{#if black}
							<button class="line-move" onclick={() => s.navigateToHistoryIdx(i * 2 + 1)}>
								{black.san}
							</button>
						{/if}
					{/each}
				</div>
			{/if}

			{#if s.errorMsg}
				<div class="error-banner">
					<span>{s.errorMsg}</span>
					<button class="dismiss-btn" onclick={() => s.dismissError()} aria-label="Dismiss"
						>&times;</button
					>
				</div>
			{/if}

			<!-- Prep move tree -->
			<MoveTree
				moves={s.treeMoves}
				currentFen={s.currentFen}
				startFen={null}
				onNavigateToLine={s.navigateToLine}
			/>
		</div>

		<div class="panel-col">
			{#if s.isUserTurn && s.coverageAtPosition.length > 0}
				<div class="repertoire-section">
					<h3 class="panel-section-title">Your repertoire</h3>
					{#each s.coverageAtPosition as entry, idx (idx)}
						<button class="repertoire-move" onclick={() => s.handleCandidateSelect(entry.san)}>
							<span class="rep-move-san">{entry.san}</span>
							{#if entry.repertoireName}
								<span class="rep-move-badge">{entry.repertoireName}</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
			{#if s.isUserTurn}
				<CandidateMoves
					currentFen={s.currentFen}
					onSelectMove={s.handleCandidateSelect}
					onHoverMove={() => {}}
					disabled={s.saving}
					playerColor={s.activeColor === 'white' ? 'WHITE' : 'BLACK'}
					highlightedIndex={-1}
					onCandidatesChanged={() => {}}
					requestedTab={null}
					onTabChanged={() => {}}
					onEvalChanged={() => {}}
					playersRatingBracket={data.settings?.playersRatingBracket ?? 3}
					onPlayersSettingsChanged={() => {}}
					starsPlayerSlug={data.settings?.starsPlayerSlug ?? null}
					onStarsSettingsChanged={() => {}}
				/>
			{/if}
			<PrepMovePanel state={s} {highlightedIdx} onDeleteMove={requestDelete} />
		</div>
	</div>
</div>

<style>
	.prep-detail {
		max-width: 1400px;
		margin: 0 auto;
		padding: var(--space-2) var(--space-4);
	}

	/* ── Dashboard sidebar ────────────────────────────────────────────── */

	.back-link {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-decoration: none;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.back-link:hover {
		color: var(--color-text-secondary);
	}

	.opponent-name {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: var(--space-1) 0 0 0;
		line-height: 1.2;
	}

	.meta-line {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-top: var(--space-1);
	}

	.platform-tag {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		background: var(--color-surface-alt);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
	}

	.game-count {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.color-toggle {
		width: 100%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-primary);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-body);
		font-size: 0.75rem;
		cursor: pointer;
		margin-top: var(--space-2);
		margin-bottom: var(--space-2);
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.color-toggle:hover {
		border-color: var(--color-accent);
	}

	.filter-controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.filter-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.filter-input {
		width: 50px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-primary);
		border-radius: var(--radius-sm);
		padding: var(--space-1);
		font-family: var(--font-body);
		font-size: 0.75rem;
		text-align: center;
	}

	.excluded-badge {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
	}

	.restore-all-btn {
		background: none;
		border: none;
		color: var(--color-accent);
		font-family: var(--font-body);
		font-size: 0.7rem;
		cursor: pointer;
		padding: 0;
	}

	.restore-all-btn:hover {
		text-decoration: underline;
	}

	.sidebar-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}

	.refresh-row {
		display: flex;
		gap: var(--space-1);
	}

	.time-window-select {
		flex: 1;
		min-width: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-primary);
		border-radius: var(--radius-sm);
		padding: var(--space-1);
		font-family: var(--font-body);
		font-size: 0.75rem;
	}

	.time-window-select:disabled {
		opacity: 0.5;
	}

	/* ── Repertoire section (above CandidateMoves) ───────────────────── */

	.repertoire-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.panel-section-title {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-1) 0;
	}

	.repertoire-move {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-body);
		font-size: 0.85rem;
		color: var(--color-text-primary);
		text-align: left;
		width: 100%;
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.repertoire-move:hover {
		background: var(--color-surface-alt);
	}

	.rep-move-san {
		font-weight: 600;
	}

	.rep-move-badge {
		font-size: 0.65rem;
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
	}

	.max-games-input {
		width: 55px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-primary);
		border-radius: var(--radius-sm);
		padding: var(--space-1);
		font-family: var(--font-body);
		font-size: 0.75rem;
		text-align: center;
	}

	.max-games-input:disabled {
		opacity: 0.5;
	}

	.refresh-btn,
	.export-btn {
		width: 100%;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-body);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.refresh-btn {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.export-btn {
		background: none;
		border: 1px solid var(--color-accent);
		color: var(--color-accent);
		font-weight: 600;
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.export-btn:hover {
		background: var(--color-accent);
		color: var(--color-base);
	}

	.refresh-status {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.3;
	}

	.export-success {
		font-size: 0.7rem;
		color: var(--color-eval-good);
		margin: 0;
	}

	.export-error {
		font-size: 0.7rem;
		color: var(--color-eval-blunder);
		margin: 0;
	}

	.modal-content p {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-3) 0;
		line-height: 1.4;
	}

	.modal-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
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

	.form-field {
		margin-bottom: var(--space-3);
	}

	.conflicts-section {
		margin: var(--space-2) 0;
	}

	.conflicts-section h4 {
		font-size: 0.85rem;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-1) 0;
	}

	.conflict-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		font-size: 0.85rem;
	}

	.conflict-pos {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		min-width: 70px;
	}

	.conflict-choice {
		background: var(--color-surface-alt);
		border: 2px solid var(--color-border);
		color: var(--color-text-primary);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.conflict-choice.selected {
		border-color: var(--color-accent);
		background: var(--color-surface);
	}

	.conflict-tag {
		font-size: 0.65rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.conflict-vs {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.section-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-1) 0;
		line-height: 1.3;
	}

	/* ── Workspace layout ─────────────────────────────────────────────── */

	.prep-workspace {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.dashboard-col {
		flex: 0 0 200px;
		position: sticky;
		top: var(--space-4);
	}

	.board-col {
		flex: 0 0 auto;
	}

	.panel-col {
		flex: 1;
		min-width: 250px;
		max-height: 80vh;
		overflow-y: auto;
	}

	/* ── Nav controls ─────────────────────────────────────────────────── */

	.nav-controls {
		display: flex;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}

	.nav-controls button {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-size: 0.9rem;
		cursor: pointer;
	}

	.nav-controls button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.nav-controls button:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	/* ── Current line ─────────────────────────────────────────────────── */

	.current-line {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		margin-top: var(--space-2);
		font-size: 0.8rem;
	}

	.move-number {
		color: var(--color-text-muted);
		margin-right: 2px;
	}

	.line-move {
		background: none;
		border: none;
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		padding: 1px 3px;
		border-radius: var(--radius-sm);
	}

	.line-move:hover {
		background: var(--color-surface-alt);
	}

	/* ── Conflict + error banners ────────────────────────────────────── */

	.conflict-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--color-eval-inaccuracy);
		color: white;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin-bottom: var(--space-2);
		font-size: 0.8rem;
	}

	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--color-eval-blunder);
		color: white;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin-top: var(--space-2);
		font-size: 0.8rem;
	}

	.dismiss-btn {
		background: none;
		border: none;
		color: white;
		font-size: 1rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	/* ── Responsive ───────────────────────────────────────────────────── */

	@media (max-width: 1024px) {
		.prep-workspace {
			flex-wrap: wrap;
		}

		.dashboard-col {
			flex: 1 1 100%;
			position: static;
		}

		.panel-col {
			max-height: none;
			width: 100%;
		}
	}

	@media (max-width: 768px) {
		.prep-workspace {
			flex-direction: column;
		}

		.dashboard-col {
			flex: 1 1 100%;
		}

		.panel-col {
			width: 100%;
		}

		.prep-detail {
			padding: var(--space-2);
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.prep-detail {
			padding: var(--space-1);
		}

		.panel-col {
			min-width: 0;
		}

		.dashboard-col {
			padding: var(--space-2);
		}
	}
</style>
