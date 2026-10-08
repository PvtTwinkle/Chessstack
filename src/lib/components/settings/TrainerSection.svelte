<!--
	Settings → Opening Trainer: the trainer Elo rating.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import type { SettingsState } from './settingsState.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Opening Trainer">
	<div class="setting-row">
		<label class="setting-label" for="trainer-rating">Trainer Rating</label>
		<div class="username-input-row">
			<input
				id="trainer-rating"
				type="number"
				min="100"
				max="3000"
				placeholder="1200"
				bind:value={settings.trainerRatingInput}
				class="username-input"
				style="width: 100px"
			/>
			<button
				class="btn-save"
				onclick={settings.saveTrainerRating}
				disabled={settings.savingTrainerRating}
			>
				{settings.savingTrainerRating ? 'Saving...' : 'Save'}
			</button>
		</div>
		<p class="setting-hint">
			Your opening trainer Elo rating (100-3000). Updates automatically after rated training
			sessions.
		</p>
		{#if settings.trainerRatingStatus}
			<span class="status-msg">{settings.trainerRatingStatus}</span>
		{/if}
	</div>
</SettingsSection>
