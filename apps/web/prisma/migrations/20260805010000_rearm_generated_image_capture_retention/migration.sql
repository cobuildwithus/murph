-- Deploy the generated-image-retention-capable runner fleet before applying
-- this migration. Reuse the existing retention wake and bounded cron so
-- persisted snapshots are scrubbed without waiting for member activity.
-- Advancing the workspace CAS version rejects an invocation that read the old
-- wake; checkpoint time remains unchanged because this is not runtime progress.
UPDATE "hosted_workspace"
SET
  "inbox_media_retention_wake_at" =
    date_trunc('milliseconds', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "inbox_media_retention_signal_attempted_at" = NULL,
  "version" = "version" + 1
WHERE "snapshot_ref" IS DISTINCT FROM NULL;
