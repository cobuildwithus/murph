-- Apply only after the receipt-derived reader/writer is serving and old Web
-- functions have drained. This deployment is the rollback floor after cleanup.
ALTER TABLE "clinical_record_retrieval_run"
  DROP COLUMN IF EXISTS "imported_count",
  DROP COLUMN IF EXISTS "review_count";
