// PGN variation tree parser — walks mainline + all parenthetical variations
// and replays each line through Chess.js to produce FEN-keyed edges.
//
// Chess.js's loadPgn() silently drops variations, so we need a custom
// tokenizer that understands PGN nesting, then replay for FEN computation.
//
// Annotations: PGN comments {like this} are preserved and attached to the
// preceding move as `annotation`. Engine-specific tags like [%evp ...] and
// [%cal ...] are filtered out since they're not human-readable.

import { Chess } from 'chess.js';
import { fenKey, STARTING_FEN } from '$lib/fen';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single edge in the repertoire tree extracted from a PGN. */
export interface PgnEdge {
	fromFen: string;
	toFen: string;
	san: string;
	isUserTurn: boolean;
	/** Human-readable annotation from PGN comments, or null. */
	annotation: string | null;
}

// Internal: a node in the parsed move tree.
interface MoveNode {
	san: string;
	comment: string | null; // annotation text following this move
	variations: MoveNode[][]; // alternative continuations from the SAME position as this move
}

// ─── Comment cleaning ───────────────────────────────────────────────────────

/** Prefix used to mark comment tokens in the token stream. */
const COMMENT_PREFIX = '\x00CMT:';

/**
 * Clean a raw PGN comment into a human-readable annotation.
 * Strips engine tags like [%evp ...], [%cal ...], [%csl ...].
 * Returns null if nothing meaningful remains.
 */
function cleanComment(raw: string): string | null {
	let text = raw;

	// Remove engine-specific tags: [%evp 0,15,...], [%cal Re2e4], [%csl Gf3], etc.
	text = text.replace(/\[%[^\]]*\]/g, '');

	// Collapse whitespace and trim
	text = text.replace(/\s+/g, ' ').trim();

	return text.length > 0 ? text : null;
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

/** Token marking the end of one game in a multi-game PGN. */
const GAME_END = '\x00END';
/** Token standing in for a header tag, so a header after movetext starts a new game. */
const HEADER = '\x00HDR';

// A tag pair like [Event "Club [A] champs"]: the value may contain `]` and
// escaped quotes, so a plain `\[[^\]]*\]` would stop inside it.
const HEADER_TAG = /\[\s*\w+\s+"(?:[^"\\]|\\.)*"\s*\]/g;

/**
 * Tokenize raw PGN text into a flat array of tokens: SAN moves, '(', ')',
 * comment tokens (prefixed with COMMENT_PREFIX), and GAME_END / HEADER
 * markers for splitting a multi-game file. Strips NAGs and move numbers.
 */
function tokenize(rawPgn: string): string[] {
	let pgn = rawPgn;

	// Extract comments {anything} first, before headers, so that square
	// brackets inside a comment ({see [note]}) aren't mistaken for a tag.
	// Comments can span multiple lines. We replace each with a unique
	// marker so they survive the remaining text transformations.
	const comments: string[] = [];
	pgn = pgn.replace(/\{([^}]*)\}/g, (_match, content: string) => {
		const idx = comments.length;
		comments.push(content);
		return ` ${COMMENT_PREFIX}${idx} `;
	});

	pgn = pgn.replace(HEADER_TAG, ` ${HEADER} `);

	// Strip NAGs: $1, $2, etc. and symbolic NAGs like !, ?, !!, ??, !?, ?!
	pgn = pgn.replace(/\$\d+/g, '');
	pgn = pgn.replace(/[!?]{1,2}/g, '');

	// Result markers (1-0, 0-1, 1/2-1/2, *) end a game.
	pgn = pgn.replace(/\b1-0\b|\b0-1\b|\b1\/2-1\/2\b|\*/g, ` ${GAME_END} `);

	// Strip move numbers: "1." "1..." "12." "12..." etc.
	// Must be careful not to eat castling notation (O-O, O-O-O).
	pgn = pgn.replace(/\d+\.{1,3}/g, '');

	// Now split on whitespace, keeping ( and ) as separate tokens.
	// First, ensure parens are space-separated from adjacent text.
	pgn = pgn.replace(/\(/g, ' ( ');
	pgn = pgn.replace(/\)/g, ' ) ');

	const rawTokens = pgn.split(/\s+/).filter((t) => t.length > 0);

	// Resolve comment placeholders back into COMMENT_PREFIX tokens with content
	return rawTokens.map((t) => {
		if (t.startsWith(COMMENT_PREFIX)) {
			const idx = parseInt(t.slice(COMMENT_PREFIX.length));
			return COMMENT_PREFIX + (comments[idx] ?? '');
		}
		return t;
	});
}

const hasMoves = (tokens: string[]) => tokens.some((t) => !t.startsWith(COMMENT_PREFIX));

/**
 * Split a token stream into one token list per game. A game ends at a result
 * marker, or where a header block follows movetext (a file without results).
 */
function splitGames(tokens: string[]): string[][] {
	const games: string[][] = [];
	let current: string[] = [];
	const flush = () => {
		if (hasMoves(current)) games.push(current);
		current = [];
	};
	for (const token of tokens) {
		if (token === GAME_END) flush();
		else if (token === HEADER) {
			if (hasMoves(current)) flush();
		} else current.push(token);
	}
	flush();
	return games;
}

/** Number of games with moves in a PGN text. */
export function countPgnGames(rawPgn: string): number {
	return splitGames(tokenize(rawPgn)).length;
}

/**
 * Parse a flat token stream into a tree of MoveNodes.
 *
 * The key PGN rule: a variation `(...)` is an alternative to the move
 * IMMEDIATELY BEFORE the opening paren. It branches from the position
 * that existed before that move was played.
 *
 * Comment tokens (COMMENT_PREFIX) are attached to the preceding move node.
 */
function buildTree(tokens: string[], errors: string[]): MoveNode[] {
	let pos = 0;

	function parseLine(depth: number): MoveNode[] {
		const nodes: MoveNode[] = [];

		while (pos < tokens.length) {
			const token = tokens[pos];

			if (token === ')') {
				if (depth > 0) {
					// End of current variation — don't consume the ')' here,
					// let the caller handle it.
					break;
				}
				// A stray ')' outside any variation used to end the parse
				// silently, dropping the rest of the game. Skip it and say so.
				errors.push("Unmatched ')' ignored");
				pos++;
			} else if (token.startsWith(COMMENT_PREFIX)) {
				// Comment token — attach to the preceding move (if any)
				if (nodes.length > 0) {
					const cleaned = cleanComment(token.slice(COMMENT_PREFIX.length));
					if (cleaned && !nodes[nodes.length - 1].comment) {
						nodes[nodes.length - 1].comment = cleaned;
					}
				}
				pos++;
			} else if (token === '(') {
				// Start of a variation: alternative to the LAST move in `nodes`.
				pos++; // consume '('
				const variation = parseLine(depth + 1);
				pos++; // consume ')'

				// Attach the variation to the preceding move node.
				// If there's no preceding move (variation at start), skip it.
				if (nodes.length > 0) {
					nodes[nodes.length - 1].variations.push(variation);
				}
			} else {
				// It's a SAN move token.
				nodes.push({ san: token, comment: null, variations: [] });
				pos++;
			}
		}

		return nodes;
	}

	return parseLine(0);
}

// ─── Replay ─────────────────────────────────────────────────────────────────

/**
 * Walk the move tree recursively, replaying through Chess.js to compute FENs.
 * Collects edges and any errors (illegal moves).
 */
function replayTree(
	nodes: MoveNode[],
	startFen: string,
	repertoireColor: 'WHITE' | 'BLACK',
	edges: Map<string, PgnEdge>,
	errors: string[],
	moveContext: string[] // for error messages, e.g. ["1.d4", "Nf6", "2.Nc3"]
): void {
	const chess = new Chess(startFen);

	for (const node of nodes) {
		const fromFen = fenKey(chess.fen());

		// Try to play the move
		let result;
		try {
			result = chess.move(node.san);
		} catch {
			// Illegal move — skip this node and everything after it in this line.
			errors.push(`Invalid move '${node.san}' after ${moveContext.join(' ') || 'start position'}`);
			return;
		}

		if (!result) {
			errors.push(`Invalid move '${node.san}' after ${moveContext.join(' ') || 'start position'}`);
			return;
		}

		const toFen = fenKey(chess.fen());
		const san = result.san; // Use Chess.js's normalized SAN

		// Determine if this is the user's turn
		const fenTurn = fromFen.split(' ')[1]; // 'w' or 'b'
		const isUserTurn =
			(repertoireColor === 'WHITE' && fenTurn === 'w') ||
			(repertoireColor === 'BLACK' && fenTurn === 'b');

		// Deduplicate by fenKey + san (transpositions produce identical edges).
		// Keep the first annotation found — don't overwrite with null.
		const edgeKey = fenKey(fromFen) + '|' + san;
		const existing = edges.get(edgeKey);
		if (!existing) {
			edges.set(edgeKey, { fromFen, toFen, san, isUserTurn, annotation: node.comment });
		} else if (!existing.annotation && node.comment) {
			existing.annotation = node.comment;
		}

		const newContext = [...moveContext, san];

		// Process variations BEFORE continuing the mainline.
		// Each variation branches from `fromFen` (the position before this move).
		for (const variation of node.variations) {
			replayTree(variation, fromFen, repertoireColor, edges, errors, moveContext);
		}

		// Update context for the next move in this line
		moveContext = newContext;
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a PGN string with variations and produce a deduplicated list of
 * repertoire edges (fromFen → toFen via san).
 *
 * Handles nested variations of arbitrary depth and files with several
 * games. Invalid moves within a variation skip that sub-line and collect an
 * error message.
 *
 * PGN comments are preserved as annotations on edges. Engine-specific
 * tags like [%evp ...] are stripped.
 */
export function parseVariationPgn(
	rawPgn: string,
	repertoireColor: 'WHITE' | 'BLACK'
): { edges: PgnEdge[]; errors: string[] } {
	const pgn = rawPgn.trim();
	if (!pgn) throw new Error('PGN is empty');

	// Reject custom starting positions
	if (/\[\s*SetUp\s+"1"\s*\]/i.test(pgn)) {
		throw new Error(
			'Custom starting positions are not supported — only standard games can be imported'
		);
	}

	// A multi-game file (a Lichess study export has one game per chapter) is
	// replayed game by game from the start position, and the edges merged.
	const games = splitGames(tokenize(pgn));
	const edges = new Map<string, PgnEdge>();
	const errors: string[] = [];
	let anyMoves = false;

	for (const tokens of games) {
		const tree = buildTree(tokens, errors);
		if (tree.length === 0) continue;
		anyMoves = true;
		replayTree(tree, STARTING_FEN, repertoireColor, edges, errors, []);
	}
	if (!anyMoves) throw new Error('PGN contains no moves');

	return { edges: Array.from(edges.values()), errors };
}
