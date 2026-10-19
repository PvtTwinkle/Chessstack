<!--
	Settings → Drill: tempo training, playback speed and the FSRS scheduling
	parameters.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import SettingSlider from './SettingSlider.svelte';
	import SettingToggle from './SettingToggle.svelte';
	import { formatMaxInterval, type SettingsState } from './settingsState.svelte';
	import {
		FSRS_MAX_INTERVAL_RANGE,
		FSRS_RELEARNING_RANGE,
		FSRS_RETENTION_RANGE,
		PLAYBACK_SPEED_RANGE,
		TEMPO_SECONDS_RANGE
	} from '$lib/validation-limits';

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
			min={TEMPO_SECONDS_RANGE.min}
			max={TEMPO_SECONDS_RANGE.max}
			step="1"
			minLabel="{TEMPO_SECONDS_RANGE.min}s"
			maxLabel="{TEMPO_SECONDS_RANGE.max}s"
			setting={settings.tempoSeconds}
		>
			<p class="setting-hint">Seconds per move. Shorter times make drills more challenging.</p>
		</SettingSlider>
	{/if}

	<SettingSlider
		id="playback-slider"
		label="Playback Speed"
		display="{settings.playbackSpeed.value}ms"
		min={PLAYBACK_SPEED_RANGE.min}
		max={PLAYBACK_SPEED_RANGE.max}
		step={PLAYBACK_SPEED_RANGE.step}
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
		min={FSRS_RETENTION_RANGE.min}
		max={FSRS_RETENTION_RANGE.max}
		step={FSRS_RETENTION_RANGE.step}
		minLabel="{Math.round(FSRS_RETENTION_RANGE.min * 100)}%"
		maxLabel="{Math.round(FSRS_RETENTION_RANGE.max * 100)}%"
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
		min={FSRS_MAX_INTERVAL_RANGE.min}
		max={FSRS_MAX_INTERVAL_RANGE.max}
		step={FSRS_MAX_INTERVAL_RANGE.step}
		minLabel="{FSRS_MAX_INTERVAL_RANGE.min}d"
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
		min={FSRS_RELEARNING_RANGE.min}
		max={FSRS_RELEARNING_RANGE.max}
		step="1"
		minLabel="{FSRS_RELEARNING_RANGE.min}m"
		maxLabel="{FSRS_RELEARNING_RANGE.max}m"
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
