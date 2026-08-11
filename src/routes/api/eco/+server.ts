// POST /api/eco
//
// Given a list of FEN strings (current position first, then move history
// going backwards), returns the most specific ECO opening name match.
//
// Request body: { fens: string[] }
// Response:     { code: string; name: string } | null
//
// Why POST instead of GET?
//   FEN strings contain spaces and special characters that make URL-encoding
//   awkward, especially when passing a whole list of them. A POST body is
//   cleaner and less fragile.
//
// Why a list of FENs instead of just one?
//   The current position may be past the last named ECO position (e.g. the
//   user is on move 10 in the Najdorf). Passing the full history lets the
//   server walk backwards and find the most specific recognised name.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lookupEco } from '$lib/eco';
import { fenKey } from '$lib/fen';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (
		typeof body !== 'object' ||
		body === null ||
		!Array.isArray((body as Record<string, unknown>).fens)
	) {
		throw error(400, 'Request body must be { fens: string[] }');
	}

	const { fens } = body as { fens: unknown[] };

	// Validate that every element is a non-empty string with valid FEN structure.
	// This is user-supplied data coming from the board position — sanitise it.
	const PIECE_PLACEMENT = /^[1-8pnbrqkPNBRQK/]+$/;
	const fenList = fens.filter((f): f is string => {
		if (typeof f !== 'string' || f.length === 0 || f.length > 100) return false;
		const parts = f.split(' ');
		if (parts.length < 4 || parts.length > 6) return false;
		if (!PIECE_PLACEMENT.test(parts[0])) return false;
		if (parts[1] !== 'w' && parts[1] !== 'b') return false;
		return true;
	});

	// Cap at 50 FENs — a typical opening is 15–20 moves deep, so this is
	// generous while preventing abuse of the IN clause.
	//
	// eco_opening.fen is stored 4-field normalized (see migration
	// 0011_normalize_fen_4field.sql), but every client that calls this
	// endpoint (OpeningName.svelte) sends chess.js's native 6-field FENs.
	// Without normalizing here, the exact-match lookup in eco.ts can never
	// succeed for anything, on any page — this was silently broken app-wide,
	// not specific to any one feature.
	const normalizedFens = fenList.map(fenKey);
	const result = await lookupEco(db, normalizedFens.slice(0, 50));

	return json(result);
};
