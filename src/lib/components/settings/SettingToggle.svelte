<!--
	A labelled On/Off button on the Settings page, backed by a ToggleSetting.
	Hint text goes in the children.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ToggleSetting } from './settingsState.svelte';

	let {
		label,
		setting,
		children
	}: {
		label: string;
		setting: ToggleSetting;
		children?: Snippet;
	} = $props();
</script>

<div class="setting-row">
	<span class="setting-label">{label}</span>
	<button class="toggle-btn" class:active={setting.value} onclick={setting.toggle}>
		{setting.value ? 'On' : 'Off'}
	</button>
	{@render children?.()}
</div>

<style>
	.toggle-btn {
		padding: var(--space-2) var(--space-4);
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.toggle-btn.active {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border-color: rgba(74, 222, 128, 0.3);
	}

	/* ── Tablets and phones (< 768px) ── --bp-md */
	@media (max-width: 767px) {
		.toggle-btn {
			min-height: 44px;
		}
	}
</style>
