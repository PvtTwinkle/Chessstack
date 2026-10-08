// Engine-evaluation helpers for Review mode: formatting evals from the
// player's perspective and classifying moves by centipawn loss (CPL).
//
// Engine evals are always from White's perspective; the helpers that display
// them take the player's colour and flip the sign for Black, so that positive
// always means "good for me".

export type PlayerColor = 'WHITE' | 'BLACK';

/** An engine evaluation from White's perspective. */
export interface PositionEval {
	evalCp: number | null;
	evalMate: number | null;
}

export type CplClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Centipawn eval as a short label from the player's perspective, e.g. "(+1.5)" or "(=)". */
export function formatEval(cp: number, color: PlayerColor): string {
	const playerCp = color === 'BLACK' ? -cp : cp;
	const pawns = Math.abs(playerCp) / 100;
	if (playerCp === 0) return '(=)';
	return playerCp > 0 ? `(+${pawns.toFixed(1)})` : `(−${pawns.toFixed(1)})`;
}

/** CSS class for an eval badge: good / bad beyond half a pawn, neutral otherwise. */
export function evalBadgeClass(cp: number, color: PlayerColor): string {
	const playerCp = color === 'BLACK' ? -cp : cp;
	if (playerCp > 50) return 'eval-badge-good';
	if (playerCp < -50) return 'eval-badge-bad';
	return 'eval-badge-neutral';
}

/**
 * A single centipawn number for an eval. Mate scores become large centipawn
 * equivalents (closer mates are bigger) so CPL arithmetic works uniformly.
 */
export function evalToWhiteCp(ev: PositionEval): number | null {
	if (ev.evalCp != null) return ev.evalCp;
	if (ev.evalMate != null) {
		const sign = ev.evalMate > 0 ? 1 : -1;
		return sign * (10000 - Math.abs(ev.evalMate) * 10);
	}
	return null;
}

/**
 * Centipawns lost by the move at `ply` (1-based; White moves on odd plies).
 * `evals` maps position index → eval, where 0 is the starting position and N is
 * the position after ply N. Returns null until both surrounding evals exist.
 */
export function computeCpl(ply: number, evals: ReadonlyMap<number, PositionEval>): number | null {
	const evalBefore = evals.get(ply - 1);
	const evalAfter = evals.get(ply);
	if (!evalBefore || !evalAfter) return null;
	const cpBefore = evalToWhiteCp(evalBefore);
	const cpAfter = evalToWhiteCp(evalAfter);
	if (cpBefore === null || cpAfter === null) return null;
	const isWhiteMove = ply % 2 === 1;
	const raw = isWhiteMove ? cpBefore - cpAfter : cpAfter - cpBefore;
	return Math.max(0, raw); // clamp to 0 (engine quirks can produce tiny negatives)
}

/** Classify a CPL value into one of five quality buckets. */
export function getCplClass(cpl: number): CplClass {
	if (cpl <= 10) return 'best';
	if (cpl <= 50) return 'good';
	if (cpl <= 100) return 'inaccuracy';
	if (cpl <= 200) return 'mistake';
	return 'blunder';
}

/** A position eval for the inline badge, from the player's perspective ("M3", "-M2", "(+0.4)"). */
export function formatPositionEval(ev: PositionEval, color: PlayerColor): string {
	if (ev.evalMate != null) {
		const playerMate = color === 'BLACK' ? -ev.evalMate : ev.evalMate;
		return playerMate > 0 ? `M${Math.abs(playerMate)}` : `-M${Math.abs(playerMate)}`;
	}
	if (ev.evalCp != null) return formatEval(ev.evalCp, color);
	return '';
}

/** A 1-based ply as a move-number label: ply 3 → "2." (White), ply 4 → "2…" (Black). */
export function plyToLabel(ply: number): string {
	const moveNum = Math.ceil(ply / 2);
	const isWhitePly = ply % 2 === 1;
	return isWhitePly ? `${moveNum}.` : `${moveNum}…`;
}

/** Whether the move at `ply` was played by the reviewing player. */
export function isUserPly(ply: number, color: PlayerColor): boolean {
	return (color === 'WHITE' && ply % 2 === 1) || (color === 'BLACK' && ply % 2 === 0);
}
