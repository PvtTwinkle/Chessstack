CREATE TABLE "endgame_attempt" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"lesson" text NOT NULL,
	"mode" text NOT NULL,
	"start_fen" text NOT NULL,
	"moves" text NOT NULL,
	"result" text NOT NULL,
	"player_moves" integer NOT NULL,
	"par" integer,
	"time_ms" integer,
	"attempted_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "endgame_attempt" ADD CONSTRAINT "endgame_attempt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_endgame_attempt_user_lesson" ON "endgame_attempt" USING btree ("user_id","lesson");