/**
 * What the board (and the "type a move" box) calls after the user makes a
 * legal move: origin and destination squares, the SAN (which already names
 * any promotion piece, e.g. "e8=N"), the FEN after the move, whether a piece
 * was captured (for the sound), and the promotion piece ('q', 'r', 'b' or
 * 'n') when the move promotes.
 *
 * The handler accepts the move by passing the new FEN back as the board's
 * `fen`. When it leaves `fen` as it was (a wrong drill move, a failed save),
 * the board puts the piece back. A handler that saves first can return its
 * promise; the board waits for it before deciding.
 */
export type BoardMoveHandler = (
	from: string,
	to: string,
	san: string,
	newFen: string,
	isCapture: boolean,
	promotion?: string
) => void | Promise<unknown>;
