-- Deploy the snapshot-excluding hosted runner fleet and drain older containers
-- before applying this migration. Reuse the existing indexed retention wake so
-- dormant snapshots are rewritten without member activity or a second cleanup
-- scheduler. The one set-based update touches only persisted workspaces; the
-- existing bounded hourly claim owns runtime dispatch.
--
-- Advancing the workspace CAS version rejects an invocation that read the old
-- wake. Checkpoint time remains unchanged because this is cleanup admission,
-- not runtime progress.
UPDATE "hosted_workspace"
SET
  "inbox_media_retention_wake_at" =
    date_trunc('milliseconds', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "inbox_media_retention_signal_attempted_at" = NULL,
  "version" = "version" + 1
WHERE "snapshot_ref" IS DISTINCT FROM NULL;
