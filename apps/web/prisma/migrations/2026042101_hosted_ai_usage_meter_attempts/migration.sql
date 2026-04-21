ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "stripe_meter_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stripe_meter_last_attempted_at" TIMESTAMP(3),
  ADD COLUMN "stripe_meter_next_attempt_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "hosted_ai_usage_stripe_meter_status_occurred_at_idx";

CREATE INDEX "hosted_ai_usage_stripe_meter_due_idx"
  ON "hosted_ai_usage"("stripe_meter_status", "stripe_meter_next_attempt_at", "occurred_at");
