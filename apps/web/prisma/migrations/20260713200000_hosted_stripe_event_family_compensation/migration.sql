ALTER TABLE "hosted_stripe_event"
ADD COLUMN "legacy_family_checkout_compensation_accepted_at" TIMESTAMP(3),
ADD COLUMN "legacy_family_checkout_compensation_invoice_lookup_key" TEXT,
ADD COLUMN "legacy_family_checkout_compensation_subscription_lookup_key" TEXT;
