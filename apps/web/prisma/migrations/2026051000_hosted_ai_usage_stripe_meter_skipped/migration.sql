ALTER TABLE "hosted_ai_usage"
  ALTER COLUMN "stripe_meter_status" SET DEFAULT 'skipped';

UPDATE "hosted_ai_usage"
SET
  "stripe_meter_status" = 'skipped',
  "stripe_meter_error" = COALESCE(
    "stripe_meter_error",
    'Hosted AI usage is recorded locally; Stripe usage metering is not configured.'
  ),
  "stripe_meter_next_attempt_at" = NULL
WHERE
  "stripe_meter_source" = 'murph'
  AND "stripe_meter_status" IN ('pending', 'processing');
