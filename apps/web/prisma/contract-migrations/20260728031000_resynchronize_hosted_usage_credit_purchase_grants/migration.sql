-- Runtime grant, debit, refund, and dispute writers all lock the beneficiary
-- member before changing purchase/grant projections. Acquire the same locks in
-- deterministic order as a separate statement so the following statement gets
-- a fresh READ COMMITTED snapshot after any in-flight writer commits.
SELECT COUNT(*) AS "lockedBeneficiaryCount"
FROM (
  SELECT member."id"
  FROM "hosted_member" AS member
  WHERE EXISTS (
    SELECT 1
    FROM "hosted_usage_credit_entry" AS entry
    WHERE entry."beneficiary_member_id" = member."id"
      AND entry."kind" = 'purchase_grant'
  )
  ORDER BY member."id"
  FOR UPDATE
) AS locked_beneficiary;

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

-- Keep the migration fail-closed if an unowned writer or malformed retained
-- row bypasses the beneficiary lock invariant. The outer contract-migration
-- transaction rolls the resync back instead of publishing divergent capacity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_usage_credit_entry" AS entry
    INNER JOIN "hosted_usage_credit_purchase" AS purchase
      ON purchase."id" = entry."purchase_id"
    LEFT JOIN "hosted_usage_credit_grant" AS grant_projection
      ON grant_projection."entry_id" = entry."id"
    WHERE entry."kind" = 'purchase_grant'
      AND grant_projection."remaining_usd_micros"
        IS DISTINCT FROM purchase."remaining_credit_usd_micros"
  ) THEN
    RAISE EXCEPTION
      'Hosted usage-credit purchase grant projection resynchronization did not converge.';
  END IF;
END
$$;
