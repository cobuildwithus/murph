INSERT INTO "hosted_usage_credit_grant" (
  "entry_id",
  "remaining_usd_micros",
  "created_at",
  "updated_at"
)
SELECT
  entry."id",
  purchase."remaining_credit_usd_micros",
  entry."created_at",
  CURRENT_TIMESTAMP
FROM "hosted_usage_credit_entry" AS entry
INNER JOIN "hosted_usage_credit_purchase" AS purchase
  ON purchase."id" = entry."purchase_id"
WHERE entry."kind" = 'purchase_grant'
ON CONFLICT ("entry_id") DO UPDATE
SET
  "remaining_usd_micros" = EXCLUDED."remaining_usd_micros",
  "updated_at" = EXCLUDED."updated_at";
