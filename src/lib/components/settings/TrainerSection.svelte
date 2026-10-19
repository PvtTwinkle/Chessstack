<!--
	Settings → Opening Trainer: the trainer Elo rating.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import type { SettingsState } from './settingsState.svelte';
	import { TRAINER_RATING_RANGE } from '$lib/validation-limits';
	import StatusMessage from './StatusMessage.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Opening Trainer">
	<div class="setting-row">
		<label class="setting-label" for="trainer-rating">Trainer Rating</label>
		<form
			class="username-input-row"
			onsubmit={(e) => {
				e.preventDefault();
				settings.saveTrainerRating();
			}}
		>
			<input
				id="trainer-rating"
				type="number"
				min={TRAINER_RATING_RANGE.min}
				max={TRAINER_RATING_RANGE.max}
				placeholder="1200"
				bind:value={settings.trainerRatingInput}
				class="username-input"
				style="width: 100px"
			/>
			<button type="submit" class="btn-save" disabled={settings.savingTrainerRating}>
				{settings.savingTrainerRating ? 'Saving...' : 'Save'}
			</button>
		</form>
		<p class="setting-hint">
			Your opening trainer Elo rating ({TRAINER_RATING_RANGE.min}-{TRAINER_RATING_RANGE.max}).
			Updates automatically after rated training sessions.
		</p>
		<StatusMessage status={settings.trainerRatingStatus} />
	</div>
</SettingsSection>
