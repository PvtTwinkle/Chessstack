// The user's engine preferences (Settings → Analysis) as search limits.

import { MAX_STOCKFISH_DEPTH, MIN_STOCKFISH_DEPTH } from '$lib/validation-limits';

// Defaults for a user without a settings row.
const DEFAULT_DEPTH = 20;
const DEFAULT_TIMEOUT_S = 10;

export interface EngineSettings {
	depth: number;
	timeoutMs: number;
}

export function engineSettings(
	settings: { stockfishDepth?: number | null; stockfishTimeout?: number | null } | null | undefined
): EngineSettings {
	const depth = settings?.stockfishDepth ?? DEFAULT_DEPTH;
	return {
		depth: Math.max(MIN_STOCKFISH_DEPTH, Math.min(depth, MAX_STOCKFISH_DEPTH)),
		timeoutMs: (settings?.stockfishTimeout ?? DEFAULT_TIMEOUT_S) * 1000
	};
}
