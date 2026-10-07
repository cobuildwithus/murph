-- Quiesce and drain old Web/runtime consumers before deploying matching OpenAI-only code.
-- Run this post-deploy cleanup only after all old readers and writers are gone.
-- This deployment becomes the rollback floor after the obsolete state is dropped.
ALTER TABLE "hosted_member"
  DROP COLUMN IF EXISTS "assistant_provider_preference";
ALTER TABLE "hosted_runtime_owner"
  DROP COLUMN IF EXISTS "custom_inference_envelope";
DROP TABLE IF EXISTS "hosted_inference_connection";
DROP SEQUENCE IF EXISTS "hosted_inference_connection_revision_seq";
