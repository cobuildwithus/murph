---
title: 'Managed snapshot completion streams the whole object through the Worker and outgrows the runner commit budget'
severity: 'major'
---

## Expected Behavior

With `HOSTED_RUNTIME_POSTGRES_ENABLED=true`, a workspace checkpoint should complete in roughly the same time as the direct-PUT path did: a few seconds for typical workspaces and well inside the runner's commit budget for large ones.

## Current Behavior

Once the capability is enabled every member's checkpoint uses the managed multipart path, and `completeManagedSnapshotUpload` verifies the encrypted object by streaming it back through the Worker and hashing it (`verifyManagedSnapshotBytes`, 60-second deadline). Completion time scales with snapshot size and degraded further after each container rollout: fleet p50 checkpoint time rose from about 3 s to 8 s and p90 from about 8 s to 27-30 s, while the presign and Web/Durable Object control calls stayed flat. Workspaces around 100-170 MB plain (23-51 MB encrypted) take 40-60 s to complete on the Worker side, so the runner's default `CF_RUNNER_COMMIT_TIMEOUT_MS` of 45 s expires first and the checkpoint is recorded as `checkpoint.snapshot_failed` with `timeout`, even though the Worker later answers 200. Affected members can go several cycles without a persisted snapshot.

## Possible Solution

Verify bytes without a read-back stream: carry a SHA-256 (or CRC) checksum on the presigned part or PUT so R2 validates at write time, then compare `head()` checksums against the admitted receipt. Until then, raise the verification deadline to fit inside the runner commit budget and keep `CF_RUNNER_COMMIT_TIMEOUT_MS` above the observed completion tail (it was raised to 120000 in production as a stopgap). Record per-stage timings (multipart complete, verification stream, settle) in the completion response log so regressions are attributable.

## Minimal Reproducible Example

Enable the capability in hosted-local, checkpoint a synthetic workspace of about 150 MB plain, and time the `workspace_snapshot_complete` request while the runner commit timeout is 45 s; the Worker completes after the runner has already given up.

## Context

Found during the first production rolling migration canary while confirming that a migrated member's post-migration checkpoints persisted. It affects legacy and Postgres-owned members alike because the managed path is selected by the deployment capability, not by the member's backend.
