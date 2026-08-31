-- The additive migration gives existing receipts and old-Web inserts a zero
-- cursor. Require that shape only after the cursor-writing Web deployment is
-- live and the prior function window has drained.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_account_deletion_cleanup"
    WHERE "temporal_next_runtime_index" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot require the Temporal cleanup cursor while a NULL value remains.'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

ALTER TABLE "hosted_account_deletion_cleanup"
  ALTER COLUMN "temporal_next_runtime_index" SET NOT NULL;
