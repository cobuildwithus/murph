ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN IF NOT EXISTS "last_stripe_event_created_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "hosted_ai_usage_turn_id_attempt_count_idx"
  ON "hosted_ai_usage"("turn_id", "attempt_count");
