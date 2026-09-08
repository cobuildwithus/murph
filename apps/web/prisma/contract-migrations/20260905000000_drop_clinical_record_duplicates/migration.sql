-- Run only after the reader without these columns is current in production.
-- This deployment becomes the Web rollback floor after the drop.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "clinical_record_connection"
  DROP COLUMN IF EXISTS "token_endpoint",
  DROP COLUMN IF EXISTS "client_id",
  DROP COLUMN IF EXISTS "refresh_token_encrypted",
  DROP COLUMN IF EXISTS "granted_scopes_json";
ALTER TABLE "clinical_record_retrieval_run"
  DROP COLUMN IF EXISTS "resource_types_json";
