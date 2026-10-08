// Types shared by Drill mode (src/routes/drill) and its components/helpers.

/** A move row from the server (user_move table). */
export interface RepertoireMove {
	id: number;
	fromFen: string;
	toFen: string;
	san: string;
	notes: string | null;
}

/** A due spaced-repetition card from the server (user_repertoire_move table). */
export interface DueCard {
	id: number;
	fromFen: string;
	san: string;
	state: number | null;
	due: string | null;
	stability: number | null;
	difficulty: number | null;
	elapsedDays: number | null;
	scheduledDays: number | null;
	reps: number | null;
	lapses: number | null;
	lastReview: string | null;
	learningSteps: number;
	intervalLabels: {
		forgot: string;
		unsure: string;
		easy: string;
	};
}

/** Snapshot of a card's FSRS state before grading — used for undo. */
export interface UndoSnapshot {
	cardId: number;
	wasCorrect: boolean;
	previousState: {
		due: string | null;
		stability: number | null;
		difficulty: number | null;
		elapsedDays: number | null;
		scheduledDays: number | null;
		reps: number | null;
		lapses: number | null;
		state: number | null;
		lastReview: string | null;
		learningSteps: number;
	};
}

/** One step in the current navigation path through the board. */
export interface NavEntry {
	fromFen: string;
	toFen: string;
	san: string;
	from: string;
	to: string;
}

/** One step in a root-to-leaf line through the repertoire tree. */
export interface LineStep {
	fromFen: string;
	toFen: string;
	san: string;
	isUserMove: boolean; // true when it's the user's color to move
}

export type Phase = 'idle' | 'playing' | 'waiting' | 'correct' | 'incorrect' | 'complete';

export type DrillSection = 'foundations' | 'mainlines' | 'deep';
