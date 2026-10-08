import { describe, it, expect } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody, validate } from './validation';

const schema = z.object({
	name: z.string().min(1),
	count: z.number().int().max(10),
	color: z.enum(['WHITE', 'BLACK']),
	moves: z.array(z.object({ san: z.string().max(3) })).optional(),
	label: z.string({ error: 'Pick a label.' }).optional()
});

const valid = { name: 'a', count: 1, color: 'WHITE' };

function jsonRequest(body: string) {
	return new Request('http://localhost/api/test', { method: 'POST', body });
}

async function statusAndMessage(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (e) {
		if (isHttpError(e)) return [e.status, e.body.message];
		throw e;
	}
	throw new Error('expected parseBody to throw');
}

describe('parseBody', () => {
	it('returns the parsed body', async () => {
		const body = await parseBody(jsonRequest(JSON.stringify(valid)), schema);
		expect(body).toEqual(valid);
	});

	it('drops fields the schema does not know', async () => {
		const body = await parseBody(jsonRequest(JSON.stringify({ ...valid, extra: 1 })), schema);
		expect(body).not.toHaveProperty('extra');
	});

	it('rejects a body that is not JSON with 400', async () => {
		expect(await statusAndMessage(parseBody(jsonRequest('{nope'), schema))).toEqual([
			400,
			'Invalid JSON body'
		]);
	});

	it('rejects a body that fails the schema with 400 and the first problem', async () => {
		expect(
			await statusAndMessage(
				parseBody(jsonRequest(JSON.stringify({ ...valid, count: 'x' })), schema)
			)
		).toEqual([400, 'count must be a number']);
	});
});

describe('validate messages', () => {
	const message = (value: unknown) => {
		const result = validate(schema, value);
		return result.success ? null : result.message;
	};

	it('names a missing field', () => {
		expect(message({ count: 1, color: 'WHITE' })).toBe('name is required');
	});

	it('describes a wrong type', () => {
		expect(message({ ...valid, count: 1.5 })).toBe('count must be an integer');
	});

	it('lists the allowed values', () => {
		expect(message({ ...valid, color: 'RED' })).toBe('color must be one of: "WHITE", "BLACK"');
	});

	it('describes length and range limits', () => {
		expect(message({ ...valid, name: '' })).toBe('name must not be empty');
		expect(message({ ...valid, count: 11 })).toBe('count must be at most 10');
	});

	it('names nested fields by path', () => {
		expect(message({ ...valid, moves: [{ san: 'e4' }, { san: 'Nxe4+' }] })).toBe(
			'moves[1].san must be at most 3 characters'
		);
	});

	it('rejects a body that is not an object', () => {
		expect(message(null)).toBe('Request body must be an object');
		expect(message([])).toBe('Request body must be an object');
	});

	it('keeps a message set on the schema', () => {
		expect(message({ ...valid, label: 3 })).toBe('Pick a label.');
	});
});
