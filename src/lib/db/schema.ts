// Database schema — defined with Drizzle ORM.
//
// This file is the single source of truth for every table in the database.
// It is written in TypeScript, not SQL. Drizzle Kit reads this file and
// generates the actual SQL (CREATE TABLE statements) in drizzle/migrations/.
//
// Two groups of tables:
//   1. Shared book tables  — opening theory bundled with the app (read-only at runtime)
//   2. User tables         — personal repertoires, SR state, settings (never shared)

import {
	boolean,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BOOK TABLES
// Ships with the app as seed data. Never written to at runtime.
// Updated when the user pulls a new Docker image.
// ─────────────────────────────────────────────────────────────────────────────

// Every unique board position in the opening book, identified by its FEN string.
// FEN (Forsyth-Edwards Notation) is a standard text format that fully describes
// a chess position — piece placement, whose turn it is, castling rights, etc.
export const bookPosition = pgTable('book_position', {
	fen: text('fen').primaryKey()
});

// Individual moves within the shared opening book.
// Each row is one move: "from this position, this move leads to that position."
// UNIQUE(from_fen, san) ensures a single (position, move) pair is stored only once,
// even though hundreds of ECO lines share early moves like 1.e4 or 1.d4.
export const bookMove = pgTable(
	'book_move',
	{
		id: serial('id').primaryKey(),
		fromFen: text('from_fen').notNull(), // position before the move
		toFen: text('to_fen').notNull(), // position after the move
		san: text('san').notNull(), // move in Standard Algebraic Notation, e.g. "e4", "Nf3"
		annotation: text('annotation'), // curator notes, e.g. "main line", "aggressive"
		contributor: text('contributor') // name of the person who contributed this move
	},
	(table) => ({
		uniqueFromSan: unique().on(table.fromFen, table.san),
		// Dedicated single-column index for "all moves from this position" lookups.
		fromFenIdx: index('idx_book_move_from_fen').on(table.fromFen)
	})
);

// ECO (Encyclopaedia of Chess Openings) codes — the naming system for openings.
// Bundled statically so the app can show "B90 · Sicilian Defense, Najdorf Variation"
// without any network request.
//
// fen is the primary key because lookup is always by position, never by code.
// The same ECO code can cover many distinct named positions (e.g. "B90" covers
// the Najdorf plus a dozen sub-variations, each at a different FEN).
export const ecoOpening = pgTable('eco_opening', {
	fen: text('fen').primaryKey(), // the FEN of the position this name applies to
	code: text('code').notNull(), // e.g. "B90"
	name: text('name').notNull() // e.g. "Sicilian Defense, Najdorf Variation"
});

// Master game statistics from the Chessmont database (~21.5M master games, ELO >= 2500).
// Populated via pg_dump restore from the pre-built Chessmont dataset.
// Read-only at runtime — the app only queries this table, never writes to it.
//
// FENs are normalized to 4 fields (position + side + castling + en-passant),
// matching the fenKey() convention used throughout the app. This handles
// transpositions (same position reached via different move orders).
export const chessmontMoves = pgTable(
	'chessmont_moves',
	{
		positionFen: text('position_fen').notNull(),
		moveSan: text('move_san').notNull(),
		resultingFen: text('resulting_fen').notNull(),
		gamesPlayed: integer('games_played').notNull().default(0),
		whiteWins: integer('white_wins').notNull().default(0),
		blackWins: integer('black_wins').notNull().default(0),
		draws: integer('draws').notNull().default(0)
	},
	(table) => ({
		pk: primaryKey({ columns: [table.positionFen, table.moveSan] })
	})
);

// Lichess player game statistics, grouped by position, move, and rating bracket.
// Sourced from the Lichess Open Database (database.lichess.org) and imported via
// scripts/lichess-import.py. Read-only seed data — never written to at runtime.
//
// Rating brackets are stored as numeric IDs (0–7):
//   0 = 0–1000, 1 = 1001–1200, 2 = 1201–1400, 3 = 1401–1600,
//   4 = 1601–1800, 5 = 1801–2000, 6 = 2001–2200, 7 = 2201–2400
// Games with players rated 2400+ are excluded (already covered by chessmont_moves).
export const lichessMoves = pgTable(
	'lichess_moves',
	{
		positionFen: text('position_fen').notNull(),
		moveSan: text('move_san').notNull(),
		ratingBracket: integer('rating_bracket').notNull(),
		resultingFen: text('resulting_fen').notNull(),
		gamesPlayed: integer('games_played').notNull().default(0),
		whiteWins: integer('white_wins').notNull().default(0),
		blackWins: integer('black_wins').notNull().default(0),
		draws: integer('draws').notNull().default(0)
	},
	(table) => ({
		pk: primaryKey({ columns: [table.positionFen, table.moveSan, table.ratingBracket] }),
		positionBracketIdx: index('idx_lichess_position_bracket').on(
			table.positionFen,
			table.ratingBracket
		)
	})
);

// Curated list of famous players for the Stars tab in CandidateMoves.
// Populated by the celebrity-import/download scripts. Read-only at runtime.
export const starPlayers = pgTable('star_players', {
	slug: text('slug').primaryKey(), // URL-friendly identifier, e.g. "magnus-carlsen"
	displayName: text('display_name').notNull(), // human-readable name, e.g. "Magnus Carlsen"
	platform: text('platform'), // 'lichess' | 'chesscom' | 'pgn' — used by the download script
	platformUsername: text('platform_username'), // account name on the platform, e.g. "DrNykterstein"
	category: text('category') // 'legend' | 'gm' | 'streamer' | 'meme' — for dropdown grouping
});

// Per-player move statistics for the Stars tab.
// Same W/D/L pattern as chessmont_moves, but partitioned by player_slug.
// Populated by scripts/celebrity-import.py. Read-only at runtime.
export const celebrityMoves = pgTable(
	'celebrity_moves',
	{
		positionFen: text('position_fen').notNull(),
		moveSan: text('move_san').notNull(),
		playerSlug: text('player_slug').notNull(),
		gamesPlayed: integer('games_played').notNull().default(0),
		whiteWins: integer('white_wins').notNull().default(0),
		blackWins: integer('black_wins').notNull().default(0),
		draws: integer('draws').notNull().default(0)
	},
	(table) => ({
		pk: primaryKey({ columns: [table.positionFen, table.moveSan, table.playerSlug] }),
		positionPlayerIdx: index('idx_celebrity_position_player').on(
			table.positionFen,
			table.playerSlug
		)
	})
);

// Cache of Stockfish evaluations, keyed by FEN. Used to color-code candidate
// moves (currently the Players tab) by how good the resulting position is,
// without re-running the engine every time the same position is visited.
//
// Not user-scoped: a Stockfish eval of a position is objective, so every
// user on the same instance shares one cache entry per (fen, depth). The
// depth column is part of what identifies an entry so that a future change
// to POSITION_EVAL_DEPTH does not collide with entries computed at a
// different depth.
//
// Populated lazily on first view (see $lib/stockfish/evalCache.ts) —
// never pre-seeded, unlike the shared book tables above.
export const positionEvalCache = pgTable(
	'position_eval_cache',
	{
		fen: text('fen').notNull(),
		depth: integer('depth').notNull(),
		evalCp: integer('eval_cp'), // null when evalMate is set instead
		evalMate: integer('eval_mate'), // null when evalCp is set instead
		computedAt: timestamp('computed_at').notNull().defaultNow()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.fen, table.depth] })
	})
);

// Lichess puzzles filtered by opening and imported via the puzzle-import script.
// Shared/read-only data — the app never writes to this table.
// Data is NOT shipped with the app; users download the Lichess puzzle CSV
// and run the import script themselves to populate this table.
export const puzzle = pgTable(
	'puzzle',
	{
		puzzleId: text('puzzle_id').primaryKey(), // Lichess puzzle ID, e.g. "00sHx"
		fen: text('fen').notNull(), // starting position of the puzzle
		moves: text('moves').notNull(), // space-separated UCI moves, e.g. "e2e4 d7d5 e4d5"
		rating: integer('rating').notNull(), // puzzle difficulty rating
		ratingDeviation: integer('rating_deviation').notNull(),
		popularity: integer('popularity').notNull(), // -100 to 100
		nbPlays: integer('nb_plays').notNull(), // total times played on Lichess
		themes: text('themes'), // space-separated theme tags, e.g. "fork pin middlegame"
		gameUrl: text('game_url'), // link to the source game on Lichess
		openingTags: text('opening_tags').notNull(), // raw Lichess tags, e.g. "Sicilian_Defense Sicilian_Defense_Najdorf_Variation"
		openingFamily: text('opening_family').notNull() // most specific tag, pre-normalized for matching
	},
	(table) => ({
		openingFamilyIdx: index('idx_puzzle_opening_family').on(table.openingFamily),
		ratingIdx: index('idx_puzzle_rating').on(table.rating)
	})
);

// ─────────────────────────────────────────────────────────────────────────────
// USER TABLES
// Personal data — each user has their own repertoires, moves, SR cards, etc.
// Every table includes user_id for complete data isolation between users.
// ─────────────────────────────────────────────────────────────────────────────

// The login account. One row per user.
export const user = pgTable('user', {
	id: serial('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(), // bcrypt hash — plain text is never stored
	role: text('role').notNull().default('user'), // 'admin' or 'user'
	enabled: boolean('enabled').notNull().default(true), // disabled users cannot log in
	createdAt: timestamp('created_at').notNull()
});

// Active login sessions. One row per logged-in browser session.
// The `id` (a random UUID) is stored as a cookie in the browser.
// On every request, the server reads the cookie, looks it up here,
// and retrieves the associated user_id to identify who is logged in.
// Sessions expire after 30 days. Logging out deletes the row immediately.
export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(), // random UUID — this is what goes in the cookie
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull() // 30 days from login
	},
	(table) => ({
		// Looked up on every authenticated request to fetch the session owner.
		userIdIdx: index('idx_session_user_id').on(table.userId)
	})
);

// Per-user configuration. One row per user.
export const userSettings = pgTable('user_settings', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	stockfishDepth: integer('stockfish_depth').notNull().default(15), // higher = stronger but slower
	stockfishTimeout: integer('stockfish_timeout').notNull().default(10), // analysis timeout in seconds (3–30)
	boardTheme: text('board_theme').notNull().default('blue'), // e.g. "blue", "green", "brown"
	pieceSet: text('piece_set').notNull().default('cburnett'), // e.g. "cburnett", "merida", "alpha"
	soundEnabled: boolean('sound_enabled').notNull().default(true),
	lichessUsername: text('lichess_username'), // Lichess username for game import
	chesscomUsername: text('chesscom_username'), // Chess.com username for game import
	lastLichessImport: timestamp('last_lichess_import'), // watermark: playedAt of most recent Lichess import
	lastChesscomImport: timestamp('last_chesscom_import'), // watermark: playedAt of most recent Chess.com import
	puzzleGoalCount: integer('puzzle_goal_count'), // target number of solved puzzles per period (null = no goal)
	puzzleGoalFrequency: text('puzzle_goal_frequency'), // 'daily' | 'weekly' | 'monthly' (null = no goal)
	tempoEnabled: boolean('tempo_enabled').notNull().default(false), // countdown timer during drill
	tempoSeconds: integer('tempo_seconds').notNull().default(10), // seconds per move (3–30)
	playbackSpeed: integer('playback_speed').notNull().default(500), // auto-play delay in ms (200–1000)
	appTheme: text('app_theme').notNull().default('dark'), // 'dark' | 'light'
	gapMinGames: integer('gap_min_games').notNull().default(10000), // min master games for gap finder (10|100|1000|10000)
	boardSize: integer('board_size').notNull().default(0), // 0 = auto (fill container), >0 = pixel width (320–800)
	playersRatingBracket: integer('players_rating_bracket').notNull().default(3), // 0–7 bracket ID for Players tab (3 = 1401–1600)
	starsPlayerSlug: text('stars_player_slug'), // last-selected player slug for Stars tab (null = first available)
	tutorialStep: integer('tutorial_step'), // null = done/skipped, 0-10 = active tutorial step
	fsrsDesiredRetention: doublePrecision('fsrs_desired_retention').notNull().default(0.9), // target recall probability (0.70–0.97)
	fsrsMaximumInterval: integer('fsrs_maximum_interval').notNull().default(365), // max days between reviews (30–3650)
	fsrsRelearningMinutes: integer('fsrs_relearning_minutes').notNull().default(10), // minutes before forgotten card reappears (1–60)
	trainerRating: integer('trainer_rating'), // opening trainer mode Elo rating (null = not set yet, first-visit prompt)
	updatedAt: timestamp('updated_at').notNull()
});

// A named opening repertoire. Users can have multiple (e.g. "White - e4", "Black vs d4").
export const repertoire = pgTable('repertoire', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	name: text('name').notNull(), // e.g. "White - e4 lines"
	color: text('color').notNull(), // "WHITE" or "BLACK" — which side the user plays
	startFen: text('start_fen'), // custom start position FEN — null means "after user's first move" (default)
	createdAt: timestamp('created_at').notNull()
});

// Every move the user has added to a repertoire.
// This is the raw move record — what move was played and how it was sourced.
// The spaced repetition state lives separately in user_repertoire_move.
export const userMove = pgTable(
	'user_move',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		repertoireId: integer('repertoire_id')
			.notNull()
			.references(() => repertoire.id, { onDelete: 'cascade' }),
		fromFen: text('from_fen').notNull(), // position before the move
		toFen: text('to_fen').notNull(), // position after the move
		san: text('san').notNull(), // move in Standard Algebraic Notation
		source: text('source').notNull(), // "BOOK" (from shared book), "PERSONAL", "STOCKFISH", or "PGN_IMPORT"
		notes: text('notes'), // optional user annotation on this move
		createdAt: timestamp('created_at').notNull()
	},
	(table) => ({
		repertoireIdIdx: index('idx_user_move_repertoire_id').on(table.repertoireId),
		fromFenIdx: index('idx_user_move_from_fen').on(table.fromFen)
	})
);

// Spaced repetition state for each user-owned move that needs drilling.
// One row per drillable move. The FSRS algorithm uses these fields to decide
// when to show each position again. Only the user's own moves are drilled
// (not opponent moves — you don't need to memorise what your opponent plays).
export const userRepertoireMove = pgTable(
	'user_repertoire_move',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		repertoireId: integer('repertoire_id')
			.notNull()
			.references(() => repertoire.id, { onDelete: 'cascade' }),
		fromFen: text('from_fen').notNull(), // the position the user must respond to
		san: text('san').notNull(), // the correct move

		// FSRS spaced repetition fields — managed by the ts-fsrs library, not manually.
		// These determine when this card is next due and how well it has been learned.
		due: timestamp('due'), // when this card should next be reviewed
		stability: doublePrecision('stability'), // how well the memory has consolidated (higher = longer interval)
		difficulty: doublePrecision('difficulty'), // how hard the card is for this user (1–10)
		elapsedDays: integer('elapsed_days'), // days since last review
		scheduledDays: integer('scheduled_days'), // days until next review was scheduled
		reps: integer('reps'), // total number of successful reviews
		lapses: integer('lapses'), // number of times the user forgot this card
		state: integer('state'), // 0=New, 1=Learning, 2=Review, 3=Relearning
		lastReview: timestamp('last_review'), // when it was last reviewed
		learningSteps: integer('learning_steps').notNull().default(0) // ts-fsrs v5: which step within learning/relearning phase
	},
	(table) => ({
		repertoireIdIdx: index('idx_user_repertoire_move_repertoire_id').on(table.repertoireId),
		fromFenIdx: index('idx_user_repertoire_move_from_fen').on(table.fromFen),
		// due is the primary sort key when the FSRS scheduler fetches cards due for review.
		dueIdx: index('idx_user_repertoire_move_due').on(table.due)
	})
);

// A game the user has imported and reviewed for deviations from their repertoire.
export const reviewedGame = pgTable(
	'reviewed_game',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		repertoireId: integer('repertoire_id')
			.notNull()
			.references(() => repertoire.id, { onDelete: 'cascade' }),
		pgn: text('pgn').notNull(), // full PGN of the reviewed game
		source: text('source').notNull(), // "MANUAL" (pasted) or "LICHESS" (imported)
		lichessGameId: text('lichess_game_id'), // Lichess game ID, used to prevent duplicate imports
		deviationFen: text('deviation_fen'), // the position where the user went off-book
		playedAt: timestamp('played_at'), // when the original game was played
		reviewedAt: timestamp('reviewed_at').notNull(), // when the user reviewed it here
		notes: text('notes')
	},
	(table) => ({
		repertoireIdIdx: index('idx_reviewed_game_repertoire_id').on(table.repertoireId)
	})
);

// A game fetched from Lichess or Chess.com, waiting to be reviewed.
// This is the import queue. Games are promoted to reviewed_game when the user
// completes a review. A separate table is needed because reviewed_game requires
// repertoireId and reviewedAt to be NOT NULL, which imported-but-unreviewed games
// cannot satisfy yet.
export const importedGame = pgTable(
	'imported_game',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		pgn: text('pgn').notNull(), // full PGN from the platform
		source: text('source').notNull(), // 'LICHESS' or 'CHESSCOM'
		externalGameId: text('external_game_id').notNull(), // Lichess game ID or Chess.com game URL
		playerColor: text('player_color').notNull(), // 'WHITE' or 'BLACK' — which side the user played
		opponentName: text('opponent_name'),
		opponentRating: integer('opponent_rating'),
		playerRating: integer('player_rating'),
		timeControl: text('time_control'), // e.g. "600+0", "180+2"
		result: text('result'), // '1-0', '0-1', '1/2-1/2'
		playedAt: timestamp('played_at'), // when the game was played on the platform
		importedAt: timestamp('imported_at').notNull(), // when we fetched it
		status: text('status').notNull().default('pending'), // 'pending', 'reviewed', 'skipped'
		reviewedGameId: integer('reviewed_game_id').references(() => reviewedGame.id, {
			onDelete: 'set null'
		}) // set when review is saved
	},
	(table) => ({
		uniqueUserSourceGame: unique().on(table.userId, table.source, table.externalGameId),
		userStatusIdx: index('idx_imported_game_user_status').on(table.userId, table.status),
		userPlayedAtIdx: index('idx_imported_game_user_played_at').on(table.userId, table.playedAt)
	})
);

// A completed drill session — used to power the dashboard stats and review history chart.
export const drillSession = pgTable(
	'drill_session',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		repertoireId: integer('repertoire_id')
			.notNull()
			.references(() => repertoire.id, { onDelete: 'cascade' }),
		cardsReviewed: integer('cards_reviewed').notNull().default(0),
		cardsCorrect: integer('cards_correct').notNull().default(0),
		startedAt: timestamp('started_at').notNull(),
		completedAt: timestamp('completed_at') // null if session was abandoned
	},
	(table) => ({
		repertoireIdIdx: index('idx_drill_session_repertoire_id').on(table.repertoireId)
	})
);

// A user's attempt at solving a Lichess puzzle. One row per attempt.
// Tracks whether the user solved the puzzle and how long it took.
export const puzzleAttempt = pgTable(
	'puzzle_attempt',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		puzzleId: text('puzzle_id')
			.notNull()
			.references(() => puzzle.puzzleId, { onDelete: 'cascade' }),
		solved: boolean('solved').notNull(), // true if the user found all correct moves
		timeMs: integer('time_ms'), // how long the attempt took in milliseconds
		attemptedAt: timestamp('attempted_at').notNull()
	},
	(table) => ({
		userPuzzleIdx: index('idx_puzzle_attempt_user_puzzle').on(table.userId, table.puzzleId)
	})
);

// ─────────────────────────────────────────────────────────────────────────────
// OPENING TRAINER TABLES
// Practice openings against a computer that plays moves weighted by real game
// statistics. Trainer sessions track game history and a per-user Elo rating.
// ─────────────────────────────────────────────────────────────────────────────

// A completed opening trainer session — one row per training game.
export const trainerSession = pgTable(
	'trainer_session',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		repertoireId: integer('repertoire_id')
			.notNull()
			.references(() => repertoire.id, { onDelete: 'cascade' }),
		startFen: text('start_fen').notNull(), // position training started from
		pgn: text('pgn').notNull(), // full PGN of the training game
		movesPlayed: integer('moves_played').notNull(), // half-moves the user played
		finalEvalCp: integer('final_eval_cp'), // Stockfish centipawn eval (null if engine unavailable)
		rated: boolean('rated').notNull(), // whether this session counted toward trainerRating
		ratingBefore: integer('rating_before'), // null if unrated
		ratingAfter: integer('rating_after'), // null if unrated
		moveSource: text('move_source').notNull(), // 'PLAYERS' or 'MASTERS'
		completedAt: timestamp('completed_at').notNull()
	},
	(table) => ({
		userIdIdx: index('idx_trainer_session_user_id').on(table.userId)
	})
);

// Named starting positions saved by the user for reuse in opening trainer.
export const trainerSavedPosition = pgTable(
	'trainer_saved_position',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		fen: text('fen').notNull(), // 4-field normalized FEN
		name: text('name').notNull(), // user label, e.g. "Najdorf after 6.Be3"
		leadInMoves: text('lead_in_moves'), // JSON array of SAN strings from standard position to this FEN
		createdAt: timestamp('created_at').notNull()
	},
	(table) => ({
		uniqueUserFen: unique().on(table.userId, table.fen),
		userIdIdx: index('idx_trainer_saved_position_user_id').on(table.userId)
	})
);

// ─────────────────────────────────────────────────────────────────────────────
// OPPONENT PREP TABLES
// Tournament preparation — download an opponent's games, analyze tendencies,
// and build targeted responses in a sandboxed workspace separate from the
// user's real repertoires. Data is per-user, per-opponent.
// ─────────────────────────────────────────────────────────────────────────────

// One row per opponent prep session. Tracks who the opponent is, which platform
// their games were fetched from, and a watermark for incremental refreshes.
export const opponentPreps = pgTable(
	'opponent_preps',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		opponentName: text('opponent_name').notNull(), // display name shown in the UI
		platform: text('platform').notNull(), // 'LICHESS' or 'CHESSCOM'
		platformUsername: text('platform_username').notNull(), // exact username used for API calls
		timeWindow: text('time_window'), // '1m' | '3m' | '6m' | '1y' | 'all'
		gamesAsWhite: integer('games_as_white').notNull().default(0),
		gamesAsBlack: integer('games_as_black').notNull().default(0),
		lastFetchedAt: timestamp('last_fetched_at').notNull(), // watermark for incremental refresh
		createdAt: timestamp('created_at').notNull(),
		minGames: integer('min_games').notNull().default(2), // hide moves played fewer than this many times
		excludedMoves: text('excluded_moves') // JSON array of "fen|san" strings to hide from prep view
	},
	(table) => ({
		userIdIdx: index('idx_opponent_preps_user_id').on(table.userId)
	})
);

// Aggregated move statistics from the opponent's games. Every position+move
// the opponent (or their opponents) played is stored with W/D/L counts.
//
// The opponent_color column determines move meaning via the color model:
//   opponent_color == FEN active color → Opponent's choice (what they play)
//   opponent_color != FEN active color → Context move (what others played against them)
export const opponentMoves = pgTable(
	'opponent_moves',
	{
		prepId: integer('prep_id')
			.notNull()
			.references(() => opponentPreps.id, { onDelete: 'cascade' }),
		positionFen: text('position_fen').notNull(), // 4-field normalized FEN
		moveSan: text('move_san').notNull(),
		opponentColor: text('opponent_color').notNull(), // 'w' or 'b' — which color the opponent was playing
		resultingFen: text('resulting_fen').notNull(),
		gamesPlayed: integer('games_played').notNull().default(0),
		whiteWins: integer('white_wins').notNull().default(0),
		blackWins: integer('black_wins').notNull().default(0),
		draws: integer('draws').notNull().default(0)
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.prepId, table.positionFen, table.moveSan, table.opponentColor]
		}),
		positionColorIdx: index('idx_opponent_moves_position_color').on(
			table.prepId,
			table.positionFen,
			table.opponentColor
		)
	})
);

// User's sandboxed prep responses — moves the user builds during a prep session.
// Completely separate from repertoire/userMove tables. Cascade-deletes with the prep.
export const prepMoves = pgTable(
	'prep_moves',
	{
		id: serial('id').primaryKey(),
		prepId: integer('prep_id')
			.notNull()
			.references(() => opponentPreps.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		fromFen: text('from_fen').notNull(), // position before the move
		toFen: text('to_fen').notNull(), // position after the move (computed server-side)
		san: text('san').notNull(), // move in Standard Algebraic Notation
		color: text('color').notNull(), // 'white' or 'black' — which side the user is prepping as
		createdAt: timestamp('created_at').notNull()
	},
	(table) => ({
		prepFromFenIdx: index('idx_prep_moves_prep_from_fen').on(table.prepId, table.fromFen)
	})
);
