-- Expand hosted phone-call storage so new web code can persist private call
-- content only as control-domain ciphertext. Legacy JSON remains readable for
-- deploy skew and backfill, but new encrypted-only rows establish a rollback
-- floor for older web builds that require brief_json.
ALTER TABLE "hosted_phone_call"
  ADD COLUMN "brief_encrypted" TEXT,
  ADD COLUMN "result_encrypted" TEXT,
  ALTER COLUMN "brief_json" DROP NOT NULL;
