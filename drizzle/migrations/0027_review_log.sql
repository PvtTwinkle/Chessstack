-- 0027_review_log.sql
-- Add review_log: one row per FSRS grading event (drill grade or review
-- deviation fail-card). Historical reviews cannot be reconstructed after the
-- fact, so this table exists purely to accumulate data going forward for a
-- future FSRS weight optimizer.
--
-- Captures both the pre-review and post-review card state, since ts-fsrs's
-- own ReviewLog.state field records the state AFTER the review, while the
-- revlog format used by FSRS optimizers (fsrs-rs, fsrs4anki) expects the
-- state BEFORE the review to replay history correctly. Storing both avoids
-- having to guess which one an eventual optimizer implementation will need.

CREATE TABLE review_log (
	id SERIAL PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	card_id INTEGER NOT NULL REFERENCES user_repertoire_move(id) ON DELETE CASCADE,

	-- What happened.
	rating INTEGER NOT NULL, -- 1=Again, 3=Good, 4=Easy (Hard is unused by this app)
	reviewed_at TIMESTAMP NOT NULL, -- when the grading event occurred
	source TEXT NOT NULL, -- "DRILL" (api/drill/grade) or "REVIEW_DEVIATION" (api/review/fail-card)

	-- Card state BEFORE this review (state at the moment the card was loaded,
	-- prior to applying the rating).
	state_before INTEGER NOT NULL, -- 0=New, 1=Learning, 2=Review, 3=Relearning
	stability_before DOUBLE PRECISION,
	difficulty_before DOUBLE PRECISION,
	elapsed_days_before INTEGER,
	scheduled_days_before INTEGER,
	learning_steps_before INTEGER NOT NULL,

	-- Card state AFTER this review (the values ts-fsrs computed and wrote to
	-- user_repertoire_move as a result of this rating).
	state_after INTEGER NOT NULL,
	stability_after DOUBLE PRECISION NOT NULL,
	difficulty_after DOUBLE PRECISION NOT NULL,
	elapsed_days_after INTEGER NOT NULL,
	scheduled_days_after INTEGER NOT NULL,
	learning_steps_after INTEGER NOT NULL,

	-- Snapshot of the FSRS config in effect at review time. Needed to interpret
	-- this log correctly if requestRetention changes later (an optimizer must
	-- know what retention target the scheduling decision was made under).
	request_retention DOUBLE PRECISION NOT NULL
);

CREATE INDEX idx_review_log_user_id ON review_log(user_id);
CREATE INDEX idx_review_log_card_id ON review_log(card_id);
CREATE INDEX idx_review_log_reviewed_at ON review_log(reviewed_at);
