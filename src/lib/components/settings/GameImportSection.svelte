<!--
	Settings → Game Import: the Lichess and Chess.com usernames games are
	imported from.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import type { SettingsState, UsernameSetting } from './settingsState.svelte';
	import { PLATFORM_USERNAME_MAX_LENGTH } from '$lib/validation-limits';
	import StatusMessage from './StatusMessage.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

{#snippet usernameRow(
	id: string,
	label: string,
	placeholder: string,
	hint: string,
	setting: UsernameSetting
)}
	<div class="setting-row">
		<label class="setting-label" for={id}>{label}</label>
		<form
			class="username-input-row"
			onsubmit={(e) => {
				e.preventDefault();
				setting.save();
			}}
		>
			<input
				{id}
				type="text"
				{placeholder}
				bind:value={setting.value}
				maxlength={PLATFORM_USERNAME_MAX_LENGTH}
				class="username-input"
			/>
			<button type="submit" class="btn-save" disabled={setting.saving}>
				{setting.saving ? 'Saving...' : 'Save'}
			</button>
		</form>
		<p class="setting-hint">{hint}</p>
		<StatusMessage status={setting.status} />
	</div>
{/snippet}

<SettingsSection title="Game Import">
	{@render usernameRow(
		'lichess-username',
		'Lichess Username',
		'your_lichess_username',
		'Your Lichess username. Games must be public for import to work.',
		settings.lichessUsername
	)}
	{@render usernameRow(
		'chesscom-username',
		'Chess.com Username',
		'your_chesscom_username',
		'Your Chess.com username. Only standard chess games are imported.',
		settings.chesscomUsername
	)}
</SettingsSection>
