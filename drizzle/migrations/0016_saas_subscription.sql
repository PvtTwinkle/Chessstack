-- Add email and Stripe customer ID to user table
ALTER TABLE "user" ADD COLUMN "email" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripe_customer_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_email" ON "user" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_stripe_customer_id" ON "user" ("stripe_customer_id");
--> statement-breakpoint

-- Subscription table (one row per user)
CREATE TABLE "subscription" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "tier" text NOT NULL DEFAULT 'free',
  "stripe_subscription_id" text,
  "stripe_price_id" text,
  "status" text NOT NULL DEFAULT 'active',
  "current_period_end" timestamp,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscription_user_id" ON "subscription" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscription_stripe_subscription_id" ON "subscription" ("stripe_subscription_id");
--> statement-breakpoint

-- Password reset token table
CREATE TABLE "password_reset_token" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL
);
