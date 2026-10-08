-- Add indexes on user_id for tables that are filtered by user on every query.
-- Prevents sequential scans as data grows; especially important for user_settings
-- (queried on every page load) and bulk deletion on account delete.

CREATE INDEX "idx_user_settings_user_id" ON "user_settings" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_repertoire_user_id" ON "repertoire" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_user_move_user_id" ON "user_move" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_user_repertoire_move_user_id" ON "user_repertoire_move" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_reviewed_game_user_id" ON "reviewed_game" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_drill_session_user_id" ON "drill_session" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_password_reset_token_user_id" ON "password_reset_token" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_email_verification_token_user_id" ON "email_verification_token" ("user_id");
