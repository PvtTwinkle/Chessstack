// Browser side of building a prep: parse the fetched PGNs in a Web Worker,
// then upload the aggregated moves in batches and commit them in one step.
// Shared by the new-prep form and the refresh on the prep page.

import { PREP_UPLOAD_BATCH_MAX } from '$lib/validation-limits';
// Inlined, so the worker starts from a blob: URL. The page is cross-origin
// isolated (COEP, see $lib/server/security-headers.ts) and a worker loaded from its own URL
// would need that header too, which the static /_app files don't get.
import PrepParserWorker from '../workers/prepParser.worker?worker&inline';
import type { AggregatedMove, WorkerOutboundMessage, WorkerParseMessage } from './types';

export interface ParseResult {
	moves: AggregatedMove[];
	gamesAsWhite: number;
	gamesAsBlack: number;
}

/**
 * Parses PGNs in the prep worker, reporting progress as games complete.
 * Aborting `signal` (the page was left) stops the worker at once.
 */
export function parseInWorker(
	pgns: string[],
	opponentUsername: string,
	onProgress: (completed: number, total: number) => void,
	signal?: AbortSignal
): Promise<ParseResult> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Parsing was cancelled', 'AbortError'));
			return;
		}
		const worker = new PrepParserWorker();
		signal?.addEventListener(
			'abort',
			() => {
				worker.terminate();
				reject(new DOMException('Parsing was cancelled', 'AbortError'));
			},
			{ once: true }
		);

		worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
			const msg = event.data;
			if (msg.type === 'progress') {
				onProgress(msg.completed, msg.total);
			} else if (msg.type === 'result') {
				worker.terminate();
				resolve(msg);
			} else if (msg.type === 'error') {
				worker.terminate();
				reject(new Error(msg.message));
			}
		};

		worker.onerror = (e) => {
			worker.terminate();
			reject(new Error(e.message || 'Worker error'));
		};

		const message: WorkerParseMessage = { type: 'parse', pgns, opponentUsername };
		worker.postMessage(message);
	});
}

/**
 * The message for a failed game fetch: the platform's rate limit gets its own
 * explanation, anything else the server's message.
 */
export async function fetchErrorMessage(res: Response): Promise<string> {
	if (res.status === 429) {
		return 'The platform is limiting how often games can be downloaded. Wait a minute and try again.';
	}
	const err = await res.json().catch(() => null);
	return err?.message || `Fetching games failed (${res.status})`;
}

/** POSTs JSON and returns the parsed response, throwing the server's message on failure. */
export async function postJson<T>(url: string, body: unknown, failure: string): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => null);
		throw new Error(err?.message || `${failure} (${res.status})`);
	}
	return res.json();
}

/**
 * Sends a pending upload's moves in batches, then commits them. Nothing
 * becomes visible until the commit, so a failure partway leaves the existing
 * prep (or, for a new prep, nothing) as it was. Returns the live prep's id.
 */
export async function uploadPrepMoves(
	base: string,
	uploadId: number,
	result: ParseResult,
	timeWindow: string,
	onProgress: (batch: number, total: number) => void
): Promise<number> {
	const url = `${base}/api/prep/${uploadId}/refresh`;
	const total = Math.ceil(result.moves.length / PREP_UPLOAD_BATCH_MAX);

	for (let i = 0; i < result.moves.length; i += PREP_UPLOAD_BATCH_MAX) {
		const batch = i / PREP_UPLOAD_BATCH_MAX + 1;
		onProgress(batch, total);
		await postJson(
			url,
			{ mode: 'merge-batch', moves: result.moves.slice(i, i + PREP_UPLOAD_BATCH_MAX) },
			`Save batch ${batch} failed`
		);
	}

	const { prepId } = await postJson<{ prepId: number }>(
		url,
		{
			mode: 'merge-commit',
			timeWindow,
			gamesAsWhite: result.gamesAsWhite,
			gamesAsBlack: result.gamesAsBlack
		},
		'Save failed'
	);
	return prepId;
}
