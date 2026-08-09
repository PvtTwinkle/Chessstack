// Rating bracket definitions for the Players tab.
//
// The numeric ID (0–7) is stored in the database and passed through the API.
// The label is displayed in the UI dropdown. Bracket 0 covers the wide beginner
// range (0–1000); above that, each bracket is 200 ELO wide.
// Games with players rated 2400+ are excluded (covered by the Masters/Chessmont tab).

export const RATING_BRACKETS = [
	{ id: 0, label: '0–1000', min: 0, max: 1000 },
	{ id: 1, label: '1001–1200', min: 1001, max: 1200 },
	{ id: 2, label: '1201–1400', min: 1201, max: 1400 },
	{ id: 3, label: '1401–1600', min: 1401, max: 1600 },
	{ id: 4, label: '1601–1800', min: 1601, max: 1800 },
	{ id: 5, label: '1801–2000', min: 1801, max: 2000 },
	{ id: 6, label: '2001–2200', min: 2001, max: 2200 },
	{ id: 7, label: '2201–2400', min: 2201, max: 2400 }
] as const;

export const DEFAULT_BRACKET_ID = 3; // 1401–1600

/** Returns the bracket ID (0–7) for a given ELO rating, or null if >= 2400. */
export function bracketForRating(elo: number): number | null {
	if (elo >= 2400) return null;
	if (elo <= 1000) return 0;
	// 1001–1200 → 1, 1201–1400 → 2, 1401–1600 → 3, etc.
	return Math.min(7, Math.floor((elo - 1001) / 200) + 1);
}

// Gap Finder rating window — how many brackets below/above the trainer rating's
// own bracket to include when aggregating Lichess player popularity data.
// Asymmetric on purpose: online pairing skews toward opponents at or above your
// own rating almost as often as below it, and -1/+2 gives more headroom on the
// upper side where a single bracket alone tends to be sparser at deeper plies.
const GAP_BRACKET_WINDOW_BELOW = 1;
const GAP_BRACKET_WINDOW_ABOVE = 2;

/**
 * Returns the rating-bracket window used by the Gap Finder for a given
 * trainer rating: the bracket IDs to aggregate, and a human-readable label
 * of the resulting ELO range for display next to the gap list.
 *
 * Falls back to DEFAULT_BRACKET_ID (and its own ±1/+2 window) when
 * trainerRating is null (trainer mode not yet set up) or >= 2400 (outside
 * the Players tab's bracket range entirely, since bracket 7 tops out at 2400).
 */
export function gapRatingWindow(trainerRating: number | null): {
	brackets: number[];
	label: string;
} {
	const rawCenter = trainerRating !== null ? bracketForRating(trainerRating) : null;
	const center = rawCenter ?? DEFAULT_BRACKET_ID;

	const minId = Math.max(0, center - GAP_BRACKET_WINDOW_BELOW);
	const maxId = Math.min(7, center + GAP_BRACKET_WINDOW_ABOVE);
	const brackets = Array.from({ length: maxId - minId + 1 }, (_, i) => minId + i);

	const label = `${RATING_BRACKETS[minId].min}–${RATING_BRACKETS[maxId].max}`;

	return { brackets, label };
}
