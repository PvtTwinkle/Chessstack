<!--
	Settings → Tutorial: replay the first-time guided walkthrough.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import type { SettingsState } from './settingsState.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Tutorial">
	<div class="setting-row">
		<span class="setting-label">Guided Walkthrough</span>
		<p class="setting-hint">
			Replay the first-time tutorial that walks through Build, Drill, Puzzles, Review, Prep, and
			Dashboard.
		</p>
		<button
			class="btn-primary"
			onclick={settings.restartTutorial}
			disabled={settings.restartingTutorial}
		>
			{settings.restartingTutorial ? 'Restarting...' : 'Restart Tutorial'}
		</button>
	</div>
</SettingsSection>
