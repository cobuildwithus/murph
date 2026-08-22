import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";

import type { HostedExecutionEnvironment } from "../env.js";
import type {
  WorkerAnalyticsEngineDatasetLike,
} from "../worker-contracts.js";
import {
  computeHostedRuntimeProcessingRecheckDelayMs,
} from "../runtime-processing-timing.ts";
import type {
  RuntimeProcessingRetryReason,
} from "./diagnostics.js";

export const HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA =
  "murph.hosted-runtime-retry.v1";

export function readRuntimeProcessingRetryDelayMs(
  reason: RuntimeProcessingRetryReason,
): number {
  return reason === "checkpoint_handoff_pending" ? 1_000 :
    reason === "starting_fence_preserved" ? 3_000 :
    reason === "container_busy" ? 5_000 :
    reason === "command_budget_exhausted" ? 10_000 :
    reason === "container_rpc_timeout" ? 10_000 :
    reason === "container_rpc_error" ? 30_000 :
    reason === "missing_container_binding" ? 60_000 :
    15_000;
}

export function computeRuntimeProcessingRetryAt(
  reason: RuntimeProcessingRetryReason,
): string {
  return new Date(
    Date.now() + readRuntimeProcessingRetryDelayMs(reason),
  ).toISOString();
}

export function computeRuntimeProcessingOwnerRecheckAt(input: {
  env: HostedExecutionEnvironment;
}): string {
  return computeActiveRuntimeWakeRecheckAt(input.env);
}

export function createRuntimeProcessingRetryLater(input: {
  analytics?: WorkerAnalyticsEngineDatasetLike | null;
  orchestrationAttemptId?: string;
  reason: RuntimeProcessingRetryReason;
  userId: string;
}): HostedRuntimeEnsureProcessingResponse {
  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      ...(input.orchestrationAttemptId === undefined
        ? {}
        : { orchestrationAttemptId: input.orchestrationAttemptId }),
      runtimeProcessingRetryReason: input.reason,
    },
    level: "warn",
    message: "Hosted runner runtime processing could not be accepted yet.",
    phase: "runtime.starting",
    userId: input.userId,
  });
  // Analytics Engine remains deliberately identifier-free; correlation lives
  // only in the structured Workers log above.
  recordRuntimeProcessingRetry(input.analytics ?? null, input.reason);
  return {
    kind: "retry_later",
    retryAt: computeRuntimeProcessingRetryAt(input.reason),
  };
}

function recordRuntimeProcessingRetry(
  analytics: WorkerAnalyticsEngineDatasetLike | null,
  reason: RuntimeProcessingRetryReason,
): void {
  if (!analytics) {
    return;
  }
  try {
    analytics.writeDataPoint({
      indexes: [reason],
      blobs: [HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA, reason],
      doubles: [1, readRuntimeProcessingRetryDelayMs(reason)],
    });
  } catch {
    // Best-effort telemetry must never alter retry behavior.
  }
}

function computeActiveRuntimeWakeRecheckAt(env: HostedExecutionEnvironment): string {
  return new Date(
    Date.now() + computeHostedRuntimeProcessingRecheckDelayMs({
      idleCheckpointDelayMs: env.idleCheckpointDelayMs,
      runnerCommitTimeoutMs: env.runnerCommitTimeoutMs,
    }),
  ).toISOString();
}
