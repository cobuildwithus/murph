ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "current_billing_plan_code" TEXT,
  ADD COLUMN "current_period_start" TIMESTAMP(3),
  ADD COLUMN "current_period_end" TIMESTAMP(3);

ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "allowance_accounted_at" TIMESTAMP(3),
  ADD COLUMN "allowance_period_start" TIMESTAMP(3),
  ADD COLUMN "allowance_period_end" TIMESTAMP(3),
  ADD COLUMN "allowance_cost_usd_micros" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "allowance_pricing_version" TEXT,
  ADD COLUMN "allowance_pricing_snapshot_json" JSONB,
  ADD COLUMN "allowance_counted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "hosted_ai_usage_member_id_allowance_period_start_idx"
  ON "hosted_ai_usage"("member_id", "allowance_period_start");

CREATE TABLE "hosted_ai_usage_period" (
  "member_id" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "billing_plan_code" TEXT NOT NULL,
  "limit_usd_micros" BIGINT NOT NULL,
  "spent_usd_micros" BIGINT NOT NULL DEFAULT 0,
  "blocked_at" TIMESTAMP(3),
  "last_usage_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_ai_usage_period_pkey" PRIMARY KEY ("member_id", "period_start"),
  CONSTRAINT "hosted_ai_usage_period_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "hosted_ai_usage_period_member_id_period_end_idx"
  ON "hosted_ai_usage_period"("member_id", "period_end");

CREATE INDEX "hosted_ai_usage_period_blocked_at_idx"
  ON "hosted_ai_usage_period"("blocked_at");

CREATE INDEX "hosted_ai_usage_period_period_end_idx"
  ON "hosted_ai_usage_period"("period_end");
