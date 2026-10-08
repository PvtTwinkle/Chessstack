<!--
	A labelled range slider on the Settings page. The value, debounced save and
	"Saved" status all live in the SliderSetting it is given; hint text goes in
	the children.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SliderSetting } from './settingsState.svelte';

	let {
		id,
		label,
		display,
		min,
		max,
		step,
		minLabel,
		maxLabel,
		setting,
		children
	}: {
		id: string;
		label: string;
		/** The current value as shown after the label, e.g. "10s". */
		display: string;
		min: number | string;
		max: number | string;
		step: number | string;
		minLabel: string;
		maxLabel: string;
		setting: SliderSetting;
		children?: Snippet;
	} = $props();
</script>

<div class="setting-row">
	<label class="setting-label" for={id}>
		{label}: <strong>{display}</strong>
	</label>
	<div class="slider-wrap">
		<span class="slider-label">{minLabel}</span>
		<input
			{id}
			type="range"
			{min}
			{max}
			{step}
			value={setting.value}
			oninput={setting.handleInput}
		/>
		<span class="slider-label">{maxLabel}</span>
	</div>
	{@render children?.()}
	{#if setting.status}
		<span class="status-msg">{setting.status}</span>
	{/if}
</div>

<style>
	.slider-wrap {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.slider-label {
		font-size: 12px;
		color: var(--color-text-muted);
		min-width: 2em;
		text-align: center;
	}

	input[type='range'] {
		flex: 1;
		accent-color: var(--color-accent);
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.slider-wrap {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
