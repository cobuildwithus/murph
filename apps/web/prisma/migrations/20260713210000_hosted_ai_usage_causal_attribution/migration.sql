CREATE TABLE "hosted_account_group_billing_period" (
  "group_id" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "billing_plan_code" TEXT NOT NULL,
  "limit_usd_micros" BIGINT NOT NULL,
  "last_stripe_event_created_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_account_group_billing_period_pkey"
    PRIMARY KEY ("group_id", "period_start")
);

CREATE INDEX "hosted_account_group_billing_period_group_id_period_end_idx"
  ON "hosted_account_group_billing_period"("group_id", "period_end");

ALTER TABLE "hosted_account_group_billing_period"
  ADD CONSTRAINT "hosted_account_group_billing_period_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "hosted_account_group"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "hosted_account_group_billing_period" (
  "group_id",
  "period_start",
  "period_end",
  "billing_plan_code",
  "limit_usd_micros",
  "last_stripe_event_created_at",
  "created_at",
  "updated_at"
)
SELECT
  billing_ref."group_id",
  billing_ref."current_period_start",
  billing_ref."current_period_end",
  COALESCE(billing_ref."current_billing_plan_code", 'launch_family_monthly'),
  10000000,
  billing_ref."last_stripe_event_created_at",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "hosted_account_group_billing_ref" AS billing_ref
INNER JOIN "hosted_account_group" AS account_group
  ON account_group."id" = billing_ref."group_id"
WHERE account_group."billing_status" = 'active'
  AND billing_ref."current_billing_phase" = 'paid'
  AND COALESCE(
    billing_ref."current_billing_plan_code",
    'launch_family_monthly'
  ) = 'launch_family_monthly'
  AND billing_ref."current_period_start" IS NOT NULL
  AND billing_ref."current_period_end" IS NOT NULL
  AND billing_ref."current_period_start" < billing_ref."current_period_end";

ALTER TABLE "hosted_stripe_event"
  ADD COLUMN "family_usage_repair_group_id" TEXT;

ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "allowance_family_group_id" TEXT;

UPDATE "hosted_ai_usage"
SET "allowance_family_group_id" = NULLIF(
  BTRIM("allowance_pricing_snapshot_json" ->> 'familyGroupId'),
  ''
)
WHERE "allowance_accounted_at" IS NULL
  AND "allowance_family_group_id" IS NULL
  AND "allowance_pricing_version" =
    'hosted-ai-usage-family-attribution-pending-2026-07-13'
  AND jsonb_typeof(
    "allowance_pricing_snapshot_json" -> 'familyGroupId'
  ) = 'string'
  AND NULLIF(
    BTRIM("allowance_pricing_snapshot_json" ->> 'familyGroupId'),
    ''
  ) IS NOT NULL;

CREATE INDEX CONCURRENTLY "hosted_ai_usage_family_repair_idx"
  ON "hosted_ai_usage"(
    "allowance_family_group_id",
    "allowance_accounted_at",
    "occurred_at"
  );
