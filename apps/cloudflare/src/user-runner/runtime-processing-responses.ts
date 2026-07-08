import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  computeHostedRuntimeProcessingRecheckDelayMs,
} from "../runtime-processing-timing.ts";
import type {
  RuntimeProcessingRetryReason,
} from "./diagnostics.js";

export function computeRuntimeProcessingRetryAt(
  reason: RuntimeProcessingRetryReason,
): string {
  const delayMs =
    reason === "starting_fence_preserved" ? 3_000 :
    reason === "stale_fence_replacement_race" ? 5_000 :
    reason === "container_busy" ? 5_000 :
    reason === "command_budget_exhausted" ? 10_000 :
    reason === "container_rpc_timeout" ? 10_000 :
    reason === "container_rpc_error" ? 30_000 :
    reason === "missing_container_binding" ? 60_000 :
    15_000;

  return new Date(Date.now() + delayMs).toISOString();
}

export function computeRuntimeProcessingOwnerRecheckAt(input: {
  env: HostedExecutionEnvironment;
}): string {
  return computeActiveRuntimeWakeRecheckAt(input.env);
}

export function createRuntimeProcessingRetryLater(input: {
  reason: RuntimeProcessingRetryReason;
  userId: string;
}): HostedRuntimeEnsureProcessingResponse {
  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      runtimeProcessingRetryReason: input.reason,
    },
    level: "warn",
    message: "Hosted runner runtime processing could not be accepted yet.",
    phase: "runtime.starting",
    userId: input.userId,
  });
  return {
    kind: "retry_later",
    retryAt: computeRuntimeProcessingRetryAt(input.reason),
  };
}

function computeActiveRuntimeWakeRecheckAt(env: HostedExecutionEnvironment): string {
  return new Date(
    Date.now() + computeHostedRuntimeProcessingRecheckDelayMs({
      idleCheckpointDelayMs: env.idleCheckpointDelayMs,
      runnerCommitTimeoutMs: env.runnerCommitTimeoutMs,
    }),
  ).toISOString();
}
