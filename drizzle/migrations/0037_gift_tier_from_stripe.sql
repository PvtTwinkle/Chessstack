-- subscription.tier now reflects Stripe only; an admin gift is read from
-- gift_expiry on its own. Granting a gift used to set tier = 'paid' as well,
-- which left gifted users on the paid plan after the gift expired. Reset the
-- tier of every row that has had a gift to what Stripe says.
UPDATE "subscription"
SET
	"tier" = CASE
		WHEN "stripe_subscription_id" IS NOT NULL AND "status" IN ('active', 'past_due') THEN 'paid'
		ELSE 'free'
	END,
	"updated_at" = now()
WHERE "gift_expiry" IS NOT NULL;
