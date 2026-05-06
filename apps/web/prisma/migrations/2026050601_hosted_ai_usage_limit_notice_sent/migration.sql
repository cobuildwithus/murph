ALTER TABLE "hosted_ai_usage_period"
  ADD COLUMN "limit_notice_sent_at" TIMESTAMP(3);

CREATE INDEX "hosted_ai_usage_period_limit_notice_sent_at_idx"
  ON "hosted_ai_usage_period"("limit_notice_sent_at");
