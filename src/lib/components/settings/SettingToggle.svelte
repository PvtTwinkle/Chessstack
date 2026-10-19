<!--
	A labelled On/Off button on the Settings page, backed by a ToggleSetting.
	Hint text goes in the children.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ToggleSetting } from './settingsState.svelte';
	import StatusMessage from './StatusMessage.svelte';

	let {
		label,
		setting,
		children
	}: {
		label: string;
		setting: ToggleSetting;
		children?: Snippet;
	} = $props();

	const labelId = $props.id();
</script>

<div class="setting-row">
	<span class="setting-label" id={labelId}>{label}</span>
	<!-- Named by the label and its own On/Off text, with the state in
	     aria-pressed, so it reads as "Sound Effects On, toggle button, pressed"
	     rather than just "On". The visible text has to be part of the name
	     (WCAG 2.5.3, Label in Name) for voice control users. -->
	<button
		id="{labelId}-btn"
		class="toggle-btn"
		class:active={setting.value}
		aria-labelledby="{labelId} {labelId}-btn"
		aria-pressed={setting.value}
		onclick={setting.toggle}
	>
		{setting.value ? 'On' : 'Off'}
	</button>
	{@render children?.()}
	<StatusMessage status={setting.status} />
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
