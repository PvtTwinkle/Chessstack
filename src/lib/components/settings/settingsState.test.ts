import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createSettingsState,
	formatMaxInterval,
	SAVE_DEBOUNCE_MS,
	STATUS_CLEAR_MS
} from './settingsState.svelte';

// A fetch stub that records requests and answers with the given status.
function stubFetch(status = 200, body: unknown = {}) {
	const fetchMock = vi.fn<typeof fetch>(
		async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'Content-Type': 'application/json' }
			})
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

// The JSON body of the nth request the stub received.
function sentBody(fetchMock: ReturnType<typeof stubFetch>, n = 0) {
	return JSON.parse(fetchMock.mock.calls[n][1]?.body as string);
}

function setup() {
	const invalidateAll = vi.fn(async () => {});
	const goToBuild = vi.fn(async () => {});
	const s = createSettingsState({ invalidateAll, goToBuild });
	return { s, invalidateAll, goToBuild };
}

// A range input event carrying the given value.
function inputEvent(value: string): Event {
	return { target: { value } } as unknown as Event;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('document', { documentElement: { dataset: {} as Record<string, string> } });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('formatMaxInterval', () => {
	it('shows days, months or years depending on the length', () => {
		expect(formatMaxInterval(30)).toBe('30 days');
		expect(formatMaxInterval(59)).toBe('59 days');
		expect(formatMaxInterval(60)).toBe('60 days (~2 months)');
		expect(formatMaxInterval(364)).toBe('364 days (~12 months)');
		expect(formatMaxInterval(365)).toBe('365 days (~1 year)');
		expect(formatMaxInterval(3650)).toBe('3650 days (~10 years)');
		expect(formatMaxInterval(550)).toBe('550 days (~1.5 years)');
	});
});

describe('sync', () => {
	it('falls back to the column defaults when there is no settings row', () => {
		const { s } = setup();
		s.sync(null, null);
		expect(s.appTheme).toBe('dark');
		expect(s.boardTheme).toBe('blue');
		expect(s.sound.value).toBe(true);
		expect(s.stockfishDepth.value).toBe(15);
		expect(s.stockfishTimeout.value).toBe(10);
		expect(s.tempo.value).toBe(false);
		expect(s.tempoSeconds.value).toBe(10);
		expect(s.playbackSpeed.value).toBe(500);
		expect(s.fsrsRetention.value).toBe(0.9);
		expect(s.fsrsMaxInterval.value).toBe(365);
		expect(s.fsrsRelearningMinutes.value).toBe(10);
		expect(s.trainerRatingInput).toBe('');
		expect(s.lichessUsername.value).toBe('');
		expect(s.chesscomUsername.value).toBe('');
		expect(s.email).toBe('');
	});

	it('copies the server values into every control', () => {
		const { s } = setup();
		s.sync(
			{
				appTheme: 'light',
				boardTheme: 'green',
				soundEnabled: false,
				stockfishDepth: 22,
				stockfishTimeout: 20,
				tempoEnabled: true,
				tempoSeconds: 5,
				playbackSpeed: 800,
				fsrsDesiredRetention: 0.85,
				fsrsMaximumInterval: 1000,
				fsrsRelearningMinutes: 30,
				trainerRating: 1450,
				lichessUsername: 'lichessuser',
				chesscomUsername: 'chesscomuser'
			},
			'me@example.com'
		);
		expect(s.appTheme).toBe('light');
		expect(s.boardTheme).toBe('green');
		expect(s.sound.value).toBe(false);
		expect(s.stockfishDepth.value).toBe(22);
		expect(s.stockfishTimeout.value).toBe(20);
		expect(s.tempo.value).toBe(true);
		expect(s.tempoSeconds.value).toBe(5);
		expect(s.playbackSpeed.value).toBe(800);
		expect(s.fsrsRetention.value).toBe(0.85);
		expect(s.fsrsMaxInterval.value).toBe(1000);
		expect(s.fsrsRelearningMinutes.value).toBe(30);
		expect(s.trainerRatingInput).toBe('1450');
		expect(s.lichessUsername.value).toBe('lichessuser');
		expect(s.chesscomUsername.value).toBe('chesscomuser');
		expect(s.email).toBe('me@example.com');
	});
});

describe('app theme', () => {
	it('applies the theme at once and saves it', async () => {
		const fetchMock = stubFetch();
		const { s, invalidateAll } = setup();
		await s.setAppTheme('light');
		expect(s.appTheme).toBe('light');
		expect(document.documentElement.dataset.theme).toBe('light');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/settings');
		expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
		expect(sentBody(fetchMock)).toEqual({ appTheme: 'light' });
		expect(invalidateAll).toHaveBeenCalledOnce();
	});

	it('reverts to the other theme when the save fails', async () => {
		stubFetch(500);
		const { s, invalidateAll } = setup();
		await s.setAppTheme('light');
		expect(s.appTheme).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
		expect(invalidateAll).not.toHaveBeenCalled();
	});
});

describe('board theme', () => {
	it('saves, shows "Saved" and clears it after a moment', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		await s.setBoardTheme('purple');
		expect(s.boardTheme).toBe('purple');
		expect(sentBody(fetchMock)).toEqual({ boardTheme: 'purple' });
		expect(s.boardThemeStatus).toBe('Saved');
		vi.advanceTimersByTime(STATUS_CLEAR_MS);
		expect(s.boardThemeStatus).toBe('');
	});

	it('keeps the chosen theme but reports an error when the save fails', async () => {
		stubFetch(500);
		const { s } = setup();
		await s.setBoardTheme('purple');
		expect(s.boardTheme).toBe('purple');
		expect(s.boardThemeStatus).toBe('Error saving');
	});
});

describe('toggles', () => {
	it('flips the value and saves the new one', async () => {
		const fetchMock = stubFetch();
		const { s, invalidateAll } = setup();
		s.sync(null, null);
		await s.sound.toggle();
		expect(s.sound.value).toBe(false);
		expect(sentBody(fetchMock)).toEqual({ soundEnabled: false });
		await s.tempo.toggle();
		expect(s.tempo.value).toBe(true);
		expect(sentBody(fetchMock, 1)).toEqual({ tempoEnabled: true });
		expect(invalidateAll).toHaveBeenCalledTimes(2);
	});

	it('flips back on a network error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('offline');
			})
		);
		const { s } = setup();
		s.sync(null, null);
		await s.sound.toggle();
		expect(s.sound.value).toBe(true);
	});

	it('keeps the new value when the server answers with an error status', async () => {
		// Matches the original page: toggles only revert when the request throws.
		stubFetch(500);
		const { s } = setup();
		s.sync(null, null);
		await s.tempo.toggle();
		expect(s.tempo.value).toBe(true);
	});
});

describe('sliders', () => {
	it('updates at once but saves only after the user stops dragging', async () => {
		const fetchMock = stubFetch();
		const { s, invalidateAll } = setup();
		s.stockfishDepth.handleInput(inputEvent('18'));
		s.stockfishDepth.handleInput(inputEvent('21'));
		expect(s.stockfishDepth.value).toBe(21);
		expect(fetchMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(sentBody(fetchMock)).toEqual({ stockfishDepth: 21 });
		expect(invalidateAll).toHaveBeenCalledOnce();
		expect(s.stockfishDepth.status).toBe('Saved');

		await vi.advanceTimersByTimeAsync(STATUS_CLEAR_MS);
		expect(s.stockfishDepth.status).toBe('');
	});

	it('sends each slider under its own settings key', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		const cases = [
			[s.stockfishTimeout, '12', { stockfishTimeout: 12 }],
			[s.tempoSeconds, '7', { tempoSeconds: 7 }],
			[s.playbackSpeed, '650', { playbackSpeed: 650 }],
			[s.fsrsRetention, '0.93', { fsrsDesiredRetention: 0.93 }],
			[s.fsrsMaxInterval, '730', { fsrsMaximumInterval: 730 }],
			[s.fsrsRelearningMinutes, '25', { fsrsRelearningMinutes: 25 }]
		] as const;
		for (const [slider, raw] of cases) slider.handleInput(inputEvent(raw));
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
		const bodies = fetchMock.mock.calls.map((_, i) => sentBody(fetchMock, i));
		expect(bodies).toEqual(cases.map(([, , body]) => body));
	});

	it('reports an error when the save fails', async () => {
		stubFetch(400);
		const { s } = setup();
		s.playbackSpeed.handleInput(inputEvent('300'));
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
		expect(s.playbackSpeed.value).toBe(300);
		expect(s.playbackSpeed.status).toBe('Error saving');
	});

	it('drops a pending save when the page is destroyed', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		s.tempoSeconds.handleInput(inputEvent('8'));
		s.destroy();
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('trainer rating', () => {
	it.each(['', 'abc', '99', '3001'])('rejects %j without saving', async (input) => {
		const fetchMock = stubFetch();
		const { s } = setup();
		s.trainerRatingInput = input;
		await s.saveTrainerRating();
		expect(s.trainerRatingStatus).toBe('Must be 100-3000');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('saves a rating in range', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		s.trainerRatingInput = '1600';
		const saving = s.saveTrainerRating();
		expect(s.savingTrainerRating).toBe(true);
		await saving;
		expect(sentBody(fetchMock)).toEqual({ trainerRating: 1600 });
		expect(s.savingTrainerRating).toBe(false);
		expect(s.trainerRatingStatus).toBe('Saved');
	});

	it('reports an error when the save fails', async () => {
		stubFetch(500);
		const { s } = setup();
		s.trainerRatingInput = '1600';
		await s.saveTrainerRating();
		expect(s.trainerRatingStatus).toBe('Error saving');
		expect(s.savingTrainerRating).toBe(false);
	});
});

describe('game import usernames', () => {
	it('saves the username', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		s.lichessUsername.value = 'magnus';
		await s.lichessUsername.save();
		expect(sentBody(fetchMock)).toEqual({ lichessUsername: 'magnus' });
		expect(s.lichessUsername.status).toBe('Saved');
		expect(s.lichessUsername.saving).toBe(false);
	});

	it('sends null to clear an empty username', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		s.chesscomUsername.value = '';
		await s.chesscomUsername.save();
		expect(sentBody(fetchMock)).toEqual({ chesscomUsername: null });
	});

	it('reports an error when the save fails', async () => {
		stubFetch(500);
		const { s } = setup();
		s.chesscomUsername.value = 'hikaru';
		await s.chesscomUsername.save();
		expect(s.chesscomUsername.status).toBe('Error saving');
	});
});

describe('email', () => {
	it('requires an email', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		s.email = '   ';
		await s.saveEmail();
		expect(s.emailError).toBe('Email is required');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sends the trimmed email and reports success', async () => {
		const fetchMock = stubFetch();
		const { s, invalidateAll } = setup();
		s.email = '  me@example.com ';
		await s.saveEmail();
		expect(fetchMock.mock.calls[0][0]).toBe('/api/account/email');
		expect(sentBody(fetchMock)).toEqual({ email: 'me@example.com' });
		expect(s.emailStatus).toBe('Email updated successfully');
		expect(s.emailError).toBe('');
		expect(invalidateAll).toHaveBeenCalledOnce();
	});

	it("shows the server's error message", async () => {
		stubFetch(409, { message: 'Email already in use' });
		const { s } = setup();
		s.email = 'taken@example.com';
		await s.saveEmail();
		expect(s.emailError).toBe('Email already in use');
		expect(s.savingEmail).toBe(false);
	});
});

describe('password change', () => {
	const strong = 'Correct-Horse-42';

	it('checks the form before sending anything', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();

		await s.changePassword();
		expect(s.passwordError).toBe('Current password is required');

		s.currentPassword = 'old password here';
		s.newPassword = 'short';
		await s.changePassword();
		expect(s.passwordError).not.toBe('');
		expect(s.passwordError).not.toBe('New passwords do not match');

		s.newPassword = strong;
		s.confirmPassword = strong + '!';
		await s.changePassword();
		expect(s.passwordError).toBe('New passwords do not match');

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('changes the password and clears the form', async () => {
		const fetchMock = stubFetch();
		const { s } = setup();
		s.currentPassword = 'old password here';
		s.newPassword = strong;
		s.confirmPassword = strong;
		await s.changePassword();
		expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/change-password');
		expect(sentBody(fetchMock)).toEqual({
			currentPassword: 'old password here',
			newPassword: strong
		});
		expect(s.passwordStatus).toBe('Password changed successfully');
		expect(s.currentPassword).toBe('');
		expect(s.newPassword).toBe('');
		expect(s.confirmPassword).toBe('');
	});

	it("keeps the form and shows the server's error", async () => {
		stubFetch(400, { message: 'Current password is incorrect' });
		const { s } = setup();
		s.currentPassword = 'wrong password!';
		s.newPassword = strong;
		s.confirmPassword = strong;
		await s.changePassword();
		expect(s.passwordError).toBe('Current password is incorrect');
		expect(s.currentPassword).toBe('wrong password!');
		expect(s.changingPassword).toBe(false);
	});
});

describe('tutorial', () => {
	it('resets the tutorial step and goes to Build, once', async () => {
		const fetchMock = stubFetch();
		const { s, goToBuild } = setup();
		const first = s.restartTutorial();
		const second = s.restartTutorial();
		await Promise.all([first, second]);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(sentBody(fetchMock)).toEqual({ tutorialStep: 1 });
		expect(goToBuild).toHaveBeenCalledOnce();
		expect(s.restartingTutorial).toBe(true);
	});
});
