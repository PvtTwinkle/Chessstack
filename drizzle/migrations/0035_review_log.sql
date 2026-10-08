CREATE TABLE "review_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"card_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"reviewed_at" timestamp NOT NULL,
	"source" text NOT NULL,
	"state_before" integer NOT NULL,
	"stability_before" double precision,
	"difficulty_before" double precision,
	"elapsed_days_before" integer,
	"scheduled_days_before" integer,
	"learning_steps_before" integer NOT NULL,
	"state_after" integer NOT NULL,
	"stability_after" double precision NOT NULL,
	"difficulty_after" double precision NOT NULL,
	"elapsed_days_after" integer NOT NULL,
	"scheduled_days_after" integer NOT NULL,
	"learning_steps_after" integer NOT NULL,
	"request_retention" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."user_repertoire_move"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_review_log_user_id_reviewed_at" ON "review_log" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "idx_review_log_card_id" ON "review_log" USING btree ("card_id");