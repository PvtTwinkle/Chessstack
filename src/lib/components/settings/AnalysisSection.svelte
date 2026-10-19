<!--
	Settings → Analysis: Stockfish search depth and timeout.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import SettingSlider from './SettingSlider.svelte';
	import type { SettingsState } from './settingsState.svelte';
	import {
		DEFAULT_STOCKFISH_DEPTH,
		MAX_STOCKFISH_DEPTH,
		MIN_STOCKFISH_DEPTH,
		STOCKFISH_TIMEOUT_RANGE
	} from '$lib/validation-limits';

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
		<p class="setting-hint">
			Higher = stronger analysis but slower. {DEFAULT_STOCKFISH_DEPTH} is a good default.
		</p>
	</SettingSlider>

	<SettingSlider
		id="timeout-slider"
		label="Analysis Timeout"
		display="{settings.stockfishTimeout.value}s"
		min={STOCKFISH_TIMEOUT_RANGE.min}
		max={STOCKFISH_TIMEOUT_RANGE.max}
		step="1"
		minLabel="{STOCKFISH_TIMEOUT_RANGE.min}s"
		maxLabel="{STOCKFISH_TIMEOUT_RANGE.max}s"
		setting={settings.stockfishTimeout}
	>
		<p class="setting-hint">
			Max time to wait for engine results. Increase for deeper analysis at higher depths.
		</p>
	</SettingSlider>
</SettingsSection>
