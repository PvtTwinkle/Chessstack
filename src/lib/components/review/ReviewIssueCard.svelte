<!--
	Review → one issue card in the analysis sidebar.

	The header jumps the board to the issue. Until the issue is resolved the
	card shows either the current chain-extension leg (keep building the
	repertoire along the game) or the issue's own phases:

	DEVIATION         — eval comparison + fail card / update repertoire / skip
	BEYOND_REPERTOIRE — pick a move to add
	OPPONENT_SURPRISE — phase 1: add the opponent's move (optionally to a new
	                    repertoire); phase 2: pick your response
-->
<script lang="ts">
	import ReviewIssuePicker from '$lib/components/ReviewIssuePicker.svelte';
	import type { GameIssue } from '$lib/pgn';
	import { playedMoveIsBetter } from '$lib/review/analysis';
	import ReviewDeviationInfo from './ReviewDeviationInfo.svelte';
	import type { ReviewState } from './reviewState.svelte';

	let { review, issue }: { review: ReviewState; issue: GameIssue } = $props();

	const isResolved = $derived(review.resolvedIssues.has(issue.ply));
	const isLoading = $derived(review.actionLoading.get(issue.ply) ?? false);
	const isActive = $derived(review.currentPlyIdx === issue.ply);
	const chainLeg = $derived(review.chainExtensions.get(issue.ply) ?? null);
</script>

<div
	class="issue-card"
	class:issue-deviation={issue.type === 'DEVIATION'}
	class:issue-beyond={issue.type === 'BEYOND_REPERTOIRE'}
	class:issue-surprise={issue.type === 'OPPONENT_SURPRISE'}
	class:issue-resolved={isResolved}
	class:issue-active={isActive}
>
	<!-- Header — click to jump board to this position -->
	<button
		class="issue-header"
		onclick={() => {
			review.currentPlyIdx = issue.ply;
		}}
	>
		<span class="issue-type-label">
			{#if issue.type === 'DEVIATION'}⚠{:else if issue.type === 'BEYOND_REPERTOIRE'}↗{:else}?{/if}
		</span>
		<span class="issue-move-num">Move {Math.ceil(issue.ply / 2)}</span>
		<span class="issue-san-played">{issue.playedSan}</span>
		{#if isResolved}
			<span class="resolved-mark">✓</span>
		{/if}
	</button>

	<!-- Details + actions (only if not resolved) -->
	{#if !isResolved}
		{#if chainLeg}
			<!-- ── Chain extension phases ─────────────────────────────────── -->
			<!-- Phase A: ask whether to add the next opponent move.         -->
			<!-- Phase B: opponent added — pick a response.                  -->
			{#if !chainLeg.opponentAdded}
				<div class="issue-details">
					<span>Keep building? Opponent would play <strong>{chainLeg.opponentSan}</strong></span>
				</div>
				<div class="issue-actions">
					<button
						class="act-btn act-btn--primary"
						onclick={() => review.handleChainAddOpponent(issue.ply)}
						disabled={isLoading}
					>
						Add opponent's {chainLeg.opponentSan}
					</button>
					<button
						class="act-btn act-btn--ghost"
						onclick={() => review.skipChain(issue.ply)}
						disabled={isLoading}
					>
						Done
					</button>
				</div>
			{:else if chainLeg.userFen}
				{#if chainLeg.transposition}
					<!-- Transposition: this position is already in the repertoire -->
					<div class="issue-details">
						<span class="transposition-label">Transposition</span>
						{#if chainLeg.transposition.userPlayedCorrect}
							<span
								>This position is already in your repertoire. You played <strong
									>{chainLeg.userSan}</strong
								> — the correct move.</span
							>
						{:else}
							<span
								>This position is already in your repertoire (book: <strong
									>{chainLeg.transposition.existingSan}</strong
								>). You played <strong>{chainLeg.userSan}</strong>.</span
							>
						{/if}
					</div>
					<div class="issue-actions">
						{#if chainLeg.transposition.userPlayedCorrect}
							<button
								class="act-btn act-btn--primary"
								onclick={() => review.skipChain(issue.ply)}
								disabled={isLoading}
							>
								Done
							</button>
							<button
								class="act-btn act-btn--ghost"
								onclick={() => review.handleTranspositionReplace(issue.ply)}
								disabled={isLoading}
								title="Replace the existing repertoire path to this position with the path from this game"
							>
								Replace path in tree
							</button>
						{:else}
							<button
								class="act-btn act-btn--warn"
								onclick={() => review.handleTranspositionFailCard(issue.ply)}
								disabled={isLoading}
							>
								Fail card
							</button>
							<button
								class="act-btn act-btn--warn"
								onclick={() => review.handleTranspositionReplace(issue.ply)}
								disabled={isLoading}
								title="Replace the existing repertoire move with what you played in this game"
							>
								Replace with {chainLeg.userSan}
							</button>
							<button
								class="act-btn act-btn--ghost"
								onclick={() => review.skipChain(issue.ply)}
								disabled={isLoading}
							>
								Skip
							</button>
						{/if}
					</div>
				{:else}
					<!-- Normal chain phase B — pick a response -->
					<div class="issue-details">
						<span><strong>{chainLeg.opponentSan}</strong> added. Pick your response:</span>
					</div>
					<div class="issue-picker-wrap">
						<ReviewIssuePicker
							fen={chainLeg.userFen}
							playerColor={review.analysedPlayerColor}
							gameMoveSan={chainLeg.userSan}
							gameMoveEvalCp={review.positionEvals.get(chainLeg.plyInGame + 1)?.evalCp ?? null}
							cplClass={review.getCplClassForPly(chainLeg.plyInGame + 1)}
							onSelectMove={(san) => review.handlePickChainResponse(issue.ply, san)}
							onHoverMove={(san) => review.handleHoverMove(chainLeg.userFen ?? '', san)}
							onSkip={() => review.skipChain(issue.ply)}
							disabled={isLoading}
							loading={isLoading}
						/>
					</div>
				{/if}
			{/if}
		{:else}
			<!-- ── Original issue phases ──────────────────────────────────── -->

			{#if issue.type === 'DEVIATION'}
				<!-- DEVIATION: eval comparison + simple action buttons -->
				<div class="issue-details">
					<ReviewDeviationInfo {review} {issue} />
				</div>
				{@const playedBetter = playedMoveIsBetter(
					review.deviationEvals.get(issue.ply),
					review.analysedPlayerColor
				)}
				<div class="issue-actions">
					<button
						class="act-btn act-btn--warn"
						onclick={() => review.handleFailCard(issue)}
						disabled={isLoading}
					>
						Fail card
					</button>
					<button
						class="act-btn {playedBetter ? 'act-btn--primary' : 'act-btn--warn'}"
						onclick={() => review.handleUpdateRepertoire(issue)}
						disabled={isLoading}
					>
						{playedBetter ? 'Replace in repertoire' : 'Update repertoire'}
					</button>
					<button
						class="act-btn act-btn--ghost"
						onclick={() => review.resolveIssue(issue.ply)}
						disabled={isLoading}
					>
						Skip
					</button>
				</div>
			{:else if issue.type === 'BEYOND_REPERTOIRE'}
				<!-- BEYOND_REPERTOIRE: tabbed move picker -->
				<div class="issue-details">
					<span
						>You played <strong>{issue.playedSan}</strong> — no repertoire move here. Pick a move to add:</span
					>
				</div>
				<div class="issue-picker-wrap">
					<ReviewIssuePicker
						fen={issue.fromFen}
						playerColor={review.analysedPlayerColor}
						gameMoveSan={issue.playedSan}
						gameMoveEvalCp={review.positionEvals.get(issue.ply)?.evalCp ?? null}
						cplClass={review.getCplClassForPly(issue.ply)}
						onSelectMove={(san) => review.handlePickResponseMove(issue, san)}
						onHoverMove={(san) => review.handleHoverMove(issue.fromFen, san)}
						onSkip={() => review.resolveIssue(issue.ply)}
						disabled={isLoading}
						loading={isLoading}
					/>
				</div>
			{:else if issue.type === 'OPPONENT_SURPRISE'}
				{#if !review.opponentMoveAdded.has(issue.ply)}
					<!-- Phase 1: decide whether to add the opponent's move -->
					<div class="issue-details">
						<span>Opponent played <strong>{issue.playedSan}</strong> (not in your repertoire)</span>
					</div>
					<div class="issue-actions">
						<button
							class="act-btn act-btn--primary"
							onclick={() => review.handleAddOpponentMove(issue)}
							disabled={isLoading}
						>
							Add to repertoire
						</button>
						{#if review.newRepIssuePly === issue.ply}
							<form
								class="new-rep-inline"
								onsubmit={(e) => {
									e.preventDefault();
									review.handleAddOpponentMoveNewRep(issue);
								}}
							>
								<input
									type="text"
									class="new-rep-input"
									placeholder="Repertoire name"
									bind:value={review.newRepName}
									disabled={isLoading}
								/>
								<button
									type="submit"
									class="act-btn act-btn--primary act-btn--sm"
									disabled={isLoading || !review.newRepName.trim()}
								>
									Create
								</button>
								<button
									type="button"
									class="act-btn act-btn--ghost act-btn--sm"
									onclick={review.closeNewRepForm}
									disabled={isLoading}
								>
									Cancel
								</button>
							</form>
						{:else}
							<button
								class="act-btn act-btn--secondary"
								onclick={() => review.openNewRepForm(issue.ply)}
								disabled={isLoading}
							>
								Add to new repertoire
							</button>
						{/if}
						<button
							class="act-btn act-btn--ghost"
							onclick={() => review.resolveIssue(issue.ply)}
							disabled={isLoading}
						>
							Skip
						</button>
					</div>
				{:else}
					<!-- Phase 2: opponent added — pick your response via tabbed panel -->
					<div class="issue-details">
						<span>Added <strong>{issue.playedSan}</strong>. Pick your response:</span>
					</div>
					<div class="issue-picker-wrap">
						<ReviewIssuePicker
							fen={issue.toFen}
							playerColor={review.analysedPlayerColor}
							gameMoveSan={issue.userResponseSan}
							gameMoveEvalCp={review.positionEvals.get(issue.ply + 1)?.evalCp ?? null}
							cplClass={review.getCplClassForPly(issue.ply + 1)}
							onSelectMove={(san) => review.handlePickResponseMove(issue, san)}
							onHoverMove={(san) => review.handleHoverMove(issue.toFen, san)}
							onSkip={() => review.resolveIssue(issue.ply)}
							disabled={isLoading}
							loading={isLoading}
						/>
					</div>
				{/if}
			{/if}
		{/if}
	{/if}
	{#if review.actionError.has(issue.ply)}
		<div class="action-error">{review.actionError.get(issue.ply)}</div>
	{/if}
</div>

<style>
	.issue-card {
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		overflow: hidden;
		transition: opacity var(--dur-fast) var(--ease-snap);
		box-shadow: var(--shadow-surface);
	}

	/* Type-specific border/background colours */
	.issue-deviation {
		border-color: rgba(226, 148, 74, 0.4);
		background: rgba(226, 148, 74, 0.05);
	}

	.issue-beyond {
		border-color: rgba(91, 127, 164, 0.4);
		background: rgba(91, 127, 164, 0.05);
	}

	.issue-surprise {
		border-color: rgba(220, 96, 96, 0.4);
		background: rgba(220, 96, 96, 0.05);
	}

	/* Resolved issues are dimmed */
	.issue-resolved {
		opacity: 0.45;
	}

	/* Active issue (board is showing this position) gets a slightly brighter ring */
	.issue-active:not(.issue-resolved) {
		filter: brightness(1.15);
	}

	.issue-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-family: var(--font-body);
	}

	.issue-type-label {
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.issue-move-num {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.issue-san-played {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-primary);
		flex: 1;
	}

	.resolved-mark {
		font-size: 0.9rem;
		color: var(--color-success);
		flex-shrink: 0;
	}

	.issue-details {
		padding: 0 var(--space-3) var(--space-2);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		line-height: 1.4;
	}

	.issue-details strong {
		color: var(--color-text-primary);
	}

	.transposition-label {
		display: inline-block;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-accent);
		background: rgba(91, 127, 164, 0.12);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}

	.issue-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: 0 var(--space-3) var(--space-3);
	}

	.action-error {
		padding: var(--space-2) var(--space-3);
		font-size: 0.73rem;
		color: var(--color-danger);
	}

	/* Action buttons within issue cards */
	.act-btn {
		padding: var(--space-2) var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		font-size: 0.73rem;
		font-weight: 600;
		cursor: pointer;
		font-family: var(--font-body);
		transition: filter var(--dur-fast) var(--ease-snap);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.act-btn:not(:disabled):hover {
		filter: brightness(1.2);
	}

	.act-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.act-btn--primary {
		background: rgba(91, 127, 164, 0.2);
		border-color: rgba(91, 127, 164, 0.5);
		color: var(--color-accent);
	}

	.act-btn--primary:not(:disabled):hover {
		box-shadow: var(--glow-accent);
	}

	.act-btn--warn {
		background: rgba(226, 148, 74, 0.18);
		border-color: rgba(226, 148, 74, 0.45);
		color: var(--color-accent-dim);
	}

	.act-btn--ghost {
		background: none;
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	.act-btn--secondary {
		background: rgba(130, 160, 200, 0.12);
		border-color: rgba(130, 160, 200, 0.35);
		color: var(--color-text-secondary);
	}

	.act-btn--sm {
		padding: var(--space-1) var(--space-2);
		font-size: 0.7rem;
	}

	/* ── New repertoire inline form ──────────────────────────────────────────── */

	.new-rep-inline {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		width: 100%;
	}

	.new-rep-input {
		flex: 1;
		min-width: 0;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.73rem;
	}

	.new-rep-input::placeholder {
		color: var(--color-text-muted);
	}

	.new-rep-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	/* ── ReviewIssuePicker wrapper ─────────────────────────────────────────── */

	.issue-picker-wrap {
		padding: 0 var(--space-3) var(--space-3);
	}
</style>
