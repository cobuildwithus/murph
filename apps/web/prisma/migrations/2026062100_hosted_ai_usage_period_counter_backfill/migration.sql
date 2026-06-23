WITH period_spend AS (
  SELECT
    "member_id",
    "allowance_period_start" AS "period_start",
    SUM("allowance_cost_usd_micros")::bigint AS "spent_usd_micros",
    MAX("occurred_at") AS "last_usage_at"
  FROM "hosted_ai_usage"
  WHERE "allowance_accounted_at" IS NOT NULL
    AND "allowance_counted" = true
    AND "allowance_period_start" IS NOT NULL
  GROUP BY "member_id", "allowance_period_start"
)
UPDATE "hosted_ai_usage_period" AS period
SET
  "spent_usd_micros" = period_spend."spent_usd_micros",
  "last_usage_at" = GREATEST(
    COALESCE(period."last_usage_at", period_spend."last_usage_at"),
    period_spend."last_usage_at"
  ),
  "blocked_at" = CASE
    WHEN period_spend."spent_usd_micros" >= period."limit_usd_micros" THEN
      COALESCE(period."blocked_at", period_spend."last_usage_at")
    ELSE NULL
  END,
  "limit_notice_sent_at" = CASE
    WHEN period_spend."spent_usd_micros" < period."limit_usd_micros" THEN NULL
    ELSE period."limit_notice_sent_at"
  END,
  "updated_at" = GREATEST(period."updated_at", period_spend."last_usage_at")
FROM period_spend
WHERE period."member_id" = period_spend."member_id"
  AND period."period_start" = period_spend."period_start";
