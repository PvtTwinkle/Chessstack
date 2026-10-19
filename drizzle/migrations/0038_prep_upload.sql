ALTER TABLE "opponent_preps" ADD COLUMN "pending_since" timestamp;--> statement-breakpoint
ALTER TABLE "opponent_preps" ADD COLUMN "replaces_prep_id" integer;--> statement-breakpoint
ALTER TABLE "opponent_preps" ADD CONSTRAINT "opponent_preps_replaces_prep_id_fkey" FOREIGN KEY ("replaces_prep_id") REFERENCES "public"."opponent_preps"("id") ON DELETE cascade ON UPDATE no action;