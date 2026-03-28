-- AlterEnum
ALTER TYPE "HostedBillingCheckoutStatus" ADD VALUE IF NOT EXISTS 'superseded';

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HostedStripeEventStatus') THEN
    CREATE TYPE "HostedStripeEventStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "hosted_billing_checkout"
  ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "hosted_stripe_event" (
  "event_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "stripe_created_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "status" "HostedStripeEventStatus" NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "claim_expires_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "customer_id" TEXT,
  "subscription_id" TEXT,
  "invoice_id" TEXT,
  "checkout_session_id" TEXT,
  "charge_id" TEXT,
  "payment_intent_id" TEXT,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_stripe_event_pkey" PRIMARY KEY ("event_id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "hosted_stripe_event_status_stripe_created_at_created_at_idx"
  ON "hosted_stripe_event"("status", "stripe_created_at", "created_at");

CREATE INDEX IF NOT EXISTS "hosted_stripe_event_claim_expires_at_idx"
  ON "hosted_stripe_event"("claim_expires_at");

CREATE INDEX IF NOT EXISTS "hosted_stripe_event_customer_id_stripe_created_at_idx"
  ON "hosted_stripe_event"("customer_id", "stripe_created_at");

CREATE INDEX IF NOT EXISTS "hosted_stripe_event_subscription_id_stripe_created_at_idx"
  ON "hosted_stripe_event"("subscription_id", "stripe_created_at");

CREATE INDEX IF NOT EXISTS "hosted_stripe_event_invoice_id_stripe_created_at_idx"
  ON "hosted_stripe_event"("invoice_id", "stripe_created_at");

CREATE INDEX IF NOT EXISTS "hosted_stripe_event_checkout_session_id_stripe_created_at_idx"
  ON "hosted_stripe_event"("checkout_session_id", "stripe_created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "hosted_billing_checkout_member_open_unique"
  ON "hosted_billing_checkout"("member_id")
  WHERE "status" = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS "hosted_billing_checkout_invite_open_unique"
  ON "hosted_billing_checkout"("invite_id")
  WHERE "invite_id" IS NOT NULL AND "status" = 'open';

-- updated_at trigger compatibility via Prisma @updatedAt writes; no database trigger needed
