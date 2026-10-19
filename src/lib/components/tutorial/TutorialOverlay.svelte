<!--
	TutorialOverlay.svelte
	──────────────────────
	Fixed bottom-right floating card that guides first-time users through
	the app. Rendered from +layout.svelte so it persists across pages.

	Not a modal — does not block interaction with the page.
	The user can click the board, sidebar, etc. while this is visible.
-->

<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tutorial } from '$lib/stores/tutorial.svelte';
	import { TUTORIAL_STEPS, TOTAL_STEPS } from './tutorialSteps';

	// ── Derived state ────────────────────────────────────────────────────────
	let step = $derived(tutorial.step);
	let stepDef = $derived(step !== null ? (TUTORIAL_STEPS[step] ?? null) : null);
	let visible = $derived(stepDef !== null && step !== 0); // step 0 = OnboardingWelcome handles it

	// Check if user is on the correct page for the current step
	let onCorrectPage = $derived.by(() => {
		if (!stepDef) return true;
		const path = page.url.pathname;
		if (stepDef.page === '/') return path === '/';
		return path.startsWith(stepDef.page);
	});

	let dismissed = $state(false);
	let busy = $state(false);

	// Reset dismissed state when step changes
	$effect(() => {
		// Read step to create dependency
		void step;
		dismissed = false;
	});

	// ── Actions ──────────────────────────────────────────────────────────────

	async function skipTutorial() {
		if (busy) return;
		busy = true;
		try {
			await tutorial.goTo(null);
		} finally {
			busy = false;
		}
	}

	async function handleNext() {
		if (!stepDef || busy) return;
		busy = true;

		// Capture the step before the await: goTo() moves the shared step on,
		// so reading step or stepDef afterwards would see the new values.
		const destination = stepDef.navTo;
		const currentStep = step;

		try {
			if (destination) {
				const nextStep =
					currentStep !== null && currentStep < TOTAL_STEPS - 1 ? currentStep + 1 : null;
				// Saved before navigating, so the next page's data has the new step.
				await tutorial.goTo(nextStep);
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic path from tutorial step definitions
				await goto(destination);
			} else if (currentStep === TOTAL_STEPS - 1) {
				// Last step — finish tutorial
				await tutorial.goTo(null);
			} else if (currentStep !== null) {
				await tutorial.goTo(currentStep + 1);
			}
		} finally {
			busy = false;
		}
	}

	async function navigateToCorrectPage() {
		if (stepDef?.page) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- static paths from tutorial step definitions
			await goto(stepDef.page);
		}
	}
</script>

{#if visible && !dismissed}
	<div class="tutorial-overlay" role="status" aria-label="Tutorial" aria-live="polite">
		<div class="tutorial-card">
			<!-- Header with step indicator -->
			<div class="tutorial-header">
				<span class="step-badge">
					{step} / {TOTAL_STEPS - 1}
				</span>
				<button class="btn-dismiss" onclick={() => (dismissed = true)} title="Minimize">
					&minus;
				</button>
			</div>

			{#if !onCorrectPage}
				<!-- Wrong page prompt -->
				<h3 class="tutorial-title">Continue Tutorial</h3>
				<p class="tutorial-body">
					Go to the {stepDef?.pageLabel} page to continue the tutorial.
				</p>
				<div class="tutorial-actions">
					<button class="btn-nav" onclick={navigateToCorrectPage}>
						Go to {stepDef?.pageLabel}
					</button>
					<button class="btn-skip" onclick={skipTutorial} disabled={busy}>Skip Tutorial</button>
				</div>
			{:else}
				<!-- Current step content -->
				<h3 class="tutorial-title">{stepDef?.title}</h3>
				<p class="tutorial-body">{stepDef?.body}</p>

				<!-- Step dots -->
				<div class="step-dots" role="group" aria-label="Tutorial progress">
					{#each Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => i) as i (i)}
						<span
							class="dot"
							class:active={i + 1 === step}
							class:completed={step !== null && i + 1 < step}
							aria-label="Step {i + 1}{i + 1 === step
								? ', current'
								: step !== null && i + 1 < step
									? ', completed'
									: ''}"
						></span>
					{/each}
				</div>

				<div class="tutorial-actions">
					{#if stepDef?.nextLabel}
						<button class="btn-next" onclick={handleNext} disabled={busy}>
							{stepDef.nextLabel}
						</button>
					{/if}
					<button class="btn-skip" onclick={skipTutorial} disabled={busy}>Skip Tutorial</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if visible && dismissed}
	<!-- Minimized pill to reopen -->
	<button class="tutorial-pill" onclick={() => (dismissed = false)}>
		Tutorial ({step}/{TOTAL_STEPS - 1})
	</button>
{/if}

<style>
	/* ── Floating card (bottom-right) ──────────────────────────────────────── */

	.tutorial-overlay {
		position: fixed;
		bottom: var(--space-6);
		right: var(--space-6);
		z-index: 1100;
		max-width: 240px;
		width: calc(100vw - var(--space-8));
		animation: slideUp var(--dur-slow) var(--ease-spring);
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.tutorial-card {
		background: var(--color-surface);
		border: 1px solid var(--color-accent-dim);
		border-radius: var(--radius-xl);
		padding: var(--space-5) var(--space-6);
		box-shadow:
			var(--shadow-elevated),
			0 0 20px rgba(74, 138, 194, 0.12);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* ── Header ────────────────────────────────────────────────────────────── */

	.tutorial-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.step-badge {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-accent);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.btn-dismiss {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 18px;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		line-height: 1;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.btn-dismiss:hover {
		color: var(--color-text-secondary);
	}

	/* ── Content ───────────────────────────────────────────────────────────── */

	.tutorial-title {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.tutorial-body {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.6;
	}

	/* ── Step dots ─────────────────────────────────────────────────────────── */

	.step-dots {
		display: flex;
		gap: 6px;
		justify-content: center;
		padding: var(--space-1) 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-border-strong);
		transition: background var(--dur-base) var(--ease-snap);
	}

	.dot.active {
		background: var(--color-accent);
	}

	.dot.completed {
		background: var(--color-accent-dim);
	}

	/* ── Actions ───────────────────────────────────────────────────────────── */

	.tutorial-actions {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}

	.btn-next,
	.btn-nav {
		padding: var(--space-2) var(--space-5);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-md);
		color: var(--color-base);
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			box-shadow var(--dur-fast) var(--ease-snap);
	}

	.btn-next:hover,
	.btn-nav:hover {
		border-color: var(--color-border-strong);
		box-shadow: var(--glow-accent);
	}

	.btn-skip {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		padding: var(--space-1) var(--space-2);
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.btn-skip:hover {
		color: var(--color-text-secondary);
	}

	/* ── Minimized pill ────────────────────────────────────────────────────── */

	.tutorial-pill {
		position: fixed;
		bottom: var(--space-6);
		right: var(--space-6);
		z-index: 1100;
		padding: var(--space-2) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-accent-dim);
		border-radius: var(--radius-lg);
		color: var(--color-accent);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		box-shadow: var(--shadow-elevated);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			box-shadow var(--dur-fast) var(--ease-snap);
	}

	.tutorial-pill:hover {
		border-color: var(--color-accent);
		box-shadow: var(--glow-accent);
	}

	/* ── Mobile ────────────────────────────────────────────────────────────── */

	@media (max-width: 479px) {
		.tutorial-overlay {
			bottom: var(--space-3);
			right: var(--space-3);
			max-width: calc(100vw - var(--space-6));
		}

		.tutorial-pill {
			bottom: var(--space-3);
			right: var(--space-3);
		}
	}
</style>
