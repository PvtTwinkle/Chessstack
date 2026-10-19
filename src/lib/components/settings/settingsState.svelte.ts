/**
 * settingsState.svelte.ts — Svelte 5 runes module for the Settings page.
 *
 * All reactive state and save actions for the self-service settings live
 * here; the section components under $lib/components/settings render them.
 * The +page.svelte creates one instance with createSettingsState(), fills it
 * once from the server data with sync(), and calls destroy() when it
 * unmounts.
 *
 * Most settings save optimistically: the control updates at once, the PATCH
 * goes to /api/settings, and the layout data is refreshed so other pages pick
 * up the change. Sliders debounce the save until the user stops dragging.
 *
 * After the first sync each control keeps its own value: the one it just
 * saved, or what the user is still typing. Re-syncing every control after
 * each save would wipe unsaved text in one field whenever another saved.
 */

import type { userSettings } from '$lib/db/schema';
import { validatePassword } from '$lib/auth/password';
import { patchSettings, type SettingsPatch } from '$lib/settings-client';
import { tutorial } from '$lib/stores/tutorial.svelte';
import {
	DEFAULT_STOCKFISH_DEPTH,
	FSRS_MAX_INTERVAL_RANGE,
	FSRS_RELEARNING_RANGE,
	FSRS_RETENTION_RANGE,
	PLAYBACK_SPEED_RANGE,
	STOCKFISH_TIMEOUT_RANGE,
	TEMPO_SECONDS_RANGE,
	TRAINER_RATING_RANGE
} from '$lib/validation-limits';

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

/** A save result shown next to a control; ok: false is styled as an error. */
export interface Status {
	text: string;
	ok: boolean;
}

export const SAVED: Status = { text: 'Saved', ok: true };
export const SAVE_FAILED: Status = { text: 'Error saving', ok: false };

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

// What each setting class needs from its owner.
interface SettingContext {
	invalidateAll: () => Promise<void>;
	// setTimeout that is cleared when the page unmounts.
	later: (fn: () => void, ms: number) => void;
}

// Saves one change and refreshes the layout data so other pages see it.
async function save(ctx: SettingContext, patch: SettingsPatch): Promise<boolean> {
	if (!(await patchSettings(patch))) return false;
	await ctx.invalidateAll().catch(() => {});
	return true;
}

/** A numeric range input that saves itself once the user stops dragging. */
export class SliderSetting {
	value = $state(0);
	status = $state<Status | null>(null);

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
		this.status = null;
		if (await save(this.#ctx, { [this.#key]: value } as SettingsPatch)) {
			this.status = SAVED;
			this.#ctx.later(() => (this.status = null), STATUS_CLEAR_MS);
		} else {
			this.status = SAVE_FAILED;
		}
	}

	cancel() {
		clearTimeout(this.#debounce);
	}
}

/** An On/Off button. Flips at once and flips back if the save fails. */
export class ToggleSetting {
	value = $state(false);
	status = $state<Status | null>(null);

	#key: SettingKey;
	#ctx: SettingContext;

	constructor(key: SettingKey, ctx: SettingContext) {
		this.#key = key;
		this.#ctx = ctx;
	}

	toggle = async () => {
		const next = !this.value;
		this.value = next;
		this.status = null;
		if (!(await save(this.#ctx, { [this.#key]: next } as SettingsPatch))) {
			this.value = !next;
			this.status = SAVE_FAILED;
		}
	};
}

/** A game-import username with its own Save button. Empty clears it. */
export class UsernameSetting {
	value = $state('');
	status = $state<Status | null>(null);
	saving = $state(false);

	#key: SettingKey;
	#ctx: SettingContext;

	constructor(key: SettingKey, ctx: SettingContext) {
		this.#key = key;
		this.#ctx = ctx;
	}

	save = async () => {
		this.saving = true;
		this.status = null;
		// The server trims it too; show what it keeps.
		const value = this.value.trim();
		try {
			if (await save(this.#ctx, { [this.#key]: value || null } as SettingsPatch)) {
				this.value = value;
				this.status = SAVED;
				this.#ctx.later(() => (this.status = null), STATUS_CLEAR_MS);
			} else {
				this.status = SAVE_FAILED;
			}
		} finally {
			this.saving = false;
		}
	};
}

interface CreateSettingsStateParams {
	invalidateAll: () => Promise<void>;
	// Navigate to the Build page, where the tutorial starts.
	goToBuild: () => Promise<void>;
	// Navigate to /verify-email after an email change that needs verifying.
	goToVerifyEmail: () => Promise<void>;
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
	let appThemeStatus = $state<Status | null>(null);

	async function setAppTheme(mode: 'dark' | 'light') {
		const previous = appTheme;
		appTheme = mode;
		appThemeStatus = null;
		// Instant visual feedback — don't wait for the server round-trip
		document.documentElement.dataset.theme = mode;
		if (!(await save(ctx, { appTheme: mode }))) {
			// Back to the theme the user had, which may be the same one.
			appTheme = previous;
			document.documentElement.dataset.theme = previous;
			appThemeStatus = SAVE_FAILED;
		}
	}

	// ── Board Theme ─────────────────────────────────────────────────────────
	let boardTheme = $state('blue');
	let boardThemeStatus = $state<Status | null>(null);

	async function setBoardTheme(name: string) {
		boardTheme = name;
		boardThemeStatus = null;
		if (await save(ctx, { boardTheme: name as SettingsPatch['boardTheme'] })) {
			boardThemeStatus = SAVED;
			later(() => (boardThemeStatus = null), STATUS_CLEAR_MS);
		} else {
			boardThemeStatus = SAVE_FAILED;
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
	let trainerRatingStatus = $state<Status | null>(null);
	let savingTrainerRating = $state(false);

	async function saveTrainerRating() {
		const { min, max } = TRAINER_RATING_RANGE;
		const parsed = parseInt(trainerRatingInput, 10);
		if (isNaN(parsed) || parsed < min || parsed > max) {
			trainerRatingStatus = { text: `Must be ${min}-${max}`, ok: false };
			return;
		}
		savingTrainerRating = true;
		trainerRatingStatus = null;
		try {
			if (await save(ctx, { trainerRating: parsed })) {
				trainerRatingStatus = SAVED;
				later(() => (trainerRatingStatus = null), STATUS_CLEAR_MS);
			} else {
				trainerRatingStatus = SAVE_FAILED;
			}
		} finally {
			savingTrainerRating = false;
		}
	}

	// ── Game Import Accounts ────────────────────────────────────────────────
	const lichessUsername = new UsernameSetting('lichessUsername', ctx);
	const chesscomUsername = new UsernameSetting('chesscomUsername', ctx);

	// ── Email ───────────────────────────────────────────────────────────────
	let email = $state('');
	// The current password, which the server requires for an email change.
	let emailPassword = $state('');
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
		if (!emailPassword) {
			emailError = 'Enter your current password to change your email';
			return;
		}

		savingEmail = true;
		try {
			const res = await fetch('/api/account/email', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: trimmed, password: emailPassword })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => null);
				emailError = body?.message ?? 'Failed to update email';
				return;
			}

			emailPassword = '';
			const body = await res.json().catch(() => null);
			if (body?.verificationRequired) {
				// The app is closed to this account until the new address is verified.
				await params.goToVerifyEmail();
				return;
			}
			email = trimmed;
			emailStatus = body?.updated === false ? 'That is already your email' : 'Email updated';
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
	let tutorialStatus = $state<Status | null>(null);

	async function restartTutorial() {
		if (restartingTutorial) return;
		restartingTutorial = true;
		tutorialStatus = null;
		let started = false;
		try {
			started = await tutorial.goTo('build-first-moves');
			if (!started) {
				// The step changed on screen; put it back as the server has it.
				tutorial.sync(null);
				tutorialStatus = { text: "Couldn't restart the tutorial. Please try again.", ok: false };
				return;
			}
			await invalidateAll();
			await params.goToBuild();
		} finally {
			// On success the page is navigating away; keep the button disabled.
			if (!started) restartingTutorial = false;
		}
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	// Fill every server-backed control from the server data. The page calls
	// this once when it mounts; after that each control keeps its own value.
	function sync(
		settings: SettingsSnapshot | null | undefined,
		userEmail: string | null | undefined
	) {
		appTheme = settings?.appTheme ?? 'dark';
		boardTheme = settings?.boardTheme ?? 'blue';
		sound.value = settings?.soundEnabled ?? true;
		stockfishDepth.value = settings?.stockfishDepth ?? DEFAULT_STOCKFISH_DEPTH;
		stockfishTimeout.value = settings?.stockfishTimeout ?? STOCKFISH_TIMEOUT_RANGE.default;
		tempo.value = settings?.tempoEnabled ?? false;
		tempoSeconds.value = settings?.tempoSeconds ?? TEMPO_SECONDS_RANGE.default;
		playbackSpeed.value = settings?.playbackSpeed ?? PLAYBACK_SPEED_RANGE.default;
		fsrsRetention.value = settings?.fsrsDesiredRetention ?? FSRS_RETENTION_RANGE.default;
		fsrsMaxInterval.value = settings?.fsrsMaximumInterval ?? FSRS_MAX_INTERVAL_RANGE.default;
		fsrsRelearningMinutes.value = settings?.fsrsRelearningMinutes ?? FSRS_RELEARNING_RANGE.default;
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
		get appThemeStatus() {
			return appThemeStatus;
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
		get emailPassword() {
			return emailPassword;
		},
		set emailPassword(v: string) {
			emailPassword = v;
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
		get tutorialStatus() {
			return tutorialStatus;
		},
		restartTutorial,

		// Lifecycle
		sync,
		destroy
	};
}

export type SettingsState = ReturnType<typeof createSettingsState>;
