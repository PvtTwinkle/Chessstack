// Structured server logging.
//
// Every log line is one JSON object on stdout (stderr for errors), so log
// platforms (Railway, Docker, Loki…) can parse and filter it:
//
//   {"time":"2026-10-03T12:00:00.000Z","level":"error","msg":"Game import failed",
//    "requestId":"5f0c…","err":{"name":"Error","message":"fetch failed","stack":"…"}}
//
// Lines written while a request is being handled carry that request's id
// automatically (see runWithRequestContext, called from hooks.server.ts), so
// every line of a failing request can be found from the id on the error page.
//
// LOG_FORMAT=text switches to a human-readable format; it is the default in
// `npm run dev`. LOG_LEVEL=debug also writes debug lines (default: info).
//
// Passing an Error as `err` to log.error also reports it to Sentry (a no-op
// when Sentry is not configured), so caught-but-unexpected failures such as a
// failed email send are not only buried in the container logs.

import { AsyncLocalStorage } from 'node:async_hooks';
import { dev } from '$app/environment';
import { captureException } from '@sentry/sveltekit';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

interface RequestContext {
	requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

// Read on each call (it is cheap) so tests can switch it.
const logFormat = () => process.env.LOG_FORMAT ?? (dev ? 'text' : 'json');

// debug lines are only written when LOG_LEVEL=debug.
const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
const configuredLevel = LEVELS.indexOf((process.env.LOG_LEVEL ?? 'info') as Level);
const minLevel = configuredLevel === -1 ? LEVELS.indexOf('info') : configuredLevel;

/** Runs `fn` with `requestId` attached to every log line written inside it. */
export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
	return requestContext.run({ requestId }, fn);
}

/** The id of the request currently being handled, if any. */
export function currentRequestId(): string | undefined {
	return requestContext.getStore()?.requestId;
}

/** Turns an Error (or anything thrown) into plain JSON-safe fields. */
export function serializeError(err: unknown): Fields {
	if (err instanceof Error) {
		const out: Fields = { name: err.name, message: err.message, stack: err.stack };
		if (err.cause !== undefined) out.cause = serializeError(err.cause);
		return out;
	}
	return { message: String(err) };
}

function format(level: Level, msg: string, fields: Fields): string {
	const requestId = currentRequestId();
	const entry: Fields = { time: new Date().toISOString(), level, msg };
	if (requestId) entry.requestId = requestId;
	for (const [key, value] of Object.entries(fields)) {
		entry[key] = value instanceof Error ? serializeError(value) : value;
	}

	if (logFormat() === 'text') {
		const rest = { ...entry };
		delete rest.time;
		delete rest.level;
		delete rest.msg;
		const err = rest.err as Fields | undefined;
		const stack = err?.stack;
		// The stack goes on its own lines below rather than inside the JSON.
		if (stack) rest.err = { ...err, stack: undefined };
		const extra = Object.keys(rest).length ? ' ' + safeStringify(rest) : '';
		return `[chessstack] ${level.toUpperCase()} ${msg}${extra}${stack ? '\n' + stack : ''}`;
	}

	return safeStringify(entry);
}

// JSON.stringify that never throws: a circular or otherwise unserialisable
// field must not turn a log call into a crash.
function safeStringify(value: Fields): string {
	try {
		return JSON.stringify(value);
	} catch {
		const { time, level, msg, requestId } = value;
		return JSON.stringify({ time, level, msg, requestId, logError: 'unserialisable' });
	}
}

function write(level: Level, msg: string, fields: Fields = {}): void {
	if (LEVELS.indexOf(level) < minLevel) return;
	const line = format(level, msg, fields);
	if (level === 'error') {
		console.error(line);
	} else {
		console.log(line);
	}
}

export const log = {
	debug: (msg: string, fields?: Fields) => write('debug', msg, fields),
	info: (msg: string, fields?: Fields) => write('info', msg, fields),
	warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
	error: (msg: string, fields?: Fields) => {
		write('error', msg, fields);
		if (fields?.err instanceof Error) {
			captureException(fields.err, { extra: { msg, requestId: currentRequestId() } });
		}
	}
};
