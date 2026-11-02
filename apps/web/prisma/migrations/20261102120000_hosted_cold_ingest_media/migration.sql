-- Expand the existing encrypted media owner before any cold-history producer.
-- Both checks admit every existing row and every old writer (image/video only),
-- so replace atomically without scanning retained rows under the metadata lock.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE hosted_runtime_media DROP CONSTRAINT hosted_runtime_media_media_kind_check;
ALTER TABLE hosted_runtime_media ADD CONSTRAINT hosted_runtime_media_media_kind_check
  CHECK (media_kind IN ('image', 'video', 'integration-ingest')) NOT VALID;
ALTER TABLE hosted_runtime_media ADD CONSTRAINT hosted_runtime_media_cold_ingest_no_expiry
  CHECK (media_kind <> 'integration-ingest' OR NOT registered OR retired_at IS NOT NULL OR expires_at IS NULL) NOT VALID;
COMMIT;

-- Validate separately so ordinary reads and writes can continue during the scan.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE hosted_runtime_media VALIDATE CONSTRAINT hosted_runtime_media_media_kind_check;
ALTER TABLE hosted_runtime_media VALIDATE CONSTRAINT hosted_runtime_media_cold_ingest_no_expiry;
COMMIT;
