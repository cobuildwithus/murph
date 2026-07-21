ALTER TABLE "clinical_record_retrieval_run"
  ADD COLUMN "retrieval_protocol" TEXT;

ALTER TABLE "clinical_record_retrieval_request"
  ADD COLUMN "query_scope_id" TEXT,
  ADD COLUMN "slice_id" TEXT;
