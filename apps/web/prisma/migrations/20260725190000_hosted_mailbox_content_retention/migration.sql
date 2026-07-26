-- Deploy the phase-one stamping-capable runner fleet before applying this
-- migration. The rearm queues each persisted snapshot for the existing
-- retention cron so receipt-backed message carriers are scrubbed without
-- waiting for unrelated member activity; phase-one runtime code intentionally
-- preserves unstamped legacy transcript entries whose receipt can no longer be
-- proved. The rollout is not complete until that due queue drains.
ALTER TABLE "hosted_mailbox_item"
ADD COLUMN "content_retired_at" TIMESTAMP(3),
ADD COLUMN "retention_disposition" TEXT;

UPDATE "hosted_workspace"
SET
  "inbox_media_retention_wake_at" = CURRENT_TIMESTAMP,
  "inbox_media_retention_signal_attempted_at" = NULL
WHERE "snapshot_ref" IS DISTINCT FROM NULL;
