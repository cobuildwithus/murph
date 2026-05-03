ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "provider_request_outcome" TEXT NOT NULL DEFAULT 'succeeded';
