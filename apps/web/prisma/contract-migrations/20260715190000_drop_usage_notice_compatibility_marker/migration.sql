DROP INDEX IF EXISTS "hosted_ai_usage_period_limit_notice_sent_at_idx";

ALTER TABLE "hosted_ai_usage_period"
  DROP COLUMN IF EXISTS "limit_notice_sent_at";
