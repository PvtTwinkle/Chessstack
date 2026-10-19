-- Back the app's "one row" rules with unique indexes: a move is saved once per
-- position, a position has one drill card, and a user has one settings row.
-- Stop with an error instead of deleting anything if duplicates already exist.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "user_move" GROUP BY "repertoire_id", "from_fen", "san" HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'user_move has duplicate (repertoire_id, from_fen, san) rows; remove them before migrating';
	END IF;
	IF EXISTS (SELECT 1 FROM "user_repertoire_move" GROUP BY "repertoire_id", "from_fen" HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'user_repertoire_move has duplicate (repertoire_id, from_fen) rows; remove them before migrating';
	END IF;
	IF EXISTS (SELECT 1 FROM "user_settings" GROUP BY "user_id" HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'user_settings has more than one row for a user; remove the extras before migrating';
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_move_repertoire_from_fen_san" ON "user_move" USING btree ("repertoire_id","from_fen","san");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_repertoire_move_repertoire_from_fen" ON "user_repertoire_move" USING btree ("repertoire_id","from_fen");--> statement-breakpoint
DROP INDEX "idx_user_move_repertoire_id";--> statement-breakpoint
DROP INDEX "idx_user_repertoire_move_repertoire_id";--> statement-breakpoint
DROP INDEX "idx_user_settings_user_id";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_settings_user_id" ON "user_settings" USING btree ("user_id");
