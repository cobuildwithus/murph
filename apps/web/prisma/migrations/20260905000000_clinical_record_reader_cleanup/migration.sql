-- Reader-first rollout: old Web deployments may still select these columns.
-- Stop using them now; remove the compatibility columns after this reader is deployed.
ALTER TABLE "clinical_record_connection"
  ADD COLUMN "patient_binding_encrypted" TEXT,
  ALTER COLUMN "token_endpoint" SET DEFAULT '',
  ALTER COLUMN "client_id" SET DEFAULT '',
  ALTER COLUMN "granted_scopes_json" SET DEFAULT '[]';
ALTER TABLE "clinical_record_retrieval_run"
  ALTER COLUMN "resource_types_json" SET DEFAULT '[]';
