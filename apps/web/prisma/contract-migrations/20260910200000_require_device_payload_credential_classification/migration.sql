-- Run through the guarded postdeploy lane after exact production and prior-function
-- drain proof. The existing 20260905000000_drop_clinical_record_duplicates
-- Web rollback floor follows the classify-on-write introduction (40245860a9).
-- A restored null backlog must fail contraction; no default can infer authority.
ALTER TABLE "device_sync_dirty_payload"
  ALTER COLUMN "credential_independent" SET NOT NULL;
