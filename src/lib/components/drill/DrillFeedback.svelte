<!--
	Drill → the green ✓ / red ✗ result banner.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { correct, children }: { correct: boolean; children: Snippet } = $props();
</script>

<div class="feedback" class:feedback--correct={correct} class:feedback--incorrect={!correct}>
	<span class="feedback-icon">{correct ? '✓' : '✗'}</span>
	{@render children()}
</div>

<style>
	.feedback {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-3);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		font-weight: 600;
		box-shadow: var(--shadow-surface);
	}

	.feedback--correct {
		background: rgba(74, 222, 128, 0.12);
		border: 1px solid rgba(74, 222, 128, 0.35);
		color: var(--color-success);
	}

	.feedback--incorrect {
		background: rgba(248, 113, 113, 0.12);
		border: 1px solid rgba(248, 113, 113, 0.35);
		color: var(--color-danger);
	}

	.feedback-icon {
		font-size: 1.1rem;
	}
</style>
