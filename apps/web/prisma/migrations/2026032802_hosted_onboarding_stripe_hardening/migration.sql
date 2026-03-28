ALTER TABLE "hosted_member"
  ADD COLUMN "stripe_latest_billing_event_created_at" TIMESTAMP(3),
  ADD COLUMN "stripe_latest_billing_event_id" TEXT;

ALTER TABLE "hosted_webhook_receipt"
  ADD COLUMN "claim_expires_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "hosted_billing_checkout_member_open_unique"
ON "hosted_billing_checkout" ("member_id")
WHERE "status" = 'open';
