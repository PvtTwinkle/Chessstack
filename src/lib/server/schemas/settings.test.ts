import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { updateSettingsSchema } from './settings';
import { TOTAL_STEPS } from '$lib/components/tutorial/tutorialSteps';

function parsed(body: unknown) {
	const result = validate(updateSettingsSchema, body);
	if (!result.success) throw new Error(result.message);
	return result.data;
}

function message(body: unknown) {
	const result = validate(updateSettingsSchema, body);
	return result.success ? null : result.message;
}

describe('updateSettingsSchema', () => {
	it('keeps only the fields that were sent', () => {
		expect(parsed({ soundEnabled: false, boardTheme: 'blue' })).toEqual({
			soundEnabled: false,
			boardTheme: 'blue'
		});
	});

	it('rejects a body with no recognised fields', () => {
		expect(message({})).toBe('No recognised settings fields provided');
		expect(message({ favouriteColour: 'red' })).toBe('No recognised settings fields provided');
	});

	it('rounds and clamps numeric settings to their ranges', () => {
		expect(parsed({ stockfishTimeout: 99 })).toEqual({ stockfishTimeout: 30 });
		expect(parsed({ tempoSeconds: 1 })).toEqual({ tempoSeconds: 3 });
		expect(parsed({ playbackSpeed: 512.6 })).toEqual({ playbackSpeed: 513 });
		expect(parsed({ puzzleGoalCount: 0 })).toEqual({ puzzleGoalCount: 1 });
		expect(parsed({ playersRatingBracket: 9 })).toEqual({ playersRatingBracket: 7 });
		expect(parsed({ fsrsDesiredRetention: 0.999 })).toEqual({ fsrsDesiredRetention: 0.97 });
		expect(parsed({ fsrsDesiredRetention: 0.854 })).toEqual({ fsrsDesiredRetention: 0.85 });
		expect(parsed({ fsrsMaximumInterval: 5 })).toEqual({ fsrsMaximumInterval: 30 });
		expect(parsed({ fsrsRelearningMinutes: 120 })).toEqual({ fsrsRelearningMinutes: 60 });
		expect(parsed({ trainerRating: 5000 })).toEqual({ trainerRating: 3000 });
		expect(parsed({ tutorialStep: 99 })).toEqual({ tutorialStep: TOTAL_STEPS - 1 });
	});

	it('only applies the lower bound to Stockfish depth (the route applies the plan cap)', () => {
		expect(parsed({ stockfishDepth: 5 })).toEqual({ stockfishDepth: 15 });
		expect(parsed({ stockfishDepth: 40 })).toEqual({ stockfishDepth: 30 });
	});

	it('treats board size 0 as auto and clamps the rest', () => {
		expect(parsed({ boardSize: 0 })).toEqual({ boardSize: 0 });
		expect(parsed({ boardSize: 100 })).toEqual({ boardSize: 320 });
		expect(parsed({ boardSize: 1200 })).toEqual({ boardSize: 800 });
	});

	it('accepts null to clear nullable settings', () => {
		expect(parsed({ puzzleGoalCount: null, trainerRating: null, tutorialStep: null })).toEqual({
			puzzleGoalCount: null,
			trainerRating: null,
			tutorialStep: null
		});
	});

	it('trims usernames and clears them on empty or null', () => {
		expect(parsed({ lichessUsername: ' magnus_c ' })).toEqual({ lichessUsername: 'magnus_c' });
		expect(parsed({ chesscomUsername: '' })).toEqual({ chesscomUsername: null });
		expect(parsed({ starsPlayerSlug: null })).toEqual({ starsPlayerSlug: null });
	});

	it.each([
		[{ soundEnabled: 'yes' }, 'soundEnabled must be a boolean'],
		[{ stockfishDepth: '20' }, 'stockfishDepth must be a number'],
		[
			{ boardTheme: 'pink' },
			'boardTheme must be one of: "brown", "blue", "green", "purple", "grey"'
		],
		[{ appTheme: 'sepia' }, 'appTheme must be one of: "dark", "light"'],
		[
			{ puzzleGoalFrequency: 'hourly' },
			'puzzleGoalFrequency must be one of: "daily", "weekly", "monthly"'
		],
		[{ gapMinGames: 50 }, 'gapMinGames must be one of: 10, 100, 1000, 10000, 100000'],
		[{ lichessUsername: 'bad name' }, 'lichessUsername may only contain letters, digits, - and _'],
		[{ chesscomUsername: 'x'.repeat(26) }, 'chesscomUsername must be at most 25 characters'],
		[{ starsPlayerSlug: 'x'.repeat(51) }, 'starsPlayerSlug must be at most 50 characters']
	])('rejects %j', (body, expected) => {
		expect(message(body)).toBe(expected);
	});
});
