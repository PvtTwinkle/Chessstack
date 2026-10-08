<!--
	Settings → Analysis: Stockfish search depth and timeout.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import SettingSlider from './SettingSlider.svelte';
	import type { SettingsState } from './settingsState.svelte';
	import { MAX_STOCKFISH_DEPTH, MIN_STOCKFISH_DEPTH } from '$lib/validation-limits';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Analysis">
	<SettingSlider
		id="depth-slider"
		label="Stockfish Depth"
		display={String(settings.stockfishDepth.value)}
		min={MIN_STOCKFISH_DEPTH}
		max={MAX_STOCKFISH_DEPTH}
		step="1"
		minLabel={String(MIN_STOCKFISH_DEPTH)}
		maxLabel={String(MAX_STOCKFISH_DEPTH)}
		setting={settings.stockfishDepth}
	>
		<p class="setting-hint">Higher = stronger analysis but slower. 20 is a good default.</p>
	</SettingSlider>

	<SettingSlider
		id="timeout-slider"
		label="Analysis Timeout"
		display="{settings.stockfishTimeout.value}s"
		min="3"
		max="30"
		step="1"
		minLabel="3s"
		maxLabel="30s"
		setting={settings.stockfishTimeout}
	>
		<p class="setting-hint">
			Max time to wait for engine results. Increase for deeper analysis at higher depths.
		</p>
	</SettingSlider>
</SettingsSection>
