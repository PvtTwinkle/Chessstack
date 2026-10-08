import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { reviewAddMoveSchema, failCardSchema, saveReviewSchema } from './review';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const fail = (message: string) => ({ success: false, message });

describe('reviewAddMoveSchema', () => {
	it('defaults forceReplace to false', () => {
		expect(validate(reviewAddMoveSchema, { repertoireId: 1, fromFen: FEN, san: 'e4' })).toEqual({
			success: true,
			data: { repertoireId: 1, fromFen: FEN, san: 'e4', forceReplace: false }
		});
	});

	it.each([
		[{ repertoireId: 1, fromFen: FEN }, 'san is required'],
		[{ repertoireId: 1, san: 'e4' }, 'fromFen is required'],
		[
			{ repertoireId: 1, fromFen: FEN, san: 'e4', forceReplace: 'yes' },
			'forceReplace must be a boolean'
		]
	])('rejects %j', (body, message) => {
		expect(validate(reviewAddMoveSchema, body)).toEqual(fail(message));
	});
});

describe('failCardSchema', () => {
	it('requires a repertoire and a FEN', () => {
		expect(validate(failCardSchema, { repertoireId: 1, fromFen: FEN }).success).toBe(true);
		expect(validate(failCardSchema, { repertoireId: 1, fromFen: 'x'.repeat(101) })).toEqual(
			fail('fromFen must be at most 100 characters')
		);
	});
});

describe('saveReviewSchema', () => {
	it('accepts a minimal save and normalises optional fields', () => {
		expect(validate(saveReviewSchema, { repertoireId: 1, pgn: '1. e4 e5', notes: '   ' })).toEqual({
			success: true,
			data: { repertoireId: 1, pgn: '1. e4 e5', notes: null }
		});
	});

	it('keeps trimmed notes, a deviation FEN and the imported game id', () => {
		expect(
			validate(saveReviewSchema, {
				repertoireId: 1,
				pgn: '1. e4 e5',
				deviationFen: FEN,
				notes: ' missed Nf3 ',
				importedGameId: 9
			})
		).toEqual({
			success: true,
			data: {
				repertoireId: 1,
				pgn: '1. e4 e5',
				deviationFen: FEN,
				notes: 'missed Nf3',
				importedGameId: 9
			}
		});
	});

	it.each([
		[{ repertoireId: 1, pgn: '' }, 'pgn must not be empty'],
		[{ pgn: '1. e4' }, 'repertoireId is required'],
		[{ repertoireId: 1, pgn: '1. e4', importedGameId: '9' }, 'importedGameId must be a number']
	])('rejects %j', (body, message) => {
		expect(validate(saveReviewSchema, body)).toEqual(fail(message));
	});
});
