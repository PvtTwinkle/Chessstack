<script lang="ts">
	import type { GapStatus } from './prepState.svelte';

	let { status }: { status: GapStatus } = $props();

	const LABELS: Record<GapStatus, string> = {
		green: 'Prepared',
		yellow: 'Covered by your repertoire',
		red: 'Not prepared'
	};
</script>

<!-- The colour alone carries the status, so screen readers get it as words. -->
<span
	class="gap-dot"
	class:green={status === 'green'}
	class:yellow={status === 'yellow'}
	class:red={status === 'red'}
	title={LABELS[status]}
></span>
<span class="visually-hidden">{LABELS[status]}</span>

<style>
	.gap-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.gap-dot.green {
		background: var(--color-eval-good);
	}

	.gap-dot.yellow {
		background: var(--color-eval-inaccuracy);
	}

	.gap-dot.red {
		background: var(--color-eval-blunder);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
