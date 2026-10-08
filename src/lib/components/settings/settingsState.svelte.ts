/**
 * settingsState.svelte.ts — Svelte 5 runes module for the Settings page.
 *
 * All reactive state and save actions for the self-service settings live
 * here; the section components under $lib/components/settings render them.
 * The +page.svelte creates one instance with createSettingsState(), keeps it
 * in sync with the server through sync() in a $effect, and calls destroy()
 * when it unmounts.
 *
 * Most settings save optimistically: the control updates at once, the PATCH
 * goes to /api/settings, and the layout data is refreshed so other pages pick
 * up the change. Sliders debounce the save until the user stops dragging.
 */

import type { userSettings } from '$lib/db/schema';
import { validatePassword } from '$lib/auth/password';

type UserSettings = typeof userSettings.$inferSelect;

// The subset of the settings row this page reads. All optional so a missing
// row (or a test) falls back to the column defaults.
export type SettingsSnapshot = Partial<
	Pick<
		UserSettings,
		| 'appTheme'
		| 'boardTheme'
		| 'soundEnabled'
		| 'stockfishDepth'
		| 'stockfishTimeout'
		| 'tempoEnabled'
		| 'tempoSeconds'
		| 'playbackSpeed'
		| 'fsrsDesiredRetention'
		| 'fsrsMaximumInterval'
		| 'fsrsRelearningMinutes'
		| 'trainerRating'
		| 'lichessUsername'
		| 'chesscomUsername'
	>
>;

type SettingKey = keyof SettingsSnapshot;

export const BOARD_THEMES = [
	{ name: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
	{ name: 'blue', label: 'Blue', light: '#d0e2f0', dark: '#3a6d9e' },
	{ name: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
	{ name: 'purple', label: 'Purple', light: '#e8dff5', dark: '#7b61a6' },
	{ name: 'grey', label: 'Grey', light: '#cccccc', dark: '#888888' }
];

/** How long a slider waits after the last input before saving. */
export const SAVE_DEBOUNCE_MS = 400;
/** How long a "Saved" message stays on screen. */
export const STATUS_CLEAR_MS = 2000;

// Human-readable label for the max interval value.
export function formatMaxInterval(days: number): string {
	if (days < 60) return `${days} days`;
	if (days < 365) {
		const months = Math.round(days / 30);
		return `${days} days (~${months} month${months !== 1 ? 's' : ''})`;
	}
	const years = Math.round((days / 365) * 10) / 10;
	return `${days} days (~${years} year${years !== 1 ? 's' : ''})`;
}

function patchSettings(body: Record<string, unknown>): Promise<Response> {
	return fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

// What each setting class needs from its owner.
interface SettingContext {
	invalidateAll: () => Promise<void>;
	// setTimeout that is cleared when the page unmounts.
	later: (fn: () => void, ms: number) => void;
}

/** A numeric range input that saves itself once the user stops dragging. */
export class SliderSetting {
	value = $state(0);
	status = $state('');

	#key: SettingKey;
	#parse: (raw: string) => number;
	#ctx: SettingContext;
	#debounce: ReturnType<typeof setTimeout> | undefined;

	constructor(key: SettingKey, parse: (raw: string) => number, ctx: SettingContext) {
		this.#key = key;
		this.#parse = parse;
		this.#ctx = ctx;
	}

	handleInput = (e: Event) => {
		const value = this.#parse((e.target as HTMLInputElement).value);
		this.value = value;
		// Debounce: save after the user stops dragging
		clearTimeout(this.#debounce);
		this.#debounce = setTimeout(() => this.save(value), SAVE_DEBOUNCE_MS);
	};

	async save(value: number) {
		this.status = '';
		try {
			const res = await patchSettings({ [this.#key]: value });
			if (!res.ok) throw new Error('Failed to save');
			await this.#ctx.invalidateAll();
			this.status = 'Saved';
			this.#ctx.later(() => (this.status = ''), STATUS_CLEAR_MS);
		} catch {
			this.status = 'Error saving';
		}
	}

	cancel() {
		clearTimeout(this.#debounce);
	}
}

/** An On/Off button. Flips at once and flips back if the request fails. */
export class ToggleSetting {
	value = $state(false);

	#key: SettingKey;
	#ctx: SettingContext;

	constructor(key: SettingKey, ctx: SettingContext) {
		this.#key = key;
		this.#ctx = ctx;
	}

	toggle = async () => {
		this.value = !this.value;
		try {
			await patchSettings({ [this.#key]: this.value });
			await this.#ctx.invalidateAll();
		} catch {
			// Revert on failure
			this.value = !this.value;
		}
	};
}

/** A game-import username with its own Save button. Empty clears it. */
export class UsernameSetting {
	value = $state('');
	status = $state('');
	saving = $state(false);

	#key: SettingKey;
	#ctx: SettingContext;

	constructor(key: SettingKey, ctx: SettingContext) {
		this.#key = key;
		this.#ctx = ctx;
	}

	save = async () => {
		this.saving = true;
		this.status = '';
		try {
			const res = await patchSettings({ [this.#key]: this.value || null });
			if (!res.ok) throw new Error('Failed to save');
			await this.#ctx.invalidateAll();
			this.status = 'Saved';
			this.#ctx.later(() => (this.status = ''), STATUS_CLEAR_MS);
		} catch {
			this.status = 'Error saving';
		} finally {
			this.saving = false;
		}
	};
}

interface CreateSettingsStateParams {
	invalidateAll: () => Promise<void>;
	// Navigate to the Build page, where the tutorial starts.
	goToBuild: () => Promise<void>;
}

export function createSettingsState(params: CreateSettingsStateParams) {
	const { invalidateAll } = params;

	// Timer cleanup — track all setTimeout IDs so we can clear them on destroy.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive, used only for cleanup
	const timers = new Set<ReturnType<typeof setTimeout>>();
	function later(fn: () => void, ms: number) {
		const id = setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
	}

	const ctx: SettingContext = { invalidateAll, later };

	// ── App Theme (dark / light) ────────────────────────────────────────────
	let appTheme = $state('dark');

	async function setAppTheme(mode: string) {
		appTheme = mode;
		// Instant visual feedback — don't wait for the server round-trip
		document.documentElement.dataset.theme = mode;
		try {
			const res = await patchSettings({ appTheme: mode });
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
		} catch {
			// Revert on failure
			const prev = mode === 'dark' ? 'light' : 'dark';
			appTheme = prev;
			document.documentElement.dataset.theme = prev;
		}
	}

	// ── Board Theme ─────────────────────────────────────────────────────────
	let boardTheme = $state('blue');
	let boardThemeStatus = $state('');

	async function setBoardTheme(name: string) {
		boardTheme = name;
		boardThemeStatus = '';
		try {
			const res = await patchSettings({ boardTheme: name });
			if (!res.ok) throw new Error('Failed to save');
			// Refresh layout data so other pages pick up the new theme
			await invalidateAll();
			boardThemeStatus = 'Saved';
			later(() => (boardThemeStatus = ''), STATUS_CLEAR_MS);
		} catch {
			boardThemeStatus = 'Error saving';
		}
	}

	// ── Toggles and sliders ─────────────────────────────────────────────────
	const sound = new ToggleSetting('soundEnabled', ctx);
	const tempo = new ToggleSetting('tempoEnabled', ctx);

	const stockfishDepth = new SliderSetting('stockfishDepth', (v) => parseInt(v), ctx);
	const stockfishTimeout = new SliderSetting('stockfishTimeout', (v) => parseInt(v), ctx);
	const tempoSeconds = new SliderSetting('tempoSeconds', (v) => parseInt(v), ctx);
	const playbackSpeed = new SliderSetting('playbackSpeed', (v) => parseInt(v), ctx);
	const fsrsRetention = new SliderSetting('fsrsDesiredRetention', (v) => parseFloat(v), ctx);
	const fsrsMaxInterval = new SliderSetting('fsrsMaximumInterval', (v) => parseInt(v), ctx);
	const fsrsRelearningMinutes = new SliderSetting('fsrsRelearningMinutes', (v) => parseInt(v), ctx);
	const sliders = [
		stockfishDepth,
		stockfishTimeout,
		tempoSeconds,
		playbackSpeed,
		fsrsRetention,
		fsrsMaxInterval,
		fsrsRelearningMinutes
	];

	// ── Trainer Rating ─────────────────────────────────────────────────────
	let trainerRatingInput = $state('');
	let trainerRatingStatus = $state('');
	let savingTrainerRating = $state(false);

	async function saveTrainerRating() {
		const parsed = parseInt(trainerRatingInput, 10);
		if (isNaN(parsed) || parsed < 100 || parsed > 3000) {
			trainerRatingStatus = 'Must be 100-3000';
			return;
		}
		savingTrainerRating = true;
		trainerRatingStatus = '';
		try {
			const res = await patchSettings({ trainerRating: parsed });
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
			trainerRatingStatus = 'Saved';
			later(() => (trainerRatingStatus = ''), STATUS_CLEAR_MS);
		} catch {
			trainerRatingStatus = 'Error saving';
		} finally {
			savingTrainerRating = false;
		}
	}

	// ── Game Import Accounts ────────────────────────────────────────────────
	const lichessUsername = new UsernameSetting('lichessUsername', ctx);
	const chesscomUsername = new UsernameSetting('chesscomUsername', ctx);

	// ── Email ───────────────────────────────────────────────────────────────
	let email = $state('');
	let emailStatus = $state('');
	let emailError = $state('');
	let savingEmail = $state(false);

	async function saveEmail() {
		emailError = '';
		emailStatus = '';

		const trimmed = email.trim();
		if (!trimmed) {
			emailError = 'Email is required';
			return;
		}

		savingEmail = true;
		try {
			const res = await fetch('/api/account/email', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: trimmed })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => null);
				emailError = body?.message ?? 'Failed to update email';
				return;
			}

			emailStatus = 'Email updated successfully';
			await invalidateAll();
		} catch {
			emailError = 'Network error — please try again';
		} finally {
			savingEmail = false;
		}
	}

	// ── Password Change ─────────────────────────────────────────────────────
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordStatus = $state('');
	let passwordError = $state('');
	let changingPassword = $state(false);

	async function changePassword() {
		passwordError = '';
		passwordStatus = '';

		if (!currentPassword) {
			passwordError = 'Current password is required';
			return;
		}
		const pwErr = validatePassword(newPassword);
		if (pwErr) {
			passwordError = pwErr;
			return;
		}
		if (newPassword !== confirmPassword) {
			passwordError = 'New passwords do not match';
			return;
		}

		changingPassword = true;
		try {
			const res = await fetch('/api/auth/change-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => null);
				passwordError = body?.message ?? 'Failed to change password';
				return;
			}

			passwordStatus = 'Password changed successfully';
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch {
			passwordError = 'Network error — please try again';
		} finally {
			changingPassword = false;
		}
	}

	// ── Tutorial ──────────────────────────────────────────────────────────────
	let restartingTutorial = $state(false);

	async function restartTutorial() {
		if (restartingTutorial) return;
		restartingTutorial = true;
		await patchSettings({ tutorialStep: 1 });
		await invalidateAll();
		await params.goToBuild();
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	// Reset every server-backed control to the latest server data. The page
	// calls this from a $effect, so it re-runs after each invalidateAll().
	function sync(
		settings: SettingsSnapshot | null | undefined,
		userEmail: string | null | undefined
	) {
		appTheme = settings?.appTheme ?? 'dark';
		boardTheme = settings?.boardTheme ?? 'blue';
		sound.value = settings?.soundEnabled ?? true;
		stockfishDepth.value = settings?.stockfishDepth ?? 15;
		stockfishTimeout.value = settings?.stockfishTimeout ?? 10;
		tempo.value = settings?.tempoEnabled ?? false;
		tempoSeconds.value = settings?.tempoSeconds ?? 10;
		playbackSpeed.value = settings?.playbackSpeed ?? 500;
		fsrsRetention.value = settings?.fsrsDesiredRetention ?? 0.9;
		fsrsMaxInterval.value = settings?.fsrsMaximumInterval ?? 365;
		fsrsRelearningMinutes.value = settings?.fsrsRelearningMinutes ?? 10;
		const rating = settings?.trainerRating ?? null;
		trainerRatingInput = rating !== null ? String(rating) : '';
		lichessUsername.value = settings?.lichessUsername ?? '';
		chesscomUsername.value = settings?.chesscomUsername ?? '';
		email = userEmail ?? '';
	}

	function destroy() {
		for (const slider of sliders) slider.cancel();
		for (const id of timers) clearTimeout(id);
		timers.clear();
	}

	return {
		// App and board theme
		get appTheme() {
			return appTheme;
		},
		setAppTheme,
		get boardTheme() {
			return boardTheme;
		},
		get boardThemeStatus() {
			return boardThemeStatus;
		},
		setBoardTheme,

		// Toggles and sliders (each object carries its own reactive state)
		sound,
		tempo,
		stockfishDepth,
		stockfishTimeout,
		tempoSeconds,
		playbackSpeed,
		fsrsRetention,
		fsrsMaxInterval,
		fsrsRelearningMinutes,

		// Trainer rating
		get trainerRatingInput() {
			return trainerRatingInput;
		},
		set trainerRatingInput(v: string) {
			trainerRatingInput = v;
		},
		get trainerRatingStatus() {
			return trainerRatingStatus;
		},
		get savingTrainerRating() {
			return savingTrainerRating;
		},
		saveTrainerRating,

		// Game import
		lichessUsername,
		chesscomUsername,

		// Email
		get email() {
			return email;
		},
		set email(v: string) {
			email = v;
		},
		get emailStatus() {
			return emailStatus;
		},
		get emailError() {
			return emailError;
		},
		get savingEmail() {
			return savingEmail;
		},
		saveEmail,

		// Password
		get currentPassword() {
			return currentPassword;
		},
		set currentPassword(v: string) {
			currentPassword = v;
		},
		get newPassword() {
			return newPassword;
		},
		set newPassword(v: string) {
			newPassword = v;
		},
		get confirmPassword() {
			return confirmPassword;
		},
		set confirmPassword(v: string) {
			confirmPassword = v;
		},
		get passwordStatus() {
			return passwordStatus;
		},
		get passwordError() {
			return passwordError;
		},
		get changingPassword() {
			return changingPassword;
		},
		changePassword,

		// Tutorial
		get restartingTutorial() {
			return restartingTutorial;
		},
		restartTutorial,

		// Lifecycle
		sync,
		destroy
	};
}

export type SettingsState = ReturnType<typeof createSettingsState>;
