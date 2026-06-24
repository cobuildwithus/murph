ALTER TABLE "hosted_workspace"
  ADD COLUMN "inbox_media_retention_wake_at" TIMESTAMP(3),
  ADD COLUMN "inbox_media_retention_signal_attempted_at" TIMESTAMP(3);

-- Spread the initial wake across a 14-day random window so existing dormant
-- workspaces drain in roughly a retention window instead of LIMIT 25 / hour
-- through the cleanup cron (~166 days for 100K workspaces). Active workspaces
-- are dispatched directly by Temporal so they are unaffected by the cron lane.
UPDATE "hosted_workspace"
SET "inbox_media_retention_wake_at" = CURRENT_TIMESTAMP + (random() * interval '14 days')
WHERE "inbox_media_retention_wake_at" IS NULL;

-- Partial index for the hourly cron's claim query in
-- apps/web/src/lib/hosted-retention/cleanup.ts
-- (claimDueInboxMediaRetentionSignalWorkspaces). Without it the
-- WHERE wake_at <= now ORDER BY signal_attempted_at NULLS FIRST, wake_at
-- query is a sequential scan + sort over the whole hosted_workspace table
-- every hour, and the cost grows linearly with member count.
CREATE INDEX "hosted_workspace_inbox_media_retention_due_idx"
  ON "hosted_workspace"
    ("inbox_media_retention_wake_at", "inbox_media_retention_signal_attempted_at" NULLS FIRST)
  WHERE "inbox_media_retention_wake_at" IS NOT NULL;
