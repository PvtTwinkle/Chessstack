<!--
	Settings → Game Import: the Lichess and Chess.com usernames games are
	imported from.
-->
<script lang="ts">
	import SettingsSection from './SettingsSection.svelte';
	import type { SettingsState, UsernameSetting } from './settingsState.svelte';

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
		<div class="username-input-row">
			<input
				{id}
				type="text"
				{placeholder}
				bind:value={setting.value}
				maxlength="25"
				class="username-input"
			/>
			<button class="btn-save" onclick={setting.save} disabled={setting.saving}>
				{setting.saving ? 'Saving...' : 'Save'}
			</button>
		</div>
		<p class="setting-hint">{hint}</p>
		{#if setting.status}
			<span class="status-msg">{setting.status}</span>
		{/if}
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
