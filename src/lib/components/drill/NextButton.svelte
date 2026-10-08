<!--
	Drill → the primary "Next" / "Next Line" button with its Space shortcut hint.
-->
<script lang="ts">
	// Imported here so the shared .btn rules load before this component's
	// overrides (display: flex beats .btn's display: block).
	import './drill-ui.css';

	let { label = 'Next', onclick }: { label?: string; onclick: () => void } = $props();
</script>

<button class="btn btn--primary next-btn" {onclick}>
	{label} <kbd>Space</kbd>
</button>

<style>
	.next-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		flex: 1;
	}

	.next-btn kbd {
		font-size: 0.6rem;
		opacity: 0.5;
	}
</style>
