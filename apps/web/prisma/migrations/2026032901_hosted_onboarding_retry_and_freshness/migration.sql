-- AlterEnum
ALTER TYPE "HostedStripeEventStatus" ADD VALUE IF NOT EXISTS 'poisoned';

-- AlterTable
ALTER TABLE "hosted_stripe_event"
  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "hosted_billing_checkout"
  ADD COLUMN IF NOT EXISTS "has_share_context" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "hosted_revnet_issuance"
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Indexes
CREATE INDEX IF NOT EXISTS "hosted_stripe_event_status_next_attempt_at_stripe_created_at_created_at_idx"
  ON "hosted_stripe_event"("status", "next_attempt_at", "stripe_created_at", "created_at");

CREATE INDEX IF NOT EXISTS "hosted_revnet_issuance_status_next_attempt_at_created_at_idx"
  ON "hosted_revnet_issuance"("status", "next_attempt_at", "created_at");
