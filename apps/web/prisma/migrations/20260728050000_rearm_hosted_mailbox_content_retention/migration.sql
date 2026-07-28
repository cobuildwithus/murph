-- Recovery for a rollout where the phase-one Web migration was applied before
-- the stamping-capable runner fleet converged. Reuse the existing retention
-- wake and cron after convergence; advancing the workspace CAS version rejects
-- an invocation that read the pre-rearm wake. Checkpoint time remains unchanged
-- because this migration is not runtime progress.
UPDATE "hosted_workspace"
SET
  "inbox_media_retention_wake_at" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
  "inbox_media_retention_signal_attempted_at" = NULL,
  "version" = "version" + 1
WHERE "snapshot_ref" IS DISTINCT FROM NULL;
