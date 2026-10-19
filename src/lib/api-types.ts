// Response shapes shared by API routes and the components that call them, so
// a server change fails type-checking where the response is used.

/** One move's results in the Masters, Players and Stars tabs. */
export interface MastersMove {
	san: string;
	white: number; // games won by white after this move
	draws: number;
	black: number; // games won by black after this move
	totalGames: number; // white + draws + black
}

/** GET /api/masters, /api/players and /api/stars. */
export interface MastersResponse {
	moves: MastersMove[];
	totalGames: number; // aggregate across all moves at this position
}

/** One entry of GET /api/stars/players. */
export interface StarPlayer {
	slug: string;
	displayName: string;
	category: string | null;
}

/**
 * One candidate in the Book and Engine tabs. Book moves (POST /api/book)
 * carry no evaluation; engine moves carry no annotation.
 */
export interface Candidate {
	san: string; // move in Standard Algebraic Notation, e.g. "e4", "Nf3"
	uci: string; // UCI notation, e.g. "e2e4"
	evalCp: number | null;
	evalMate: number | null;
	isBook: boolean;
	annotation: string | null; // curator note, e.g. "main line"
	openingName: string | null; // ECO opening name for the position this move leads to
}
