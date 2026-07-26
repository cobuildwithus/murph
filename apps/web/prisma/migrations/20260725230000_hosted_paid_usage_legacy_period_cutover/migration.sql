-- Preserve the legacy included-usage grant for authoritative paid billing
-- periods that are already open when the price-derived allowance deploys but
-- have not yet materialized a hosted_ai_usage_period row. Calendar fallbacks
-- are intentionally skipped because a delayed billing projection can replace
-- their period identity without a renewal.

WITH "cutover_clock" AS (
  SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS "now_utc"
),
"direct_candidates" AS (
  SELECT
    "member"."id" AS "member_id",
    CASE
      WHEN "billing_ref"."current_billing_plan_code" = 'launch_edge_monthly'
        THEN 'launch_edge_monthly'
      ELSE 'launch_monthly'
    END AS "billing_plan_code",
    CASE
      WHEN "billing_ref"."current_billing_plan_code" = 'launch_edge_monthly'
        THEN 25000000::BIGINT
      ELSE 10000000::BIGINT
    END AS "limit_usd_micros",
    "billing_ref"."current_period_start" AS "period_start",
    "billing_ref"."current_period_end" AS "period_end",
    "clock"."now_utc" AS "migrated_at"
  FROM "hosted_member" AS "member"
  INNER JOIN "hosted_member_billing_ref" AS "billing_ref"
    ON "billing_ref"."member_id" = "member"."id"
  CROSS JOIN "cutover_clock" AS "clock"
  WHERE
    "member"."billing_status" = 'active'
    AND "member"."suspended_at" IS NULL
    AND "billing_ref"."current_billing_phase" = 'paid'
    AND "billing_ref"."current_period_start" IS NOT NULL
    AND "billing_ref"."current_period_end" IS NOT NULL
    AND "billing_ref"."current_period_start" < "billing_ref"."current_period_end"
    AND "clock"."now_utc" >= "billing_ref"."current_period_start"
    AND "clock"."now_utc" < "billing_ref"."current_period_end"
    AND NOT EXISTS (
      SELECT 1
      FROM "hosted_thread_container" AS "thread_container"
      WHERE "thread_container"."member_id" = "member"."id"
    )
),
"ranked_family_memberships" AS (
  SELECT
    "membership"."group_id",
    "membership"."member_id",
    "membership"."plan_code",
    ROW_NUMBER() OVER (
      PARTITION BY "membership"."member_id"
      ORDER BY "membership"."created_at" ASC
    ) AS "membership_rank"
  FROM "hosted_account_group_membership" AS "membership"
  INNER JOIN "hosted_account_group" AS "account_group"
    ON "account_group"."id" = "membership"."group_id"
  INNER JOIN "hosted_member" AS "member"
    ON "member"."id" = "membership"."member_id"
  WHERE
    "membership"."status" = 'active'
    AND "account_group"."billing_status" = 'active'
    AND "account_group"."suspended_at" IS NULL
    AND "member"."suspended_at" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "hosted_thread_container" AS "thread_container"
      WHERE "thread_container"."member_id" = "member"."id"
    )
    AND NOT (
      "member"."billing_status" = 'active'
      AND EXISTS (
        SELECT 1
        FROM "hosted_member_billing_ref" AS "direct_billing_ref"
        WHERE
          "direct_billing_ref"."member_id" = "member"."id"
          AND "direct_billing_ref"."current_billing_phase" = 'paid'
      )
    )
),
"family_candidates" AS (
  SELECT
    "membership"."member_id",
    CASE
      WHEN "membership"."plan_code" = 'edge' THEN 'launch_edge_monthly'
      ELSE 'launch_monthly'
    END AS "billing_plan_code",
    CASE
      WHEN "membership"."plan_code" = 'edge' THEN 25000000::BIGINT
      ELSE 10000000::BIGINT
    END AS "limit_usd_micros",
    "family_billing_ref"."current_period_start" AS "period_start",
    "family_billing_ref"."current_period_end" AS "period_end",
    "clock"."now_utc" AS "migrated_at"
  FROM "ranked_family_memberships" AS "membership"
  INNER JOIN "hosted_account_group_billing_ref" AS "family_billing_ref"
    ON "family_billing_ref"."group_id" = "membership"."group_id"
  CROSS JOIN "cutover_clock" AS "clock"
  WHERE
    "membership"."membership_rank" = 1
    AND "membership"."plan_code" IN ('pulse', 'edge')
    AND "family_billing_ref"."current_billing_plan_code" = 'launch_family_monthly'
    AND "family_billing_ref"."current_billing_phase" = 'paid'
    AND "family_billing_ref"."current_period_start" IS NOT NULL
    AND "family_billing_ref"."current_period_end" IS NOT NULL
    AND "family_billing_ref"."current_period_start"
      < "family_billing_ref"."current_period_end"
    AND "clock"."now_utc" >= "family_billing_ref"."current_period_start"
    AND "clock"."now_utc" < "family_billing_ref"."current_period_end"
),
"cutover_candidates" AS (
  SELECT * FROM "direct_candidates"
  UNION ALL
  SELECT * FROM "family_candidates"
)
INSERT INTO "hosted_ai_usage_period" (
  "member_id",
  "period_start",
  "period_end",
  "billing_plan_code",
  "limit_usd_micros",
  "spent_usd_micros",
  "created_at",
  "updated_at"
)
SELECT
  "member_id",
  "period_start",
  "period_end",
  "billing_plan_code",
  "limit_usd_micros",
  0,
  "migrated_at",
  "migrated_at"
FROM "cutover_candidates"
ON CONFLICT ("member_id", "period_start") DO NOTHING;
