// Tutorial step definitions.
//
// The saved tutorial_step is an index into TUTORIAL_STEPS, so steps must only
// ever be appended: inserting or removing one would move every user who is
// part-way through. Step 0 is a placeholder for the onboarding screen.
//
// Each step describes what the user sees and how they advance.
// Steps with autoAdvance = true are advanced by page-level code
// (e.g. after moves are played or cards are graded), not by a button.

export type TutorialStepId =
	| 'welcome'
	| 'build-first-moves'
	| 'build-tools'
	| 'build-done'
	| 'drill-first-cards'
	| 'drill-options'
	| 'train'
	| 'puzzles'
	| 'review'
	| 'prep'
	| 'dashboard'
	| 'report';

export interface TutorialStepDef {
	// Stable name for code that advances the tutorial, so callers don't
	// hard-code positions in this list.
	id: TutorialStepId;
	page: string; // expected pathname prefix
	pageLabel: string; // the page's name in the nav, for "go to the X page"
	title: string;
	body: string;
	nextLabel?: string; // button text (omitted for auto-advance steps)
	navTo?: string; // if set, next/button navigates here
	autoAdvance?: boolean; // step advances by code, not by button click
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
	// Step 0 is handled by OnboardingWelcome — no overlay needed
	{
		id: 'welcome',
		page: '/',
		pageLabel: 'Dashboard',
		title: 'Welcome',
		body: '',
		autoAdvance: true
	},
	{
		id: 'build-first-moves',
		page: '/build',
		pageLabel: 'Build',
		title: 'Build Your Repertoire',
		body: 'Play moves on the board to build your repertoire. Drag a piece or click to move. Each move saves automatically. Use the suggestion tabs on the right (Book, Masters, Stars, Players, Engine) to find the best moves. Play 8 moves to continue.',
		autoAdvance: true
	},
	{
		id: 'build-tools',
		page: '/build',
		pageLabel: 'Build',
		title: 'More Build Tools',
		body: 'Switch to Explore mode to try moves without saving them. You can also import or export PGN, and use arrow keys to navigate through your lines.',
		nextLabel: 'Got it'
	},
	{
		id: 'build-done',
		page: '/build',
		pageLabel: 'Build',
		title: "You're Off to a Great Start!",
		body: "You've built the beginning of your repertoire. Now let's practice these moves with spaced repetition.",
		nextLabel: 'Go to Drill',
		navTo: '/drill'
	},
	{
		id: 'drill-first-cards',
		page: '/drill',
		pageLabel: 'Drill',
		title: 'Drill Mode',
		body: 'The board will replay your opening line, then pause at your turn. Play the correct move from memory. After each card, grade yourself: Again, Good, or Easy. Try a few cards now!',
		autoAdvance: true
	},
	{
		id: 'drill-options',
		page: '/drill',
		pageLabel: 'Drill',
		title: 'Drill Options',
		body: 'In Cards mode you can focus on Foundation, Mainlines, or Deep Lines. Switch to Lines mode to practice entire variations. Try Blindfold mode for an extra challenge.',
		nextLabel: 'Continue',
		navTo: '/train'
	},
	{
		id: 'train',
		page: '/train',
		pageLabel: 'Train',
		title: 'Opening Trainer',
		body: 'Play against a computer that mimics human moves, weighted by popularity from the Lichess rating brackets or Masters database. Games end when the database runs out of moves or you hit your depth limit. Rated sessions track your Elo so you can measure progress. Afterwards, review the game to spot deviations and grow your repertoire without playing real opponents.',
		nextLabel: 'Continue',
		navTo: '/puzzles'
	},
	{
		id: 'puzzles',
		page: '/puzzles',
		pageLabel: 'Puzzles',
		title: 'Puzzle Training',
		body: 'Solve puzzles drawn from your repertoire openings. Filter further by rating, theme, or color to target specific weaknesses.',
		nextLabel: 'Continue',
		navTo: '/review'
	},
	{
		id: 'review',
		page: '/review',
		pageLabel: 'Review',
		title: 'Game Review',
		body: 'Paste a PGN or import games from Lichess/Chess.com. The app shows where you or your opponent deviated from your repertoire so you can add new lines or assign training for missed moves.',
		nextLabel: 'Continue',
		navTo: '/prep'
	},
	{
		id: 'prep',
		page: '/prep',
		pageLabel: 'Prep',
		title: 'Opponent Prep',
		body: 'Prepare for a specific opponent by entering their username (e.g. PvtTwinkleToes on Chess.com) to download their games. See what they play, prepare your responses, and export to a repertoire to drill.',
		nextLabel: 'Continue',
		navTo: '/'
	},
	{
		id: 'dashboard',
		page: '/',
		pageLabel: 'Dashboard',
		title: 'Your Dashboard',
		body: 'Welcome to your home base. Track due cards, mastery, streaks, and your health score at a glance. Scroll down to find gaps in your repertoire and moves you keep getting wrong.',
		nextLabel: 'Continue',
		navTo: '/report'
	},
	{
		id: 'report',
		page: '/report',
		pageLabel: 'Report',
		title: 'Opening Report',
		body: 'Once you import your games, the report shows how your repertoire holds up in them: your score in each line, where you or your opponent leave book, and which moves you forget in drills. The "Fix this next" card at the top picks the one thing to work on.',
		nextLabel: 'Finish Tutorial'
	}
];

export const TOTAL_STEPS = TUTORIAL_STEPS.length;

/** The saved tutorial_step value for a step. */
export function stepIndex(id: TutorialStepId): number {
	return TUTORIAL_STEPS.findIndex((step) => step.id === id);
}
