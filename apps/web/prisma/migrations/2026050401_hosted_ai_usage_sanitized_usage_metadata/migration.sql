ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "provider_request_id" TEXT,
  ADD COLUMN "raw_usage_json" JSONB,
  ADD COLUMN "raw_usage_json_hash" TEXT,
  ADD COLUMN "usage_extraction_version" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "usage_extraction_source_path" TEXT;
