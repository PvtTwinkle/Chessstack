-- Add email_verified column to user table.
-- Default false for new sign-ups; backfill existing users as verified
-- so they are not locked out when email verification is enabled.
ALTER TABLE "user" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT false;
UPDATE "user" SET "email_verified" = true;

-- Email verification tokens — same pattern as password_reset_token.
-- Each token is single-use and expires after 24 hours.
CREATE TABLE "email_verification_token" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL
);
