ALTER TABLE "user"
  ADD COLUMN "referral_code" text UNIQUE,
  ADD COLUMN "referred_by_user_id" integer REFERENCES "user"("id") ON DELETE SET NULL;

ALTER TABLE "subscription"
  ADD COLUMN "referral_discount_active" boolean NOT NULL DEFAULT false;

CREATE INDEX "idx_user_referral_code" ON "user"("referral_code");
