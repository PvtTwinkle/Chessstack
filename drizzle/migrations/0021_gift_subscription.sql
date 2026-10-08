-- Replace the admin_override boolean with a gift_expiry timestamp.
-- null = no gift; a date = gift active until that date; 9999-12-31 = lifetime.
ALTER TABLE "subscription" ADD COLUMN "gift_expiry" timestamp;

-- Migrate existing overrides to lifetime gifts.
UPDATE "subscription" SET "gift_expiry" = '9999-12-31T00:00:00.000Z' WHERE "admin_override" = true;

ALTER TABLE "subscription" DROP COLUMN "admin_override";
