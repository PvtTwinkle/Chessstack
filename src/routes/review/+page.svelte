<!--
	Review Mode — /review
	─────────────────────
	Analyse a played game against the user's opening repertoire.

	STATES
	──────
	input    — PGN textarea + color selector, recent review history (ReviewInput)
	analysis — board (ReviewBoard) + issue list (ReviewIssueCard) + notes + save
	saved    — confirmation screen (ReviewSaved)

	All analysis state and the issue-resolution actions live in
	reviewState.svelte.ts; this page wires them to the components.
-->

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import ReviewInput from '$lib/components/review/ReviewInput.svelte';
	import ReviewSaved from '$lib/components/review/ReviewSaved.svelte';
	import ReviewBoard from '$lib/components/review/ReviewBoard.svelte';
	import ReviewIssueCard from '$lib/components/review/ReviewIssueCard.svelte';
	import { createReviewState } from '$lib/components/review/reviewState.svelte';
	import { engineSettings } from '$lib/engine/settings';
	import '$lib/components/review/review-ui.css';
	import type { PageData } from './$types';
	import { initSounds, setSoundEnabled } from '$lib/sounds';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	const s = createReviewState({
		getRepertoireId: () => data.repertoire.id,
		getMoves: () => data.moves,
		// Auto-play delay between moves (configurable in Settings → Drill).
		getPlaybackSpeed: () => data.settings?.playbackSpeed ?? 500,
		getEngineSettings: () => engineSettings(data.settings)
	});

	onMount(() => {
		initSounds();
	});

	// Keep the sounds module in sync with the user's saved preference.
	// This reacts to changes from the settings page (via invalidateAll).
	$effect(() => {
		setSoundEnabled(data.settings?.soundEnabled ?? true);
	});

	// When the analyzeGame action succeeds, store the result in local state.
	// When it fails, show the error. We avoid reading form data directly in the
	// template because the form prop resets on page invalidation. Only `form`
	// is a dependency: applyFormResult runs untracked so background fetches it
	// starts cannot re-trigger this effect.
	$effect(() => {
		if (!form) return;
		const result = form;
		untrack(() => s.applyFormResult(result));
	});
</script>

<div class="review-ui">
	<!-- ════════════════════════════════════════════════════════════════════════════
	     STATE A — Input
	     ════════════════════════════════════════════════════════════════════════════ -->

	{#if s.pageState === 'input'}
		<ReviewInput
			repertoireId={data.repertoire.id}
			repertoireColor={data.repertoire.color}
			importSettings={data.importSettings}
			importedGames={data.importedGames}
			recentGames={data.recentGames}
			prefilledGame={data.prefilledGame}
			bind:analysisError={s.analysisError}
			bind:importedGameId={s.importedGameId}
			bind:overrideRepertoireId={s.overrideRepertoireId}
		/>

		<!-- ════════════════════════════════════════════════════════════════════════════
	     STATE B — Analysis
	     ════════════════════════════════════════════════════════════════════════════ -->
	{:else if s.pageState === 'analysis' && s.analysis}
		{@const analysis = s.analysis}
		<div class="page">
			<ReviewBoard
				review={s}
				{analysis}
				boardSize={data.settings?.boardSize ?? 0}
				boardTheme={data.settings?.boardTheme ?? 'blue'}
			/>

			<!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
			<div class="sidebar">
				<!-- Repertoire identity -->
				<div class="rep-header">
					<span class="rep-icon"
						><span
							class="color-dot {s.analysedPlayerColor === 'WHITE'
								? 'color-dot--white'
								: 'color-dot--black'}"
						></span></span
					>
					<span class="rep-name">{s.analysisRepName ?? data.repertoire.name}</span>
					<span
						class="color-badge"
						class:badge-white={s.analysedPlayerColor === 'WHITE'}
						class:badge-black={s.analysedPlayerColor === 'BLACK'}
					>
						{s.analysedPlayerColor === 'WHITE' ? 'White' : 'Black'}
					</span>
				</div>

				<!-- ECO opening name for current board position -->
				<OpeningName currentFen={s.currentFen} fenHistory={s.openingFenHistory} />

				<!-- Game info from PGN headers -->
				{#if s.analysisHeaders.White || s.analysisHeaders.Black}
					<div class="game-info">
						{s.analysisHeaders.White ?? '?'} vs {s.analysisHeaders.Black ?? '?'}
						{#if s.analysisHeaders.Result}
							<span class="game-result">{s.analysisHeaders.Result}</span>
						{/if}
					</div>
				{/if}

				<!-- Issues section -->
				<div class="section-label">
					{#if analysis.issues.length === 0}
						ANALYSIS
					{:else}
						ISSUES ({analysis.issues.length})
					{/if}
				</div>

				{#if analysis.issues.length === 0}
					<div class="no-issues">
						<div class="no-issues-icon">✓</div>
						<p class="no-issues-title">No deviations found!</p>
						<p class="no-issues-hint">Your opening was perfectly on book.</p>
					</div>
				{:else}
					<div class="issues-list">
						{#each analysis.issues as issue (issue.ply)}
							<ReviewIssueCard review={s} {issue} />
						{/each}
					</div>
				{/if}

				<!-- Notes + save -->
				<div class="save-section">
					<textarea
						class="notes-input"
						rows="3"
						placeholder="Notes about this game…"
						bind:value={s.notes}></textarea>
					<button class="btn btn--primary btn--full" onclick={s.saveReview} disabled={s.saving}>
						{s.saving ? 'Saving…' : 'Save Review'}
					</button>
				</div>
			</div>
		</div>

		<!-- ════════════════════════════════════════════════════════════════════════════
	     STATE C — Saved
	     ════════════════════════════════════════════════════════════════════════════ -->
	{:else if s.pageState === 'saved'}
		<ReviewSaved
			analysis={s.analysis}
			resolvedCount={s.resolvedCount}
			onReviewAnother={s.reviewAnother}
		/>
	{/if}
</div>

<style>
	/* ── Two-column analysis layout ─────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.sidebar {
		width: 100%;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	/* ── Sidebar elements ───────────────────────────────────────────────────── */

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
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
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

	.game-info {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.game-result {
		font-weight: 700;
		color: var(--color-text-primary);
	}

	/* ── No issues state ────────────────────────────────────────────────────── */

	.no-issues {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) 0;
	}

	.no-issues-icon {
		font-size: 1.5rem;
		color: var(--color-success);
	}

	.no-issues-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.no-issues-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* ── Issue list ─────────────────────────────────────────────────────────── */

	.issues-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		overflow-y: auto;
	}

	/* ── Notes + save section ───────────────────────────────────────────────── */

	.save-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: auto;
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}

	.notes-input {
		width: 100%;
		box-sizing: border-box;
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: 0.8rem;
		padding: var(--space-2) var(--space-3);
		resize: vertical;
		font-family: var(--font-body);
	}

	.notes-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	/* ── Mobile responsive ────────────────────────────────────────────── */

	/* Tablet (768px – 1023px) — --bp-md */
	@media (min-width: 768px) {
		.page {
			display: grid;
			grid-template-columns: auto 280px;
			gap: var(--space-4);
			align-items: start;
			justify-content: center;
			padding: 0;
		}
	}

	/* Desktop (≥1024px) — --bp-lg */
	@media (min-width: 1024px) {
		.page {
			grid-template-columns: auto 340px;
			gap: var(--space-6);
			max-width: 1100px;
			margin: 0 auto;
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.page {
			padding: var(--space-2);
			gap: var(--space-2);
		}

		.sidebar {
			padding: var(--space-3);
			gap: var(--space-3);
		}

		.notes-input {
			max-height: 30vh;
		}
	}
</style>
