<!--
	Drill → the user's note for a move or position.
-->
<script lang="ts">
	let { text }: { text: string } = $props();
</script>

<div class="note-box">
	<div class="note-label">NOTE</div>
	<div class="note-text">{text}</div>
</div>

<style>
	/* ── Note box (annotations) ──────────────────────────────────────────────── */

	.note-box {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border-left: 3px solid var(--color-accent);
		background: var(--color-accent-glow);
	}

	.note-label {
		font-size: 0.6rem;
		font-family: var(--font-body);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--color-accent);
		text-transform: uppercase;
	}

	.note-text {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		line-height: 1.45;
		font-style: italic;
		white-space: pre-wrap;
	}
</style>
