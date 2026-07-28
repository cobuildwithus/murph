-- The first transaction takes the unavoidable ACCESS EXCLUSIVE metadata lock.
-- Keep that boundary bounded and scan-free: NOT VALID enforces both checks for
-- new or changed rows immediately, then COMMIT releases the lock before the
-- existing-row validation pass.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "hosted_usage_credit_entry"
  DROP CONSTRAINT IF EXISTS "hosted_usage_credit_entry_amount_direction_valid",
  DROP CONSTRAINT IF EXISTS "hosted_usage_credit_entry_source_shape_valid",
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

COMMIT;

-- VALIDATE CONSTRAINT takes the less disruptive validation lock, so ordinary
-- ledger reads and writes continue while PostgreSQL scans retained rows.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "hosted_usage_credit_entry"
  VALIDATE CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid",
  VALIDATE CONSTRAINT "hosted_usage_credit_entry_source_shape_valid";

COMMIT;
