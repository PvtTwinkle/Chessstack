<!--
	Settings → Tutorial: replay the first-time guided walkthrough.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import type { SettingsState } from './settingsState.svelte';
	import StatusMessage from './StatusMessage.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Tutorial">
	<div class="setting-row">
		<span class="setting-label">Guided Walkthrough</span>
		<p class="setting-hint">
			Replay the first-time tutorial that walks through Build, Drill, Train, Puzzles, Review, Prep,
			and the Dashboard.
		</p>
		<button
			class="btn-primary"
			onclick={settings.restartTutorial}
			disabled={settings.restartingTutorial}
		>
			{settings.restartingTutorial ? 'Restarting...' : 'Restart Tutorial'}
		</button>
		<StatusMessage status={settings.tutorialStatus} />
	</div>
</SettingsSection>
