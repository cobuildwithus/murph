-- Expand the existing encrypted media owner before any cold-history producer.
ALTER TABLE hosted_runtime_media DROP CONSTRAINT hosted_runtime_media_media_kind_check;
ALTER TABLE hosted_runtime_media ADD CONSTRAINT hosted_runtime_media_media_kind_check
  CHECK (media_kind IN ('image', 'video', 'integration-ingest'));
ALTER TABLE hosted_runtime_media ADD CONSTRAINT hosted_runtime_media_cold_ingest_no_expiry
  CHECK (media_kind <> 'integration-ingest' OR NOT registered OR retired_at IS NOT NULL OR expires_at IS NULL);
