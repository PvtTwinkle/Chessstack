// Web Worker — parses opponent PGNs and aggregates move statistics.
//
// Runs in a separate thread so the UI stays responsive while processing
// hundreds of games with chess.js. Communicates via postMessage; the work
// itself is aggregateGames(), which the unit tests call directly.

import { aggregateGames } from '$lib/prep/aggregate';
import type { WorkerParseMessage, WorkerOutboundMessage } from '$lib/prep/types';

/** Post progress updates every N games to avoid message flooding. */
const PROGRESS_INTERVAL = 10;

function post(msg: WorkerOutboundMessage): void {
	self.postMessage(msg);
}

self.onmessage = (event: MessageEvent<WorkerParseMessage>) => {
	try {
		if (event.data.type === 'parse') {
			const { pgns, opponentUsername } = event.data;
			const result = aggregateGames(pgns, opponentUsername, (completed, total) => {
				if (completed % PROGRESS_INTERVAL === 0) post({ type: 'progress', completed, total });
			});
			post({ type: 'result', ...result });
		}
	} catch (err) {
		post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
	}
};
