import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn() }));

import { captureException } from '@sentry/sveltekit';
import { currentRequestId, log, runWithRequestContext, serializeError } from './log';

describe('log', () => {
	let out: string[];
	let err: string[];

	beforeEach(() => {
		vi.stubEnv('LOG_FORMAT', 'json');
		out = [];
		err = [];
		vi.spyOn(console, 'log').mockImplementation((line) => out.push(line));
		vi.spyOn(console, 'error').mockImplementation((line) => err.push(line));
		vi.mocked(captureException).mockClear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it('writes one JSON object per line', () => {
		log.info('hello', { userId: 7 });
		expect(out).toHaveLength(1);
		const entry = JSON.parse(out[0]);
		expect(entry).toMatchObject({ level: 'info', msg: 'hello', userId: 7 });
		expect(new Date(entry.time).toString()).not.toBe('Invalid Date');
		expect(entry.requestId).toBeUndefined();
	});

	it('adds the current request id inside a request context', async () => {
		await runWithRequestContext('req-1', async () => {
			await Promise.resolve();
			expect(currentRequestId()).toBe('req-1');
			log.warn('inside');
		});
		log.info('outside');
		expect(JSON.parse(out[0])).toMatchObject({ level: 'warn', requestId: 'req-1' });
		expect(JSON.parse(out[1]).requestId).toBeUndefined();
	});

	it('writes errors to stderr, serialises them and reports them to Sentry', () => {
		const boom = new Error('boom', { cause: new Error('root') });
		runWithRequestContext('req-2', () => log.error('failed', { err: boom }));

		const entry = JSON.parse(err[0]);
		expect(entry).toMatchObject({
			level: 'error',
			msg: 'failed',
			requestId: 'req-2',
			err: { name: 'Error', message: 'boom', cause: { message: 'root' } }
		});
		expect(entry.err.stack).toContain('boom');
		expect(captureException).toHaveBeenCalledWith(boom, {
			extra: { msg: 'failed', requestId: 'req-2' }
		});
	});

	it('does not report to Sentry without an Error', () => {
		log.error('failed', { reason: 'timeout' });
		log.warn('odd', { err: new Error('x') });
		expect(captureException).not.toHaveBeenCalled();
	});

	it('never throws on unserialisable fields', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => log.info('loop', { circular })).not.toThrow();
		expect(JSON.parse(out[0])).toMatchObject({ msg: 'loop', logError: 'unserialisable' });
	});

	it('has a readable text format for local development', () => {
		vi.stubEnv('LOG_FORMAT', 'text');
		log.info('hello', { userId: 7 });
		expect(out[0]).toBe('[chessstack] INFO hello {"userId":7}');
	});
});

describe('serializeError', () => {
	it('handles non-Error values', () => {
		expect(serializeError('nope')).toEqual({ message: 'nope' });
	});
});
