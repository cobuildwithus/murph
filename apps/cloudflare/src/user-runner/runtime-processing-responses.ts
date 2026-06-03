import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimePrewarmRequest,
  HostedRuntimePrewarmResponse,
} from "@murphai/hosted-execution/orchestration-control";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  computeHostedRuntimeProcessingRecheckDelayMs,
} from "../runtime-processing-timing.ts";
import type {
  RuntimeProcessingRetryReason,
} from "./diagnostics.js";
import type {
  RunnerStateRecord,
} from "./types.js";

type RuntimePrewarmResponseInput = HostedRuntimePrewarmRequest & {
  userId: string;
};

export function computeRuntimeProcessingRetryAt(
  reason: RuntimeProcessingRetryReason,
): string {
  const delayMs =
    reason === "stale_fence_replacement_race" ? 5_000 :
    reason === "container_busy" ? 5_000 :
    reason === "container_rpc_timeout" ? 10_000 :
    reason === "container_rpc_error" ? 30_000 :
    reason === "missing_container_binding" ? 60_000 :
    15_000;

  return new Date(Date.now() + delayMs).toISOString();
}

export function computeRuntimeProcessingOwnerWatchdogAt(input: {
  activeFence: Pick<NonNullable<RunnerStateRecord["writeFence"]>, "expiresAt">;
  env: HostedExecutionEnvironment;
}): string {
  const activeRuntimeWakeRecheckMs = Date.parse(computeActiveRuntimeWakeRecheckAt(input.env));
  const expiresAtMs = Date.parse(input.activeFence.expiresAt);
  const watchdogMs = Number.isFinite(expiresAtMs)
    ? Math.min(expiresAtMs, activeRuntimeWakeRecheckMs)
    : activeRuntimeWakeRecheckMs;
  return new Date(Math.max(Date.now(), watchdogMs)).toISOString();
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

export function createActiveWorkspaceWakeRetryLater(input: {
  activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
  env: HostedExecutionEnvironment;
  userId: string;
}): HostedRuntimeEnsureProcessingResponse {
  const retryAt = computeRuntimeProcessingOwnerWatchdogAt({
    activeFence: input.activeFence,
    env: input.env,
  });
  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      retryAt,
      runtimeProcessingRetryReason: "active_runtime_workspace_wake",
      workspaceAttemptIdPresent: input.activeFence.attemptId.length > 0,
    },
    message: "Hosted runner deferred workspace wake while runtime processing is already active.",
    phase: "runtime.starting",
    userId: input.userId,
  });
  return {
    kind: "retry_later",
    retryAt,
  };
}

export function recordRuntimePrewarmAccepted(input: {
  action: Extract<
    HostedRuntimePrewarmResponse,
    { kind: "runtime_prewarm_accepted" }
  >["action"];
  input: RuntimePrewarmResponseInput;
}): HostedRuntimePrewarmResponse {
  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      prewarmAttemptIdPresent: input.input.prewarmAttemptId.length > 0,
      runtimePrewarmAction: input.action,
      source: input.input.source,
    },
    message: "Hosted runner runtime prewarm accepted.",
    phase: "runtime.prewarm",
    userId: input.input.userId,
  });
  return {
    action: input.action,
    kind: "runtime_prewarm_accepted",
  };
}

export function createRuntimePrewarmRetryLater(input: {
  reason: RuntimeProcessingRetryReason;
  userId: string;
}): HostedRuntimePrewarmResponse {
  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      runtimePrewarmAction: "retry_later",
      runtimePrewarmRetryReason: input.reason,
    },
    level: "warn",
    message: "Hosted runner runtime prewarm could not be accepted yet.",
    phase: "runtime.prewarm",
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
