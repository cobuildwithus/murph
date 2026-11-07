-- HOLD: merge only after the encrypted-only reader deployment is active and
-- every older phone-call function and deployment-pinned Workflow has drained.
-- The deployment contract workflow discovers and executes this directory
-- automatically; its opt-in environment flag is not a release hold.

LOCK TABLE "hosted_phone_call" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20260910210000_require_hosted_phone_call_encrypted_private_content'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Phone plaintext reader-removal predeploy guard has not completed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "hosted_phone_call"
    WHERE (brief_json IS NOT NULL AND brief_json <> 'null'::jsonb)
       OR (result_json IS NOT NULL AND result_json <> 'null'::jsonb)
  ) THEN
    RAISE EXCEPTION 'Phone plaintext columns still contain private content';
  END IF;
END;
$$;

ALTER TABLE "hosted_phone_call"
  DROP COLUMN "brief_json",
  DROP COLUMN "result_json";
