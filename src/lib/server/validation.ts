// Shared request-body validation for API routes.
//
// Every JSON endpoint parses its body with `parseBody(request, schema)`, so a
// malformed request always gets the same response: HTTP 400 with a single
// human-readable message, in SvelteKit's usual `{ message }` error shape.
//
// Schemas live in src/lib/server/schemas/ (a +server.ts file may only export
// request handlers) and each one has unit tests next to it.

import { error } from '@sveltejs/kit';
import { z } from 'zod';

/**
 * Reads the request body as JSON and validates it against `schema`.
 * Throws 400 'Invalid JSON body' when the body is not JSON, or 400 with the
 * first validation problem when it does not match the schema.
 */
export async function parseBody<T extends z.ZodType>(
	request: Request,
	schema: T
): Promise<z.output<T>> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const result = validate(schema, raw);
	if (!result.success) throw error(400, result.message);
	return result.data;
}

/**
 * Validates an already-parsed value. Returns the parsed data, or the message
 * a client would receive. Exported so schema tests can assert on messages
 * without building Request objects.
 */
export function validate<T extends z.ZodType>(
	schema: T,
	value: unknown
): { success: true; data: z.output<T> } | { success: false; message: string } {
	const result = schema.safeParse(value, { error: defaultMessage });
	if (result.success) return { success: true, data: result.data };
	return { success: false, message: result.error.issues[0].message };
}

// Fallback wording for issues whose schema did not set its own message.
// A message set on the schema itself (`{ error: '...' }`) always wins, so
// routes can keep user-facing wording where the UI displays it.
function defaultMessage(issue: z.core.$ZodRawIssue): string {
	const field = fieldName(issue.path);

	switch (issue.code) {
		case 'invalid_type':
			if (issue.input === undefined) return `${field} is required`;
			return `${field} must be ${article(String(issue.expected))}`;
		case 'invalid_value':
			return `${field} must be one of: ${issue.values.map((v) => JSON.stringify(v)).join(', ')}`;
		case 'too_small':
			if (issue.origin === 'string') {
				return issue.minimum === 1
					? `${field} must not be empty`
					: `${field} must be at least ${issue.minimum} characters`;
			}
			if (issue.origin === 'array') {
				return issue.minimum === 1
					? `${field} must not be empty`
					: `${field} must have at least ${issue.minimum} items`;
			}
			return `${field} must be at least ${issue.minimum}`;
		case 'too_big':
			if (issue.origin === 'string') return `${field} must be at most ${issue.maximum} characters`;
			if (issue.origin === 'array') return `${field} must have at most ${issue.maximum} items`;
			return `${field} must be at most ${issue.maximum}`;
		default:
			return `${field} is invalid`;
	}
}

// ['moves', 0, 'san'] -> 'moves[0].san'; the root value is the request body.
function fieldName(path: PropertyKey[] | undefined): string {
	if (!path || path.length === 0) return 'Request body';
	return path
		.map((key, i) =>
			typeof key === 'number' ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`
		)
		.join('');
}

function article(expected: string): string {
	if (expected === 'int') return 'an integer';
	return /^[aeiou]/.test(expected) ? `an ${expected}` : `a ${expected}`;
}
