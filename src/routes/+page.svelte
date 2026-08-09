<script lang="ts">
	import type { PageData } from './$types';
	import OnboardingWelcome from '$lib/components/OnboardingWelcome.svelte';
	import { formatLine } from '$lib/gaps';
	import { base } from '$app/paths';
	import { invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	// ── Gap Finder threshold ────────────────────────────────────────────
	let gapMinGames = $derived.by(() => data.settings?.gapMinGames ?? 10000);

	async function updateGapThreshold(e: Event) {
		const value = Number((e.target as HTMLSelectElement).value);
		await fetch(`${base}/api/settings`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ gapMinGames: value })
		});
		await invalidateAll();
	}

	// ── Health prompt (actionable hint for the weakest factor) ─────────
	let healthPrompt = $derived.by(() => {
		if (data.totalCards === 0 || data.healthScore >= 80) return null;

		const gapCount = data.gaps.length;
		const coverage = Math.max(0, 100 - gapCount * 5);
		const mastery = Math.round((data.masteredCount / data.totalCards) * 100);
		const freshness = Math.round((1 - data.dueCount / data.totalCards) * 100);
		const trouble = data.troubleCount ?? 0;
		const stability = Math.round((1 - trouble / data.totalCards) * 100);

		const learningCount = data.cardStates.new_ + data.cardStates.learning;
		const factors = [
			{
				score: freshness,
				text: `Drill ${data.dueCount} due card${data.dueCount === 1 ? '' : 's'} to improve`,
				href: `${base}/drill`
			},
			{
				score: coverage,
				text: `Fix ${gapCount} gap${gapCount === 1 ? '' : 's'} to improve`,
				href: `${base}/build`
			},
			{
				score: mastery,
				text: `Learn ${learningCount} new card${learningCount === 1 ? '' : 's'} to improve`,
				href: `${base}/drill`
			},
			{
				score: stability,
				text: `Review ${trouble} trouble card${trouble === 1 ? '' : 's'} to improve`,
				href: `${base}/drill`
			}
		];

		return factors.reduce((worst, f) => (f.score < worst.score ? f : worst));
	});

	// ── Puzzle Goal state ───────────────────────────────────────────────
	let editingGoal = $state(false);
	let goalCountInput = $state<number | undefined>(undefined);
	let goalFreqInput = $state<string>('daily');
	let savingGoal = $state(false);

	// Sync edit form with current goal when data changes.
	$effect(() => {
		if (data.puzzleGoal) {
			goalCountInput = data.puzzleGoal.count;
			goalFreqInput = data.puzzleGoal.frequency;
		}
	});

	async function saveGoal() {
		if (!goalCountInput || goalCountInput < 1) return;
		savingGoal = true;
		try {
			await fetch(`${base}/api/settings`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					puzzleGoalCount: goalCountInput,
					puzzleGoalFrequency: goalFreqInput
				})
			});
			editingGoal = false;
			await invalidateAll();
		} finally {
			savingGoal = false;
		}
	}

	async function clearGoal() {
		savingGoal = true;
		try {
			await fetch(`${base}/api/settings`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ puzzleGoalCount: null })
			});
			editingGoal = false;
			goalCountInput = undefined;
			goalFreqInput = 'daily';
			await invalidateAll();
		} finally {
			savingGoal = false;
		}
	}

	/**
	 * Format a unix timestamp (seconds) as a relative time string like
	 * "in 3 hours" or "in 2 days". No external library needed.
	 */
	function relativeTime(unixSeconds: number): string {
		const diffMs = unixSeconds * 1000 - Date.now();
		const diffMin = Math.round(diffMs / 60_000);
		if (diffMin < 1) return 'now';
		if (diffMin < 60) return `in ${diffMin}m`;
		const diffHr = Math.round(diffMin / 60);
		if (diffHr < 24) return `in ${diffHr}h`;
		const diffDay = Math.round(diffHr / 24);
		return `in ${diffDay}d`;
	}

	/**
	 * Accuracy percentage for a session. Returns 0–100.
	 */
	function accuracy(reviewed: number, correct: number): number {
		if (reviewed === 0) return 0;
		return Math.round((correct / reviewed) * 100);
	}

	/**
	 * CSS class for an accuracy block: green >80%, yellow 60–80%, red <60%.
	 */
	function accuracyClass(reviewed: number, correct: number): string {
		const pct = accuracy(reviewed, correct);
		if (pct >= 80) return 'acc-green';
		if (pct >= 60) return 'acc-yellow';
		return 'acc-red';
	}
</script>

<!--
	Show the onboarding welcome screen if the user has no repertoires yet.
	Once they create one via the welcome screen, invalidateAll() re-runs the
	layout load, repertoires.length becomes 1, and this condition flips.
-->
{#if data.repertoires.length === 0}
	<OnboardingWelcome />
{:else}
	<div class="page-wrapper">
		<h1>Dashboard</h1>

		<div class="widget-grid">
			<!-- Due Now -->
			<a href="{base}/drill" class="widget widget-link">
				<div class="widget-label">Due Now</div>
				<div class="widget-value" class:due-positive={data.dueCount > 0}>
					{data.dueCount}
				</div>
				{#if data.dueCount > 0}
					<div class="widget-hint">Tap to drill</div>
				{:else}
					<div class="widget-hint">All caught up</div>
				{/if}
			</a>

			<!-- Mastered -->
			<div class="widget">
				<div class="widget-label">Mastered</div>
				<div class="widget-value mastered-value">
					{data.masteredCount}<span class="widget-denom">/{data.totalCards}</span>
				</div>
				{#if data.totalCards > 0}
					<div class="widget-hint">
						{Math.round((data.masteredCount / data.totalCards) * 100)}% of cards
					</div>
				{/if}
			</div>

			<!-- Streak -->
			<div class="widget">
				<div class="widget-label">Streak</div>
				<div class="widget-value streak-value">
					{data.streak}<span class="widget-unit">d</span>
				</div>
				<div class="widget-hint">
					{data.streak === 0 ? 'Drill today to start' : 'Consecutive days'}
				</div>
			</div>

			<!-- Next Review -->
			<div class="widget">
				<div class="widget-label">Next Review</div>
				<div class="widget-value next-value">
					{#if data.nextReviewAt}
						{relativeTime(data.nextReviewAt)}
					{:else if data.totalCards === 0}
						&mdash;
					{:else}
						Now
					{/if}
				</div>
				<div class="widget-hint">
					{#if data.nextReviewAt}
						Soonest due card
					{:else if data.totalCards === 0}
						No cards yet
					{:else}
						Cards are waiting
					{/if}
				</div>
			</div>

			<!-- Health Score -->
			<div class="widget">
				<div class="widget-label">Health</div>
				<div
					class="widget-value"
					class:health-green={data.healthScore >= 80}
					class:health-yellow={data.healthScore >= 50 && data.healthScore < 80}
					class:health-red={data.healthScore < 50}
				>
					{#if data.totalCards === 0}
						&mdash;
					{:else}
						{data.healthScore}
					{/if}
				</div>
				<div class="widget-hint">
					{#if data.totalCards === 0}
						No cards yet
					{:else if healthPrompt}
						<a href={healthPrompt.href} class="health-action">{healthPrompt.text}</a>
					{:else}
						Healthy
					{/if}
				</div>
			</div>

			<!-- Puzzle Goal -->
			<div class="widget">
				<div class="widget-label">Puzzle Goal</div>
				{#if data.puzzleGoal && !editingGoal}
					{@const pct = Math.min(
						100,
						Math.round((data.puzzleGoal.solved / data.puzzleGoal.count) * 100)
					)}
					{@const met = data.puzzleGoal.solved >= data.puzzleGoal.count}
					{@const freqLabel =
						data.puzzleGoal.frequency === 'daily'
							? 'today'
							: data.puzzleGoal.frequency === 'weekly'
								? 'this week'
								: 'this month'}

					<div class="widget-value" class:goal-met={met} class:goal-progress={!met}>
						{data.puzzleGoal.solved}<span class="widget-denom">/{data.puzzleGoal.count}</span>
					</div>

					<div class="goal-bar">
						<div class="goal-bar-fill" class:goal-bar-complete={met} style="width: {pct}%"></div>
					</div>

					{#if met}
						<div class="widget-hint goal-complete-hint">Goal met {freqLabel}!</div>
					{:else}
						<a href="{base}/puzzles" class="goal-link">Solve puzzles</a>
					{/if}

					<button class="goal-edit-btn" onclick={() => (editingGoal = true)}>Edit</button>
				{:else}
					<!-- Setup / edit form -->
					<div class="goal-setup">
						<div class="goal-form-row">
							<input
								type="number"
								min="1"
								max="999"
								placeholder="10"
								class="goal-input"
								bind:value={goalCountInput}
							/>
							<select class="goal-freq-select" bind:value={goalFreqInput}>
								<option value="daily">daily</option>
								<option value="weekly">weekly</option>
								<option value="monthly">monthly</option>
							</select>
						</div>
						<div class="goal-form-actions">
							<button
								class="goal-save-btn"
								onclick={saveGoal}
								disabled={!goalCountInput || goalCountInput < 1 || savingGoal}
							>
								{savingGoal ? 'Saving…' : 'Set Goal'}
							</button>
							{#if data.puzzleGoal}
								<button class="goal-clear-btn" onclick={clearGoal} disabled={savingGoal}>
									Clear
								</button>
								<button
									class="goal-clear-btn"
									onclick={() => (editingGoal = false)}
									disabled={savingGoal}
								>
									Cancel
								</button>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Card State Breakdown -->
			<div class="widget widget-wide">
				<div class="widget-label">Card States</div>
				{#if data.totalCards > 0}
					<div class="state-bar">
						{#if data.cardStates.new_ > 0}
							<div
								class="state-segment state-new"
								style="width: {(data.cardStates.new_ / data.totalCards) * 100}%"
								title="New: {data.cardStates.new_}"
							></div>
						{/if}
						{#if data.cardStates.learning > 0}
							<div
								class="state-segment state-learning"
								style="width: {(data.cardStates.learning / data.totalCards) * 100}%"
								title="Learning: {data.cardStates.learning}"
							></div>
						{/if}
						{#if data.cardStates.review > 0}
							<div
								class="state-segment state-review"
								style="width: {(data.cardStates.review / data.totalCards) * 100}%"
								title="Review: {data.cardStates.review}"
							></div>
						{/if}
						{#if data.cardStates.relearning > 0}
							<div
								class="state-segment state-relearning"
								style="width: {(data.cardStates.relearning / data.totalCards) * 100}%"
								title="Relearning: {data.cardStates.relearning}"
							></div>
						{/if}
					</div>
					<div class="state-legend">
						<span class="legend-item"
							><span class="legend-dot state-new"></span> New {data.cardStates.new_}</span
						>
						<span class="legend-item"
							><span class="legend-dot state-learning"></span> Learning {data.cardStates
								.learning}</span
						>
						<span class="legend-item"
							><span class="legend-dot state-review"></span> Review {data.cardStates.review}</span
						>
						<span class="legend-item"
							><span class="legend-dot state-relearning"></span> Relearning {data.cardStates
								.relearning}</span
						>
					</div>
				{:else}
					<p class="widget-empty">No cards yet</p>
				{/if}
			</div>

			<!-- Accuracy Trend -->
			<div class="widget widget-wide">
				<div class="widget-label">Accuracy Trend</div>
				{#if data.recentSessions.length > 0}
					<div class="trend-row">
						{#each data.recentSessions as session (session.completedAt)}
							<div
								class="trend-block {accuracyClass(session.cardsReviewed, session.cardsCorrect)}"
								title="{accuracy(
									session.cardsReviewed,
									session.cardsCorrect
								)}% ({session.cardsCorrect}/{session.cardsReviewed})"
							></div>
						{/each}
					</div>
					<div class="trend-legend">
						<span class="legend-item"><span class="legend-dot acc-green"></span> &gt;80%</span>
						<span class="legend-item"><span class="legend-dot acc-yellow"></span> 60–80%</span>
						<span class="legend-item"><span class="legend-dot acc-red"></span> &lt;60%</span>
					</div>
				{:else}
					<p class="widget-empty">Complete a session to see trends</p>
				{/if}
			</div>

			<!-- Gap Finder -->
			{#if data.gaps.length > 0}
				<div class="widget widget-wide">
					<div class="widget-label">
						<span class="gap-badge">{data.gaps.length}</span>
						Gap{data.gaps.length === 1 ? '' : 's'} Found
						<select class="gap-threshold" value={gapMinGames} onchange={updateGapThreshold}>
							<option value={10000}>10,000+ games</option>
							<option value={1000}>1,000+ games</option>
							<option value={100}>100+ games</option>
							<option value={10}>10+ games</option>
						</select>
					</div>
					<p class="gap-rating-note">Popularity based on Lichess games in the {data.gapRatingLabel} range.</p>
					<ul class="gap-list">
						{#each data.gaps.slice(0, 5) as gap (gap.toFen)}
							<li class="gap-item">
								<div class="gap-info">
									<span class="gap-line">{formatLine(gap.line)}</span>
									{#if gap.popularityPct !== undefined && gap.gamesPlayed !== undefined}
										<span class="gap-popularity"
											>Played {gap.popularityPct.toFixed(0)}% of the time ({gap.gamesPlayed.toLocaleString()}
											games)</span
										>
									{/if}
								</div>
								<a href="{base}/build?line={encodeURIComponent(gap.line)}" class="gap-link">
									Build
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<div class="widget widget-wide gap-covered">
					<div class="widget-label">
						Gap Finder
						<select class="gap-threshold" value={gapMinGames} onchange={updateGapThreshold}>
							<option value={10000}>10,000+ games</option>
							<option value={1000}>1,000+ games</option>
							<option value={100}>100+ games</option>
							<option value={10}>10+ games</option>
						</select>
					</div>
					<p class="gap-rating-note">Popularity based on Lichess games in the {data.gapRatingLabel} range.</p>
					<p>No gaps — repertoire fully covered</p>
				</div>
			{/if}

			<!-- Trouble Spots -->
			{#if data.troubleSpots.length > 0}
				<div class="widget widget-wide">
					<div class="widget-label">Trouble Spots</div>
					<ul class="trouble-list">
						{#each data.troubleSpots as spot (spot.fromFen + spot.san)}
							<li class="trouble-item">
								<span class="trouble-move">{spot.san}</span>
								<span class="trouble-fen">{spot.fromFen.split(' ')[0].slice(0, 20)}…</span>
								<span class="trouble-lapses">{spot.lapses} lapses</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-body);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	/* ── Widget Grid ──────────────────────────────────────────────────── */

	.page-wrapper {
		max-width: 840px;
		margin: 0 auto;
	}

	.widget-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-3);
	}

	@media (min-width: 480px) {
		.widget-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.widget {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		overflow: hidden;
		box-shadow: var(--shadow-surface);
		transition:
			border-color var(--dur-base) var(--ease-snap),
			box-shadow var(--dur-base) var(--ease-snap);
	}

	.widget-wide {
		grid-column: 1 / -1;
	}

	.widget-link {
		text-decoration: none;
		color: inherit;
		cursor: pointer;
	}

	.widget-link:hover {
		border-color: var(--color-border-strong);
		box-shadow: var(--glow-accent);
	}

	.widget-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.widget-value {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.widget-denom {
		font-size: 1rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.widget-unit {
		font-size: 1rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.widget-hint {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.widget-empty {
		margin: var(--space-1) 0 0;
		color: var(--color-text-muted);
		font-size: 13px;
	}

	/* ── Due Now accent ───────────────────────────────────────────────── */

	.due-positive {
		color: var(--color-accent);
	}

	/* ── Mastered accent ──────────────────────────────────────────────── */

	.mastered-value {
		color: var(--color-success);
	}

	/* ── Streak accent ────────────────────────────────────────────────── */

	.streak-value {
		color: var(--color-accent-dim);
	}

	/* ── Next Review accent ───────────────────────────────────────────── */

	.next-value {
		color: var(--color-text-secondary);
	}

	/* ── Health Score accent ──────────────────────────────────────────── */

	.health-green {
		color: var(--color-success);
	}

	.health-yellow {
		color: var(--color-accent-dim);
	}

	.health-red {
		color: var(--color-danger);
	}

	.health-action {
		color: inherit;
		text-decoration: none;
	}

	.health-action:hover {
		text-decoration: underline;
	}

	/* ── Card State Breakdown ─────────────────────────────────────────── */

	.state-bar {
		display: flex;
		height: 20px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-top: var(--space-2);
	}

	.state-segment {
		min-width: 4px;
		transition: width var(--dur-slow);
	}

	.state-new {
		background: var(--color-accent);
	}

	.state-learning {
		background: var(--color-accent-dim);
	}

	.state-review {
		background: var(--color-success);
	}

	.state-relearning {
		background: var(--color-danger);
	}

	.state-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-2);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* ── Shared legend dots ───────────────────────────────────────────── */

	.legend-item {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.legend-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	/* ── Accuracy Trend ───────────────────────────────────────────────── */

	.trend-row {
		display: flex;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}

	.trend-block {
		width: 28px;
		height: 28px;
		border-radius: 3px;
	}

	.acc-green {
		background: var(--color-success);
	}

	.acc-yellow {
		background: var(--color-accent-dim);
	}

	.acc-red {
		background: var(--color-danger);
	}

	.trend-legend {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-2);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* ── Gap Finder ───────────────────────────────────────────────────── */

	.gap-threshold {
		margin-left: auto;
		padding: 2px 4px;
		font-size: 11px;
		background: var(--color-surface-alt);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.gap-rating-note {
		margin: 2px 0 var(--space-2);
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.gap-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		border-radius: 10px;
		background: var(--color-accent);
		color: var(--color-base);
		font-weight: 700;
		font-size: 11px;
		padding: 0 5px;
	}

	.gap-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.gap-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.gap-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.gap-line {
		color: var(--color-text-secondary);
	}

	.gap-popularity {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	.gap-link {
		color: var(--color-accent);
		text-decoration: none;
		font-size: 12px;
		white-space: nowrap;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.gap-link:hover {
		color: var(--color-text-primary);
	}

	.gap-covered p {
		margin: var(--space-1) 0 0;
		color: var(--color-success);
		font-size: 13px;
	}

	/* ── Trouble Spots ────────────────────────────────────────────────── */

	.trouble-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.trouble-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.trouble-move {
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.trouble-fen {
		color: var(--color-text-muted);
		font-size: 11px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trouble-lapses {
		color: var(--color-danger);
		font-size: 12px;
		white-space: nowrap;
	}

	/* ── Puzzle Goal ──────────────────────────────────────────────────── */

	.goal-met {
		color: var(--color-success);
	}

	.goal-progress {
		color: var(--color-accent);
	}

	.goal-bar {
		height: 6px;
		background: var(--color-surface-alt);
		border-radius: 3px;
		overflow: hidden;
		margin-top: var(--space-1);
	}

	.goal-bar-fill {
		height: 100%;
		background: var(--color-accent);
		border-radius: 3px;
		transition: width var(--dur-slow);
		min-width: 2px;
	}

	.goal-bar-complete {
		background: var(--color-success);
	}

	.goal-link {
		font-size: 12px;
		color: var(--color-accent);
		text-decoration: none;
		margin-top: var(--space-1);
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.goal-link:hover {
		color: var(--color-text-primary);
	}

	.goal-complete-hint {
		color: var(--color-success);
	}

	.goal-setup {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
		min-width: 0;
	}

	.goal-form-row {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		min-width: 0;
	}

	.goal-input {
		min-width: 40px;
		flex: 0 1 45px;
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-1);
		font-family: var(--font-body);
		font-size: 0.8rem;
	}

	.goal-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.goal-freq-select {
		min-width: 0;
		flex: 1 1 auto;
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-1);
		font-family: var(--font-body);
		font-size: 0.8rem;
	}

	.goal-form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
	}

	.goal-save-btn {
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.goal-save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.goal-clear-btn {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-body);
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.goal-clear-btn:hover {
		color: var(--color-text-secondary);
		border-color: var(--color-text-muted);
	}

	.goal-edit-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.7rem;
		cursor: pointer;
		padding: 0;
		margin-top: var(--space-1);
		font-family: var(--font-body);
	}

	.goal-edit-btn:hover {
		color: var(--color-text-secondary);
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.page-wrapper {
			padding: 0;
		}

		.widget-grid {
			grid-template-columns: 1fr;
			gap: var(--space-2);
		}

		.widget {
			padding: var(--space-3);
		}
	}
</style>
