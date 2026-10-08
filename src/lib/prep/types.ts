// Shared types for the opponent prep feature.
// Used by both the Web Worker (PGN parsing) and the server API endpoints.

/** A single aggregated move from the opponent's games, ready for DB persistence. */
export interface AggregatedMove {
	positionFen: string; // 4-field normalized FEN
	moveSan: string; // Standard Algebraic Notation
	opponentColor: 'w' | 'b'; // which color the opponent was playing in these games
	resultingFen: string; // position after the move (4-field normalized)
	gamesPlayed: number;
	whiteWins: number;
	blackWins: number;
	draws: number;
}

// ── Web Worker message protocol ──────────────────────────────────────────────

/** Message sent TO the worker to start parsing. */
export interface WorkerParseMessage {
	type: 'parse';
	pgns: string[];
	opponentUsername: string;
}

/** Progress update FROM the worker (sent periodically during parsing). */
export interface WorkerProgressMessage {
	type: 'progress';
	completed: number;
	total: number;
}

/** Final result FROM the worker after all PGNs are parsed. */
export interface WorkerResultMessage {
	type: 'result';
	moves: AggregatedMove[];
	gamesAsWhite: number;
	gamesAsBlack: number;
}

/** Error FROM the worker if parsing fails. */
export interface WorkerErrorMessage {
	type: 'error';
	message: string;
}

/** Union of all messages the worker can send back. */
export type WorkerOutboundMessage =
	WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;
