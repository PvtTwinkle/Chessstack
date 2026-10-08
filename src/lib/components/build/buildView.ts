/**
 * buildView.ts — pure helpers for what the Build Mode sidebar shows.
 *
 * Kept free of Svelte so the rules can be unit-tested on their own.
 */

import { fenKey, STARTING_FEN } from '$lib/fen';

/**
 * Which start-position chip the action bar shows:
 *   'active' — this position is the repertoire's start ("Start Position ✕")
 *   'set'    — a position away from the initial one ("Set Start")
 *   'clear'  — back at the initial position while a custom start exists ("Clear Start")
 *   null     — nothing to show
 */
export type StartChip = 'active' | 'set' | 'clear' | null;

export function startPositionChip(opts: {
	currentFen: string;
	startFen: string | null;
	isStartPosition: boolean;
	lineLength: number;
}): StartChip {
	const atInitial = fenKey(opts.currentFen) === fenKey(STARTING_FEN);
	if (opts.isStartPosition) return 'active';
	if (!atInitial && opts.lineLength > 0) return 'set';
	if (opts.startFen && atInitial) return 'clear';
	return null;
}

/** Link that drills every card downstream of this position. */
export function drillHereUrl(fen: string): string {
	return `/drill?mode=all&fromFen=${encodeURIComponent(fen)}`;
}

/** Link that opens this position on the Lichess analysis board. */
export function lichessAnalysisUrl(fen: string, orientation: 'white' | 'black'): string {
	return `https://lichess.org/analysis/${(fen + ' 0 1').replaceAll(' ', '_')}?color=${orientation}`;
}

// Saved-move notes longer than this are cut short in the sidebar.
const NOTE_PREVIEW_CHARS = 80;

/** Short preview of a move's notes for the sidebar. */
export function notePreview(notes: string): string {
	return notes.length > NOTE_PREVIEW_CHARS ? notes.slice(0, NOTE_PREVIEW_CHARS) + '…' : notes;
}

/** Fire-and-forget PATCH of the user's settings (board size, tab preferences, tutorial step). */
export function patchSettings(body: Record<string, unknown>): Promise<Response> {
	return fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}
