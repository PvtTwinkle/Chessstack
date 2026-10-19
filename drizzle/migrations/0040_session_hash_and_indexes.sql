-- Index the foreign keys that cascade or set null on delete, add the
-- (repertoire_id, due) index Drill uses, and drop indexes another index or
-- unique constraint already covers. The puzzle family index was never used:
-- the puzzle queries match by prefix, which needs text_pattern_ops.
DROP INDEX IF EXISTS "idx_book_move_from_fen";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_puzzle_opening_family";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_trainer_saved_position_user_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_user_referral_code";--> statement-breakpoint
CREATE INDEX "idx_imported_game_reviewed_game_id" ON "imported_game" USING btree ("reviewed_game_id");--> statement-breakpoint
CREATE INDEX "idx_prep_moves_user_id" ON "prep_moves" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_puzzle_opening_family_pattern" ON "puzzle" USING btree ("opening_family" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "idx_trainer_session_repertoire_id" ON "trainer_session" USING btree ("repertoire_id");--> statement-breakpoint
CREATE INDEX "idx_user_referred_by_user_id" ON "user" USING btree ("referred_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_user_repertoire_move_repertoire_due" ON "user_repertoire_move" USING btree ("repertoire_id","due");--> statement-breakpoint
-- Sessions are now keyed by the SHA-256 hex of the cookie's token
-- ($lib/auth hashSessionToken). Hash the existing tokens the same way so
-- nobody is signed out.
UPDATE "session" SET "id" = encode(sha256(convert_to("id", 'UTF8')), 'hex');
