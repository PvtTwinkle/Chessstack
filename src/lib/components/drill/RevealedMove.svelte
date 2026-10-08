<!--
	Drill → the correct move, revealed after a wrong answer.
-->
<script lang="ts">
	let { san }: { san: string } = $props();
</script>

<div class="section">
	<div class="section-label">CORRECT MOVE</div>
	<div class="revealed-move">{san}</div>
</div>

<style>
	/* ── Revealed correct move ────────────────────────────────────────────────── */

	.revealed-move {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--color-accent);
		padding: 0.3rem 0;
	}
</style>
