-- Current producers use retrieving for both retrieval and canonical import.
-- Normalize historical rows before deploying the narrower reader. Older Web
-- already accepts retrieving, so this remains backward compatible.
UPDATE "clinical_record_retrieval_run"
SET "status" = 'retrieving'
WHERE "status" = 'importing';
