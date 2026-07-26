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

ALTER TABLE "hosted_usage_credit_entry"
  DROP CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid",
  DROP CONSTRAINT "hosted_usage_credit_entry_source_shape_valid";

ALTER TABLE "hosted_usage_credit_entry"
  ADD CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"
    CHECK (
      ("kind" IN ('purchase_grant', 'referral_grant') AND "amount_usd_micros" > 0)
      OR ("kind" = 'usage_debit' AND "amount_usd_micros" < 0)
      OR ("kind" IN ('refund_adjustment', 'dispute_adjustment') AND "amount_usd_micros" <> 0)
    ) NOT VALID,
  ADD CONSTRAINT "hosted_usage_credit_entry_source_shape_valid"
    CHECK (
      (
        "kind" = 'purchase_grant'
        AND "purchase_id" IS NOT NULL
        AND "referral_id" IS NULL
        AND "parent_grant_entry_id" IS NULL
        AND "source_usage_id" IS NULL
      )
      OR
      (
        "kind" = 'referral_grant'
        AND "purchase_id" IS NULL
        AND "referral_id" IS NOT NULL
        AND "parent_grant_entry_id" IS NULL
        AND "source_usage_id" IS NULL
      )
      OR
      (
        "kind" = 'usage_debit'
        AND (("purchase_id" IS NOT NULL) <> ("referral_id" IS NOT NULL))
        AND "parent_grant_entry_id" IS NOT NULL
        AND "source_usage_id" IS NOT NULL
      )
      OR
      (
        "kind" IN ('refund_adjustment', 'dispute_adjustment')
        AND "purchase_id" IS NOT NULL
        AND "referral_id" IS NULL
        AND "parent_grant_entry_id" IS NOT NULL
        AND "source_usage_id" IS NULL
        AND "source_reference_lookup_key" IS NOT NULL
      )
    ) NOT VALID;

ALTER TABLE "hosted_usage_credit_entry"
  VALIDATE CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid",
  VALIDATE CONSTRAINT "hosted_usage_credit_entry_source_shape_valid";
