-- The encrypted-only writer is the supported rollback floor. Retired plaintext
-- records must be deleted by the separately reviewed hosted Ops operation first.
-- These constraints validate existing rows and block legacy writes before the
-- encrypted-only reader deployment. They never delete or rewrite call content.
ALTER TABLE "hosted_phone_call"
  ADD CONSTRAINT "hosted_phone_call_plaintext_empty" CHECK (
    (brief_json IS NULL OR brief_json = 'null'::jsonb)
    AND (result_json IS NULL OR result_json = 'null'::jsonb)
  ),
  ADD CONSTRAINT "hosted_phone_call_brief_ciphertext_present" CHECK (
    brief_encrypted <> ''
  ),
  ALTER COLUMN "brief_encrypted" SET NOT NULL;
