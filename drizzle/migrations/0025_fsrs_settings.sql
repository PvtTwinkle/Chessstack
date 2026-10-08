ALTER TABLE user_settings ADD COLUMN fsrs_desired_retention DOUBLE PRECISION NOT NULL DEFAULT 0.9;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN fsrs_maximum_interval INTEGER NOT NULL DEFAULT 365;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN fsrs_relearning_minutes INTEGER NOT NULL DEFAULT 10;