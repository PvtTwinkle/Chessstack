import { describe, it, expect } from 'vitest';
import { validate } from '../validation';
import { computerMoveQuerySchema, playersQuerySchema, starsQuerySchema } from './lookups';

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const fail = (message: string) => ({ success: false, message });

describe('playersQuerySchema', () => {
	it('coerces the rating bracket', () => {
		expect(validate(playersQuerySchema, { fen: FEN, rating: '3' })).toEqual({
			success: true,
			data: { fen: FEN, rating: 3 }
		});
	});

	it.each([
		[{ rating: '3' }, 'fen is required'],
		[{ fen: FEN, rating: '8' }, 'rating must be 0-7'],
		[{ fen: FEN, rating: '2abc' }, 'rating must be 0-7'],
		[{ fen: 'x'.repeat(101), rating: '1' }, 'fen must be at most 100 characters']
	])('rejects %j', (query, message) => {
		expect(validate(playersQuerySchema, query)).toEqual(fail(message));
	});
});

describe('starsQuerySchema', () => {
	it('requires a player slug of at most 50 characters', () => {
		expect(validate(starsQuerySchema, { fen: FEN, player: 'carlsen' }).success).toBe(true);
		expect(validate(starsQuerySchema, { fen: FEN })).toEqual(fail('player is required'));
		expect(validate(starsQuerySchema, { fen: FEN, player: 'x'.repeat(51) })).toEqual(
			fail('player must be at most 50 characters')
		);
	});
});

describe('computerMoveQuerySchema', () => {
	it('needs a rating for the players source only', () => {
		expect(validate(computerMoveQuerySchema, { fen: FEN, source: 'masters' }).success).toBe(true);
		expect(validate(computerMoveQuerySchema, { fen: FEN, source: 'players', rating: '2' })).toEqual(
			{ success: true, data: { fen: FEN, source: 'players', rating: 2 } }
		);
		expect(validate(computerMoveQuerySchema, { fen: FEN, source: 'players' })).toEqual(
			fail('rating must be 0-7')
		);
	});
});
