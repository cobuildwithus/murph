-- Starter usage is an ordinary immutable positive grant. The first transaction
-- updates the ledger checks with bounded metadata locks; validation remains in
-- a separate transaction so retained rows are scanned under the lighter lock.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "hosted_usage_credit_entry"
  DROP CONSTRAINT IF EXISTS "hosted_usage_credit_entry_amount_direction_valid",
  DROP CONSTRAINT IF EXISTS "hosted_usage_credit_entry_source_shape_valid",
  ADD CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"
    CHECK (
      (
        "kind" IN ('starter_grant', 'purchase_grant', 'referral_grant')
        AND "amount_usd_micros" > 0
      )
      OR ("kind" = 'usage_debit' AND "amount_usd_micros" < 0)
      OR (
        "kind" IN ('refund_adjustment', 'dispute_adjustment')
        AND "amount_usd_micros" <> 0
      )
    ) NOT VALID,
  ADD CONSTRAINT "hosted_usage_credit_entry_source_shape_valid"
    CHECK (
      (
        "kind" = 'starter_grant'
        AND "purchase_id" IS NULL
        AND "referral_id" IS NULL
        AND "parent_grant_entry_id" IS NULL
        AND "source_usage_id" IS NULL
        AND "source_reference_lookup_key" IS NOT NULL
      )
      OR
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
        AND NOT (
          "purchase_id" IS NOT NULL
          AND "referral_id" IS NOT NULL
        )
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

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "hosted_usage_credit_entry"
  VALIDATE CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid",
  VALIDATE CONSTRAINT "hosted_usage_credit_entry_source_shape_valid";

COMMIT;

-- Preserve each eligible legacy trial as one canonical, immutable $4.50
-- starter grant. Historical trial consumption is represented by a deterministic
-- debit against that grant, while the mutable projections retain only the
-- unused amount. Explicitly canceled/unpaid accounts and paid conversions are
-- not reactivated. Eligible member rows are locked in a deterministic order,
-- matching the ordinary ledger writer's beneficiary-row lock without taking a
-- table-wide lock that could stall unrelated members.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE "hosted_starter_usage_migration" ON COMMIT DROP AS
SELECT
  member."id" AS "member_id",
  COALESCE(member."usage_credit_ledger_version", 0) + 1
    AS "grant_beneficiary_sequence",
  COALESCE(member."usage_credit_ledger_version", 0) + 2
    AS "debit_beneficiary_sequence",
  COALESCE(member."usage_credit_balance_usd_micros", 0)
    AS "existing_balance_usd_micros",
  COALESCE(
    billing_ref."pulse_trial_redeemed_at",
    billing_ref."current_trial_started_at",
    member."created_at"
  ) AS "effective_at",
  4500000::BIGINT AS "grant_usd_micros",
  GREATEST(
    0::BIGINT,
    LEAST(
      4500000::BIGINT,
      COALESCE(period."limit_usd_micros", 4500000::BIGINT)
    ) - COALESCE(period."spent_usd_micros", 0::BIGINT)
  ) AS "remaining_usd_micros",
  4500000::BIGINT - GREATEST(
    0::BIGINT,
    LEAST(
      4500000::BIGINT,
      COALESCE(period."limit_usd_micros", 4500000::BIGINT)
    ) - COALESCE(period."spent_usd_micros", 0::BIGINT)
  ) AS "consumed_usd_micros",
  'huce_' || SUBSTRING(
    MD5(member."id" || ':starter-usage-2026-08-07-v1'),
    1,
    24
  ) AS "grant_entry_id",
  'huce_' || SUBSTRING(
    MD5(member."id" || ':starter-usage-2026-08-07-v1:consumed'),
    1,
    24
  ) AS "debit_entry_id",
  'hosted-starter-usage:' || member."id"
    || ':starter-usage-2026-08-07-v1' AS "grant_semantic_source_key",
  'starter-usage-migration:' || member."id"
    || ':starter-usage-2026-08-07-v1' AS "debit_source_usage_id",
  COALESCE(period."limit_usd_micros" < 0, FALSE)
    OR COALESCE(period."spent_usd_micros" < 0, FALSE)
    AS "usage_period_malformed"
FROM "hosted_member" AS member
INNER JOIN "hosted_member_billing_ref" AS billing_ref
  ON billing_ref."member_id" = member."id"
LEFT JOIN "hosted_ai_usage_period" AS period
  ON period."member_id" = member."id"
  AND period."period_start" = COALESCE(
    billing_ref."current_trial_started_at",
    billing_ref."pulse_trial_redeemed_at"
  )
WHERE member."suspended_at" IS NULL
  AND member."billing_status" IN ('active', 'paused', 'incomplete')
  AND billing_ref."current_billing_phase" IS DISTINCT FROM 'paid'
  AND (
    billing_ref."current_billing_phase" = 'trial'
    OR billing_ref."current_checkout_offer" = 'pulse_trial_7d'
  )
  AND billing_ref."pulse_trial_redeemed_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "hosted_usage_credit_entry" AS existing
    WHERE existing."semantic_source_key" =
      'hosted-starter-usage:' || member."id"
        || ':starter-usage-2026-08-07-v1'
  )
ORDER BY member."id"
FOR UPDATE OF member, billing_ref;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_starter_usage_migration"
    WHERE "usage_period_malformed"
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate Starter usage while a legacy trial usage period is malformed.';
  END IF;
END
$$;

INSERT INTO "hosted_usage_credit_entry" (
  "id",
  "beneficiary_member_id",
  "beneficiary_sequence",
  "kind",
  "amount_usd_micros",
  "effective_at",
  "semantic_source_key",
  "purchase_id",
  "referral_id",
  "parent_grant_entry_id",
  "source_usage_id",
  "source_reference_lookup_key",
  "created_at"
)
SELECT
  migration."grant_entry_id",
  migration."member_id",
  migration."grant_beneficiary_sequence",
  'starter_grant'::"HostedUsageCreditEntryKind",
  migration."grant_usd_micros",
  migration."effective_at",
  migration."grant_semantic_source_key",
  NULL,
  NULL,
  NULL,
  NULL,
  'starter-usage-source:legacy_trial_migration',
  CURRENT_TIMESTAMP
FROM "hosted_starter_usage_migration" AS migration;

INSERT INTO "hosted_usage_credit_grant" (
  "entry_id",
  "remaining_usd_micros",
  "created_at",
  "updated_at"
)
SELECT
  migration."grant_entry_id",
  migration."remaining_usd_micros",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "hosted_starter_usage_migration" AS migration;

INSERT INTO "hosted_usage_credit_entry" (
  "id",
  "beneficiary_member_id",
  "beneficiary_sequence",
  "kind",
  "amount_usd_micros",
  "effective_at",
  "semantic_source_key",
  "purchase_id",
  "referral_id",
  "parent_grant_entry_id",
  "source_usage_id",
  "source_reference_lookup_key",
  "created_at"
)
SELECT
  migration."debit_entry_id",
  migration."member_id",
  migration."debit_beneficiary_sequence",
  'usage_debit'::"HostedUsageCreditEntryKind",
  -migration."consumed_usd_micros",
  migration."effective_at",
  'hosted-usage-credit:usage:' || migration."debit_source_usage_id"
    || ':grant:' || migration."grant_entry_id" || ':debit:v1',
  NULL,
  NULL,
  migration."grant_entry_id",
  migration."debit_source_usage_id",
  NULL,
  CURRENT_TIMESTAMP
FROM "hosted_starter_usage_migration" AS migration
WHERE migration."consumed_usd_micros" > 0;

UPDATE "hosted_member" AS member
SET
  "billing_status" = 'active',
  "usage_credit_balance_usd_micros" =
    migration."existing_balance_usd_micros"
      + migration."remaining_usd_micros",
  "usage_credit_ledger_version" = CASE
    WHEN migration."consumed_usd_micros" > 0
    THEN migration."debit_beneficiary_sequence"
    ELSE migration."grant_beneficiary_sequence"
  END,
  "updated_at" = CURRENT_TIMESTAMP
FROM "hosted_starter_usage_migration" AS migration
WHERE member."id" = migration."member_id";

UPDATE "hosted_ai_usage_period" AS period
SET
  "blocked_at" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
FROM "hosted_starter_usage_migration" AS migration
WHERE period."member_id" = migration."member_id"
  AND period."period_start" <= migration."effective_at"
  AND period."period_end" > migration."effective_at"
  AND migration."existing_balance_usd_micros"
    + migration."remaining_usd_micros" > 0;

COMMIT;
