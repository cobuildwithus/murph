BEGIN;

-- AlterTable
ALTER TABLE "hosted_usage_credit_purchase"
ADD COLUMN "grant_slot_released_at" TIMESTAMP(3);

-- Release only history whose existing durable facts prove that an exact
-- provider object reached a no-payment terminal state. Durable lookup keys
-- survive payer detachment. For ordinary/activation purchases, a reference-free
-- reconciliation timestamp is written only after definitive account-deletion
-- absence proof; their local deadline writers leave it NULL. Automatic refill
-- ordinals above zero are excluded: their local deadline owner also writes
-- last_reconciled_at without provider-final proof.
UPDATE "hosted_usage_credit_purchase"
SET "grant_slot_released_at" = COALESCE(
  "last_reconciled_at",
  "terminal_at"
)
WHERE "grant_slot_released_at" IS NULL
  AND "status" = 'expired'
  AND "paid_at" IS NULL
  AND "terminal_at" IS NOT NULL
  AND (
    "stripe_checkout_session_lookup_key" IS NOT NULL
    OR (
      "last_reconciled_at" IS NOT NULL
      AND (
        "stripe_payment_intent_lookup_key" IS NOT NULL
        OR "group_sponsorship_charge_ordinal" IS NULL
        OR "group_sponsorship_charge_ordinal" = 0
      )
    )
  );

ALTER TABLE "hosted_usage_credit_grant"
  ADD COLUMN "beneficiary_member_id" TEXT,
  ADD COLUMN "beneficiary_sequence" BIGINT;

UPDATE "hosted_usage_credit_grant" AS grant_projection
SET
  "beneficiary_member_id" = entry."beneficiary_member_id",
  "beneficiary_sequence" = entry."beneficiary_sequence"
FROM "hosted_usage_credit_entry" AS entry
WHERE entry."id" = grant_projection."entry_id";

-- Prisma migrations run before the replacement Vercel deployment is promoted.
-- Fill the immutable canonical identity for the prior writer, which knows only
-- entry_id and remaining_usd_micros, and reject mismatched or later mutation.
CREATE FUNCTION enforce_hosted_usage_credit_grant_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_beneficiary_member_id TEXT;
  canonical_beneficiary_sequence BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."entry_id" IS DISTINCT FROM OLD."entry_id"
      OR NEW."beneficiary_member_id" IS DISTINCT FROM OLD."beneficiary_member_id"
      OR NEW."beneficiary_sequence" IS DISTINCT FROM OLD."beneficiary_sequence"
    THEN
      RAISE EXCEPTION
        'Hosted usage-credit grant canonical identity is immutable.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT
    entry."beneficiary_member_id",
    entry."beneficiary_sequence"
  INTO
    canonical_beneficiary_member_id,
    canonical_beneficiary_sequence
  FROM "hosted_usage_credit_entry" AS entry
  WHERE entry."id" = NEW."entry_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Hosted usage-credit grant canonical entry is missing.';
  END IF;

  NEW."beneficiary_member_id" := COALESCE(
    NEW."beneficiary_member_id",
    canonical_beneficiary_member_id
  );
  NEW."beneficiary_sequence" := COALESCE(
    NEW."beneficiary_sequence",
    canonical_beneficiary_sequence
  );

  IF NEW."beneficiary_member_id" IS DISTINCT FROM canonical_beneficiary_member_id
    OR NEW."beneficiary_sequence" IS DISTINCT FROM canonical_beneficiary_sequence
  THEN
    RAISE EXCEPTION
      'Hosted usage-credit grant canonical identity does not match its entry.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_usage_credit_grant_identity_insert"
BEFORE INSERT ON "hosted_usage_credit_grant"
FOR EACH ROW
EXECUTE FUNCTION enforce_hosted_usage_credit_grant_identity();

CREATE TRIGGER "hosted_usage_credit_grant_identity_update"
BEFORE UPDATE OF
  "entry_id",
  "beneficiary_member_id",
  "beneficiary_sequence"
ON "hosted_usage_credit_grant"
FOR EACH ROW
EXECUTE FUNCTION enforce_hosted_usage_credit_grant_identity();

ALTER TABLE "hosted_usage_credit_grant"
  ALTER COLUMN "beneficiary_member_id" SET NOT NULL,
  ALTER COLUMN "beneficiary_sequence" SET NOT NULL;

CREATE INDEX "hosted_usage_credit_grant_beneficiary_active_fifo_idx"
  ON "hosted_usage_credit_grant"(
    "beneficiary_member_id",
    "beneficiary_sequence"
  )
  WHERE "remaining_usd_micros" > 0;

CREATE INDEX "hosted_usage_credit_purchase_beneficiary_reserved_slot_idx"
  ON "hosted_usage_credit_purchase"("beneficiary_member_id", "id")
  WHERE "status" <> 'fulfilled'
    AND "grant_slot_released_at" IS NULL;

COMMIT;
