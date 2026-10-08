<!--
	Review → input screen: paste a PGN or pick an imported game, plus recent reviews.

	Submitting runs the page's `analyzeGame` form action; the page shows the
	analysis when the action returns. Games handed over from an imported-game
	link (?importedGameId=…) or from the opening trainer (sessionStorage) are
	filled in and submitted automatically.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { manageRepertoiresOpen } from '$lib/stores/manageRepertoires';
	import type { PageData } from '../../../routes/review/$types';

	let {
		repertoireId,
		repertoireColor,
		importSettings,
		importedGames,
		recentGames,
		prefilledGame,
		analysisError = $bindable(),
		// eslint-disable-next-line no-useless-assignment -- bindable: written here, read by the Review page when saving
		importedGameId = $bindable(),
		overrideRepertoireId = $bindable()
	}: {
		repertoireId: number;
		repertoireColor: string;
		importSettings: PageData['importSettings'];
		importedGames: PageData['importedGames'];
		recentGames: PageData['recentGames'];
		prefilledGame: PageData['prefilledGame'];
		/** Error from the last analysis attempt (set by the page from the form result). */
		analysisError: string | null;
		/** The imported game being reviewed, if any; saved with the review. */
		importedGameId: number | null;
		/** Repertoire to analyse against instead of the active one. */
		overrideRepertoireId: number | null;
	} = $props();

	// ── Input state ─────────────────────────────────────────────────────────────

	let pgnText = $state('');
	// Default to the active repertoire's color; user can override before submitting.
	// Use $effect so this stays in sync if the active repertoire changes (e.g. after navigation).
	// playerColor is user-writable (color toggle sets it), so $derived alone won't work.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let playerColor = $state<'WHITE' | 'BLACK'>('WHITE');
	$effect(() => {
		playerColor = repertoireColor as 'WHITE' | 'BLACK';
	});
	let analysing = $state(false);

	// ── Import tab state ────────────────────────────────────────────────────────

	// Which tab is active in the input state: 'paste' or 'import'
	let inputTab = $state<'paste' | 'import'>('paste');

	// Import fetch state
	let importingLichess = $state(false);
	let importingChesscom = $state(false);
	let importResult = $state<{
		imported: number;
		skipped: number;
		source: string;
		reason?: string;
	} | null>(null);
	let importError = $state<string | null>(null);

	// Import list filter
	let importFilter = $state<'all' | 'pending' | 'reviewed' | 'skipped'>('all');

	// Repertoire picker modal
	let showRepPicker = $state(false);
	let repPickerAnalyses = $state<
		{ repertoireId: number; repertoireName: string; issueCount: number; matchDepth: number }[]
	>([]);
	let repPickerLoading = $state(false);
	let repPickerGameId = $state<number | null>(null);

	// Filtered imported games
	const filteredImportedGames = $derived(
		(importedGames ?? []).filter((g) => importFilter === 'all' || g.status === importFilter)
	);

	// Import functions
	async function triggerImport(source: 'LICHESS' | 'CHESSCOM') {
		importResult = null;
		importError = null;

		if (source === 'LICHESS') importingLichess = true;
		else importingChesscom = true;

		try {
			const res = await fetch('/api/import/fetch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source })
			});

			const result = await res.json();

			if (res.status === 429 && result.rateLimited) {
				importError = `Rate limited by ${source === 'LICHESS' ? 'Lichess' : 'Chess.com'}. Try again in a minute.`;
				return;
			}

			if (!res.ok) {
				importError = result.message ?? `Import failed (${res.status})`;
				return;
			}

			importResult = {
				imported: result.imported,
				skipped: result.skipped,
				source: source === 'LICHESS' ? 'Lichess' : 'Chess.com',
				reason: result.reason
			};

			// Refresh the imported games list
			const { invalidateAll } = await import('$app/navigation');
			await invalidateAll();
		} catch {
			importError = 'Network error. Check your connection.';
		} finally {
			if (source === 'LICHESS') importingLichess = false;
			else importingChesscom = false;
		}
	}

	async function skipImportedGame(gameId: number) {
		await fetch(`/api/import/${gameId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'skipped' })
		});
		const { invalidateAll } = await import('$app/navigation');
		await invalidateAll();
	}

	async function unskipImportedGame(gameId: number) {
		await fetch(`/api/import/${gameId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'pending' })
		});
		const { invalidateAll } = await import('$app/navigation');
		await invalidateAll();
	}

	async function startReviewImportedGame(gameId: number) {
		repPickerLoading = true;
		repPickerGameId = gameId;

		try {
			const res = await fetch(`/api/import/${gameId}/analyze`, { method: 'POST' });
			if (!res.ok) {
				importError = 'Failed to analyze game';
				return;
			}

			const result = await res.json();

			if (result.analyses.length === 0) {
				importError = result.message ?? 'No matching repertoires found for this game.';
				return;
			}

			if (result.analyses.length === 1) {
				// Only one matching repertoire — go directly to review.
				loadImportedGameForReview(
					gameId,
					result.game.pgn,
					result.game.playerColor,
					result.analyses[0].repertoireId
				);
			} else {
				// Multiple repertoires — show picker.
				repPickerAnalyses = result.analyses;
				showRepPicker = true;
			}
		} catch {
			importError = 'Network error analyzing game.';
		} finally {
			repPickerLoading = false;
		}
	}

	function loadImportedGameForReview(
		gameId: number,
		pgn: string,
		color: string,
		repertoireId: number
	) {
		showRepPicker = false;
		importedGameId = gameId;
		overrideRepertoireId = repertoireId;
		pgnText = pgn;
		playerColor = color as 'WHITE' | 'BLACK';
		inputTab = 'paste';

		// Auto-submit the analyze form after a tick to let the textarea render.
		setTimeout(() => {
			const formEl = document.querySelector(
				'form[action="?/analyzeGame"]'
			) as HTMLFormElement | null;
			if (formEl) formEl.requestSubmit();
		}, 100);
	}

	// ── Prefilled game from URL ─────────────────────────────────────────────────
	// When navigating from an external link with ?importedGameId=N, auto-fill the PGN.
	$effect(() => {
		if (prefilledGame) {
			const pg = prefilledGame;
			untrack(() => {
				loadImportedGameForReview(pg.id, pg.pgn, pg.playerColor, repertoireId);
			});
		}
	});

	onMount(() => {
		// Check for a training game passed via sessionStorage from /train
		const trainerData = sessionStorage.getItem('chessstack:trainer-review');
		if (trainerData) {
			sessionStorage.removeItem('chessstack:trainer-review');
			try {
				const { pgn, playerColor: color, repertoireId } = JSON.parse(trainerData);
				if (pgn && color) {
					pgnText = pgn;
					playerColor = color;
					if (repertoireId) overrideRepertoireId = repertoireId;
					inputTab = 'paste';
					// Auto-submit after a tick to let the textarea render
					setTimeout(() => {
						const formEl = document.querySelector(
							'form[action="?/analyzeGame"]'
						) as HTMLFormElement | null;
						if (formEl) formEl.requestSubmit();
					}, 100);
				}
			} catch {
				// Malformed data, ignore
			}
		}
	});
</script>

<div class="input-page">
	<!-- ── Tab bar ─────────────────────────────────────────────────────────── -->
	<div class="input-tabs">
		<button
			class="input-tab"
			class:input-tab--active={inputTab === 'paste'}
			onclick={() => (inputTab = 'paste')}
		>
			Paste PGN
		</button>
		<button
			class="input-tab"
			class:input-tab--active={inputTab === 'import'}
			onclick={() => (inputTab = 'import')}
		>
			Import Games
		</button>
	</div>

	<!-- ── Tab 1: Paste PGN ───────────────────────────────────────────────── -->
	{#if inputTab === 'paste'}
		<div class="input-card">
			<h2 class="input-title">Review a Game</h2>
			<p class="input-subtitle">Paste a PGN to find where you deviated from your repertoire.</p>

			<form
				method="POST"
				action="?/analyzeGame"
				use:enhance={() => {
					analysing = true;
					analysisError = null;
					return async ({ update }) => {
						await update({ reset: false });
						analysing = false;
					};
				}}
			>
				<!-- Color selector -->
				<div class="color-selector">
					<span class="color-label">I played as:</span>
					<label class="color-opt" class:selected={playerColor === 'WHITE'}>
						<input type="radio" name="playerColor" value="WHITE" bind:group={playerColor} />
						<span class="color-dot color-dot--white"></span> White
					</label>
					<label class="color-opt" class:selected={playerColor === 'BLACK'}>
						<input type="radio" name="playerColor" value="BLACK" bind:group={playerColor} />
						<span class="color-dot color-dot--black"></span> Black
					</label>
				</div>

				<!-- Hidden repertoire override (set when reviewing an imported game) -->
				{#if overrideRepertoireId}
					<input type="hidden" name="repertoireId" value={overrideRepertoireId} />
				{/if}

				<textarea
					name="pgn"
					class="pgn-input"
					rows="10"
					placeholder="[Event &quot;Rapid game&quot;]
[White &quot;You&quot;]
[Black &quot;Opponent&quot;]
[Result &quot;1-0&quot;]

1. e4 e5 2. Nf3 Nc6 ..."
					bind:value={pgnText}
					spellcheck="false"></textarea>

				{#if analysisError}
					<div class="error-banner">
						{analysisError}
						{#if analysisError.includes('Create one first')}
							<button
								type="button"
								class="create-rep-link"
								onclick={() => manageRepertoiresOpen.set(true)}>Create a repertoire</button
							>
						{/if}
					</div>
				{/if}

				<button
					type="submit"
					class="btn btn--primary btn--full"
					disabled={!pgnText.trim() || analysing}
				>
					{analysing ? 'Analysing…' : 'Analyse Game'}
				</button>
			</form>
		</div>

		<!-- ── Tab 2: Import Games ────────────────────────────────────────────── -->
	{:else}
		<div class="input-card">
			<h2 class="input-title">Import Games</h2>
			<p class="input-subtitle">Fetch recent games from Lichess or Chess.com.</p>

			<!-- Import buttons -->
			<div class="import-buttons">
				<button
					class="btn btn--import"
					onclick={() => triggerImport('LICHESS')}
					disabled={importingLichess || !importSettings?.lichessUsername}
				>
					{#if importingLichess}
						Importing…
					{:else if !importSettings?.lichessUsername}
						Lichess (set username in Settings)
					{:else}
						Import from Lichess
					{/if}
				</button>
				<button
					class="btn btn--import"
					onclick={() => triggerImport('CHESSCOM')}
					disabled={importingChesscom || !importSettings?.chesscomUsername}
				>
					{#if importingChesscom}
						Importing…
					{:else if !importSettings?.chesscomUsername}
						Chess.com (set username in Settings)
					{:else}
						Import from Chess.com
					{/if}
				</button>
			</div>

			<!-- Import result / error -->
			{#if importResult}
				<div class="import-result">
					{#if importResult.imported === 0 && importResult.reason}
						{#if importResult.reason === 'no_games'}
							No standard chess games found in your recent {importResult.source} history.
						{:else if importResult.reason === 'no_new_games'}
							No new games from {importResult.source} since your last import.
						{:else if importResult.reason === 'all_skipped'}
							All {importResult.skipped} fetched game{importResult.skipped !== 1 ? 's' : ''} from {importResult.source}
							were already imported.
						{:else}
							0 new games imported from {importResult.source}.
						{/if}
					{:else}
						{importResult.imported} new game{importResult.imported !== 1 ? 's' : ''} imported from {importResult.source}.
						{#if importResult.skipped > 0}
							{importResult.skipped} already imported.
						{/if}
					{/if}
				</div>
			{/if}
			{#if importError}
				<div class="error-banner">
					{importError}
					{#if importError.includes('Create one first')}
						<button
							type="button"
							class="create-rep-link"
							onclick={() => manageRepertoiresOpen.set(true)}>Create a repertoire</button
						>
					{/if}
				</div>
			{/if}

			<!-- Filter chips -->
			<div class="import-filters">
				{#each ['all', 'pending', 'reviewed', 'skipped'] as f (f)}
					<button
						class="filter-chip"
						class:filter-chip--active={importFilter === f}
						onclick={() => (importFilter = f as typeof importFilter)}
					>
						{f.charAt(0).toUpperCase() + f.slice(1)}
					</button>
				{/each}
			</div>

			<!-- Imported games list -->
			{#if filteredImportedGames.length === 0}
				<p class="import-empty">
					{importFilter === 'all'
						? 'No imported games yet. Click a button above to fetch games.'
						: `No ${importFilter} games.`}
				</p>
			{:else}
				<div class="import-list">
					{#each filteredImportedGames as game (game.id)}
						<div class="import-item">
							<div class="import-meta">
								<span class="import-source import-source--{game.source.toLowerCase()}">
									{game.source === 'LICHESS' ? 'Li' : 'CC'}
								</span>
								<span class="import-color">
									<span
										class="color-dot {game.playerColor === 'WHITE'
											? 'color-dot--white'
											: 'color-dot--black'}"
									></span>
								</span>
								<span class="import-opponent">
									vs {game.opponentName ?? 'Unknown'}
									{#if game.opponentRating}
										<span class="import-rating">({game.opponentRating})</span>
									{/if}
								</span>
								<span class="import-result-text">{game.result ?? ''}</span>
								{#if game.playedAt}
									<span class="import-date">
										{new Date(game.playedAt).toLocaleDateString(undefined, {
											month: 'short',
											day: 'numeric'
										})}
									</span>
								{/if}
							</div>
							<div class="import-actions">
								{#if game.status === 'pending'}
									<button
										class="btn btn--sm btn--primary"
										onclick={() => startReviewImportedGame(game.id)}
										disabled={repPickerLoading && repPickerGameId === game.id}
									>
										{repPickerLoading && repPickerGameId === game.id ? 'Analyzing…' : 'Review'}
									</button>
									<button class="btn btn--sm btn--ghost" onclick={() => skipImportedGame(game.id)}>
										Skip
									</button>
								{:else if game.status === 'reviewed'}
									<span class="import-badge import-badge--reviewed">Reviewed</span>
								{:else}
									<span class="import-badge import-badge--skipped">Skipped</span>
									<button
										class="btn btn--sm btn--ghost"
										onclick={() => unskipImportedGame(game.id)}
									>
										Un-skip
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Recent reviews history -->
	{#if recentGames.length > 0}
		<div class="history-section">
			<div class="section-label">RECENT REVIEWS</div>
			<div class="history-list">
				{#each recentGames as game (game.id)}
					<div class="history-item">
						<span class="history-date">
							{new Date(game.reviewedAt).toLocaleDateString(undefined, {
								month: 'short',
								day: 'numeric'
							})}
						</span>
						<span class="history-source">{game.source}</span>
						{#if game.deviationFen}
							<span class="history-badge deviation">Deviation found</span>
						{:else}
							<span class="history-badge clean">Clean</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- ── Repertoire Picker Modal ────────────────────────────────────────────── -->
{#if showRepPicker}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (showRepPicker = false)}>
		<div class="modal-card" onclick={(e) => e.stopPropagation()}>
			<h3 class="modal-title">Choose Repertoire</h3>
			<p class="modal-subtitle">
				This game matches multiple repertoires. Pick one to review against.
			</p>
			<div class="rep-picker-list">
				{#each repPickerAnalyses as a (a.repertoireId)}
					<button
						class="rep-picker-item"
						onclick={() => {
							const game = importedGames?.find((g) => g.id === repPickerGameId);
							if (game) {
								loadImportedGameForReview(game.id, game.pgn, game.playerColor, a.repertoireId);
							}
						}}
					>
						<span class="rep-picker-name">{a.repertoireName}</span>
						<span class="rep-picker-match">
							Matches first {Math.ceil(a.matchDepth / 2)} move{Math.ceil(a.matchDepth / 2) !== 1
								? 's'
								: ''}
						</span>
						<span class="rep-picker-issues">
							{a.issueCount === 0
								? 'Clean'
								: `${a.issueCount} issue${a.issueCount !== 1 ? 's' : ''}`}
						</span>
					</button>
				{/each}
			</div>
			<button class="btn btn--secondary btn--full" onclick={() => (showRepPicker = false)}>
				Cancel
			</button>
		</div>
	</div>
{/if}

<style>
	/* ── Input page ─────────────────────────────────────────────────────────── */

	.input-page {
		max-width: 640px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.input-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		box-shadow: var(--shadow-surface);
	}

	.input-title {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-body);
		margin: 0;
	}

	.input-subtitle {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	/* Color selector */
	.color-selector {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.color-label {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.color-opt {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-text-primary);
		cursor: pointer;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
		user-select: none;
	}

	.color-opt input {
		display: none;
	}

	.color-opt.selected {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
		background: var(--color-accent-glow);
	}

	/* PGN textarea */
	.pgn-input {
		width: 100%;
		box-sizing: border-box;
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.75rem;
		line-height: 1.5;
		padding: var(--space-3);
		resize: vertical;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.pgn-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	/* Error banner */
	.error-banner {
		background: rgba(220, 60, 60, 0.12);
		border: 1px solid rgba(220, 60, 60, 0.4);
		color: var(--color-danger);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: 0.82rem;
	}

	.error-banner .create-rep-link {
		display: inline-block;
		margin-top: var(--space-2);
		background: none;
		border: none;
		padding: 0;
		font-family: inherit;
		font-size: inherit;
		color: var(--color-accent);
		text-decoration: underline;
		font-weight: 600;
		cursor: pointer;
	}

	.error-banner .create-rep-link:hover {
		color: var(--color-text-primary);
	}

	/* ── Input tab bar ─────────────────────────────────────────────────────── */

	.input-tabs {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-2);
	}

	.input-tab {
		padding: var(--space-2) var(--space-4);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition:
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.input-tab:hover {
		color: var(--color-text-secondary);
	}

	.input-tab--active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
		font-weight: 600;
	}

	/* ── Import tab ─────────────────────────────────────────────────────────── */

	.import-buttons {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.import-result {
		padding: var(--space-2) var(--space-3);
		background: rgba(92, 204, 92, 0.1);
		border: 1px solid rgba(92, 204, 92, 0.25);
		color: var(--color-success);
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
	}

	.import-filters {
		display: flex;
		gap: var(--space-1);
	}

	.filter-chip {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 0.72rem;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.filter-chip:hover {
		color: var(--color-text-secondary);
	}

	.filter-chip--active {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: var(--color-accent-glow);
	}

	.import-empty {
		color: var(--color-text-muted);
		font-size: 0.82rem;
		text-align: center;
		padding: var(--space-6) 0;
	}

	.import-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 400px;
		overflow-y: auto;
	}

	.import-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-base);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
	}

	.import-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.import-source {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 1px 4px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.import-source--lichess {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-muted);
	}

	.import-source--chesscom {
		background: rgba(118, 150, 86, 0.2);
		color: rgba(118, 150, 86, 0.9);
	}

	.import-color {
		flex-shrink: 0;
	}

	.import-opponent {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-text-primary);
	}

	.import-rating {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.import-result-text {
		color: var(--color-text-muted);
		flex-shrink: 0;
		font-size: 0.75rem;
	}

	.import-date {
		color: var(--color-text-muted);
		flex-shrink: 0;
		font-size: 0.75rem;
	}

	.import-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.import-badge {
		font-size: 0.65rem;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.import-badge--reviewed {
		background: rgba(92, 204, 92, 0.12);
		color: var(--color-success);
	}

	.import-badge--skipped {
		background: rgba(160, 160, 160, 0.12);
		color: var(--color-text-muted);
	}

	/* ── Repertoire picker modal ───────────────────────────────────────────── */

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--space-4);
	}

	.modal-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		max-width: 400px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.modal-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-body);
		margin: 0;
	}

	.modal-subtitle {
		font-size: 0.82rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.rep-picker-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.rep-picker-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-family: var(--font-body);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.rep-picker-item:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-glow);
	}

	.rep-picker-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.rep-picker-match {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
	}

	.rep-picker-issues {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* ── History section ────────────────────────────────────────────────────── */

	.history-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.history-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--color-base);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
	}

	.history-date {
		color: var(--color-text-muted);
		flex-shrink: 0;
		min-width: 3.5rem;
	}

	.history-source {
		color: var(--color-text-muted);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.history-badge {
		margin-left: auto;
		font-size: 0.7rem;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.history-badge.deviation {
		background: rgba(226, 148, 74, 0.15);
		color: var(--color-accent-dim);
		border: 1px solid rgba(226, 148, 74, 0.3);
	}

	.history-badge.clean {
		background: rgba(92, 204, 92, 0.12);
		color: var(--color-success);
		border: 1px solid rgba(92, 204, 92, 0.25);
	}
</style>
