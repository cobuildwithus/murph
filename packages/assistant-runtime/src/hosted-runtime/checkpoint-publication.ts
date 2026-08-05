import {
  HOSTED_WORKSPACE_INVOCATION_DEFAULT_IDLE_CHECKPOINT_DELAY_MS,
} from "@murphai/hosted-execution/runtime-control-limits";
import {
  HOSTED_WORKSPACE_SNAPSHOT_DIRECT_UPLOAD_WINDOW_MS,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import {
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  HOSTED_INTEGRATION_INGEST_ARCHIVE_TIMEOUT_MS,
} from "./idle-maintenance-limits.ts";
import { readHostedRunnerCommitTimeoutMs } from "./timeouts.ts";

const HOSTED_RUNTIME_MAX_TIMER_DELAY_MS = 2_147_483_647;
const HOSTED_RUNTIME_CHECKPOINT_CONTROL_STEPS = 3;

export function resolveHostedRuntimeIdleCheckpointDelayMs(
  value: number | null | undefined,
): number {
  if (value !== null && value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.min(Math.trunc(value), HOSTED_RUNTIME_MAX_TIMER_DELAY_MS);
  }

  return HOSTED_WORKSPACE_INVOCATION_DEFAULT_IDLE_CHECKPOINT_DELAY_MS;
}

export function resolveHostedRuntimeCheckpointPublicationExpectedByMs(input: {
  checkpointStartByMs: number;
  commitTimeoutMs: number | null;
}): number {
  const checkpointControlBudgetMs =
    readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs)
    * HOSTED_RUNTIME_CHECKPOINT_CONTROL_STEPS;
  const maintenanceBudgetMs =
    HOSTED_INTEGRATION_INGEST_ARCHIVE_TIMEOUT_MS
    + HOSTED_IDLE_COMPACT_TIMEOUT_MS;
  // Snapshot construction is bounded by the same single-object size limits as
  // direct upload. Reserve one upload window for local construction and one for
  // the presigned PUT, then the three bounded start/presign/complete calls.
  const snapshotBudgetMs =
    HOSTED_WORKSPACE_SNAPSHOT_DIRECT_UPLOAD_WINDOW_MS * 2
    + checkpointControlBudgetMs;

  return input.checkpointStartByMs
    + maintenanceBudgetMs
    + snapshotBudgetMs;
}
