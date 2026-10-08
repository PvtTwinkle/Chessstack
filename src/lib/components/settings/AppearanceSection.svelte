<!--
	Settings → Board Appearance: app theme, board theme with a live preview,
	and sound effects.
-->
<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingToggle from './SettingToggle.svelte';
	import { BOARD_THEMES, type SettingsState } from './settingsState.svelte';

	let { settings }: { settings: SettingsState } = $props();
</script>

<SettingsSection title="Board Appearance">
	<div class="setting-row">
		<span class="setting-label">App Theme</span>
		<div class="theme-mode-picker">
			<button
				class="mode-btn"
				class:selected={settings.appTheme === 'dark'}
				onclick={() => settings.setAppTheme('dark')}
			>
				Dark
			</button>
			<button
				class="mode-btn"
				class:selected={settings.appTheme === 'light'}
				onclick={() => settings.setAppTheme('light')}
			>
				Light
			</button>
		</div>
	</div>

	<div class="setting-row">
		<span class="setting-label">Board Theme</span>
		<div class="theme-picker">
			{#each BOARD_THEMES as theme (theme.name)}
				<button
					class="theme-swatch"
					class:selected={settings.boardTheme === theme.name}
					title={theme.label}
					onclick={() => settings.setBoardTheme(theme.name)}
				>
					<span class="swatch-light" style="background:{theme.light}"></span>
					<span class="swatch-dark" style="background:{theme.dark}"></span>
					<span class="swatch-label">{theme.label}</span>
				</button>
			{/each}
		</div>
		{#if settings.boardThemeStatus}
			<span class="status-msg">{settings.boardThemeStatus}</span>
		{/if}
	</div>

	<!-- Board preview -->
	<div class="board-preview">
		<ChessBoard boardTheme={settings.boardTheme} interactive={false} />
	</div>

	<SettingToggle label="Sound Effects" setting={settings.sound} />
</SettingsSection>

<style>
	/* ── App theme mode picker ─────────────────────────────────────── */

	.theme-mode-picker {
		display: flex;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		width: fit-content;
	}

	.mode-btn {
		padding: var(--space-2) var(--space-5);
		border: none;
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.mode-btn:not(:last-child) {
		border-right: 1px solid var(--color-border);
	}

	.mode-btn:hover:not(.selected) {
		color: var(--color-text-secondary);
	}

	.mode-btn.selected {
		background: var(--color-accent);
		color: var(--color-base);
		font-weight: 600;
	}

	/* ── Theme picker ──────────────────────────────────────────────── */

	.theme-picker {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.theme-swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2);
		background: transparent;
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.theme-swatch:hover {
		border-color: var(--color-border);
	}

	.theme-swatch.selected {
		border-color: var(--color-accent);
	}

	.swatch-light,
	.swatch-dark {
		display: block;
		width: 28px;
		height: 14px;
	}

	.swatch-light {
		border-radius: 3px 3px 0 0;
	}

	.swatch-dark {
		border-radius: 0 0 3px 3px;
	}

	.swatch-label {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	/* ── Board preview ─────────────────────────────────────────────── */

	.board-preview {
		width: 240px;
		margin: var(--space-2) 0 var(--space-4);
		overflow: hidden;
		pointer-events: none;
		position: relative;
		z-index: 0;
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.board-preview {
			width: 100%;
			max-width: 240px;
		}
	}
</style>
