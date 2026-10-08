-- Emailed tokens (email verification, password reset) are now stored as a
-- SHA-256 hash and looked up by equality instead of bcrypt-compared one by one.
-- Outstanding bcrypt-hashed tokens can never match the new lookup, so drop
-- them; affected users simply request a new link.
DELETE FROM "email_verification_token" WHERE "used_at" IS NULL;--> statement-breakpoint
DELETE FROM "password_reset_token" WHERE "used_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_email_verification_token_hash" ON "email_verification_token"("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_password_reset_token_hash" ON "password_reset_token"("token_hash");--> statement-breakpoint

-- Referral discount is single-use. Records when the coupon was applied so it
-- cannot be re-applied on a later checkout.
ALTER TABLE "subscription" ADD COLUMN "referral_discount_used_at" timestamp;
