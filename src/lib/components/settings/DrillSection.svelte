<!--
	Settings → Drill: tempo training, playback speed and the FSRS scheduling
	parameters.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import SettingSlider from './SettingSlider.svelte';
	import SettingToggle from './SettingToggle.svelte';
	import { formatMaxInterval, type SettingsState } from './settingsState.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Drill">
	<SettingToggle label="Tempo Training" setting={settings.tempo}>
		<p class="setting-hint">
			Set a time limit per move during drill sessions. If you don't play in time, the card is marked
			as Forgot.
		</p>
	</SettingToggle>

	{#if settings.tempo.value}
		<SettingSlider
			id="tempo-slider"
			label="Time Limit"
			display="{settings.tempoSeconds.value}s"
			min="3"
			max="30"
			step="1"
			minLabel="3s"
			maxLabel="30s"
			setting={settings.tempoSeconds}
		>
			<p class="setting-hint">Seconds per move. Shorter times make drills more challenging.</p>
		</SettingSlider>
	{/if}

	<SettingSlider
		id="playback-slider"
		label="Playback Speed"
		display="{settings.playbackSpeed.value}ms"
		min="200"
		max="2000"
		step="50"
		minLabel="Fast"
		maxLabel="Slow"
		setting={settings.playbackSpeed}
	>
		<p class="setting-hint">Delay between auto-played moves in drill and review modes.</p>
	</SettingSlider>

	<SettingSlider
		id="retention-slider"
		label="Desired Retention"
		display="{Math.round(settings.fsrsRetention.value * 100)}%"
		min="0.70"
		max="0.97"
		step="0.01"
		minLabel="70%"
		maxLabel="97%"
		setting={settings.fsrsRetention}
	>
		<p class="setting-hint">
			How aggressively cards are scheduled for review. At 90% (recommended), a card you've practiced
			a few times might come back in about 10 days. At 95%, that same card comes back in 5 days. At
			80%, it might wait nearly a month. The exact timing always shows on each grade button during
			drill.
			<a
				href="https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS"
				target="_blank"
				rel="noopener noreferrer"
				class="hint-link"
			>
				Learn how FSRS works
			</a>
		</p>
	</SettingSlider>

	<SettingSlider
		id="max-interval-slider"
		label="Maximum Interval"
		display={formatMaxInterval(settings.fsrsMaxInterval.value)}
		min="30"
		max="3650"
		step="5"
		minLabel="30d"
		maxLabel="10yr"
		setting={settings.fsrsMaxInterval}
	>
		<p class="setting-hint">
			The longest a card can go between reviews, no matter how well you know it. Keeps well-known
			lines from disappearing entirely.
		</p>
	</SettingSlider>

	<SettingSlider
		id="relearning-slider"
		label="Relearning Delay"
		display="{settings.fsrsRelearningMinutes.value} min"
		min="1"
		max="60"
		step="1"
		minLabel="1m"
		maxLabel="60m"
		setting={settings.fsrsRelearningMinutes}
	>
		<p class="setting-hint">
			When you forget a card, how long before it comes back. Shorter means more immediate
			reinforcement.
		</p>
	</SettingSlider>
</SettingsSection>

<style>
	.hint-link {
		display: inline-block;
		margin-top: 2px;
		color: var(--color-accent);
		text-decoration: none;
		font-size: 11px;
	}

	.hint-link:hover {
		text-decoration: underline;
	}
</style>
