ALTER TABLE "hosted_mailbox_item"
ADD COLUMN "content_retired_at" TIMESTAMP(3),
ADD COLUMN "retention_disposition" TEXT;

-- Existing runner snapshots may contain message text, parser output, assistant
-- input, or transcripts while their older media-only retention pointer is
-- NULL or later than those carriers' deadline. Re-arm every persisted
-- workspace once during rollout so the existing Temporal/cron owner restores,
-- scrubs, and checkpoints it without waiting for unrelated member activity.
-- Deploy the retention-capable runner fleet before applying this migration.
UPDATE "hosted_workspace"
SET
  "inbox_media_retention_wake_at" = CURRENT_TIMESTAMP,
  "inbox_media_retention_signal_attempted_at" = NULL
WHERE "snapshot_ref" IS DISTINCT FROM NULL;
