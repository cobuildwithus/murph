import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  resolveHostedExecutionRunnerContainerName,
  type HostedExecutionContainerNamespaceLike,
  type RunnerContainerEnsureProcessingResult,
  type RunnerRuntimeWakeInput,
  type RunnerRuntimeWakeResult,
} from "../runner-container.js";
import {
  buildHostedRunnerMetadataOnlyErrorDetails,
} from "./diagnostics.js";
import {
  isRuntimeProcessingCommandBudgetTimeout,
  runRuntimeProcessingCommandStep,
  type RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";

export async function ensureActiveRuntimeProcessing(
  input: {
    activeRuntime: RunnerRuntimeWakeInput;
    commandBudget: RuntimeProcessingCommandBudget;
    env: HostedExecutionEnvironment;
    reason: HostedWorkspaceInvocationReason;
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
    runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  },
): Promise<
  | Extract<RunnerContainerEnsureProcessingResult, { kind: "accepted" }>
  | Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>
  | Extract<RunnerContainerEnsureProcessingResult, { kind: "wake-unconfirmed" }>
> {
  if (!input.runnerContainerNamespace) {
    return { kind: "wake-unconfirmed", reason: "missing-container-binding" };
  }

  const container = input.runnerContainerNamespace.getByName(
    resolveHostedExecutionRunnerContainerName({
      source: input.runnerRuntimeEnvSource,
      userId: input.activeRuntime.userId,
    }),
  );

  const ensureProcessing = container.ensureProcessing;
  if (ensureProcessing) {
    try {
      const result = await runRuntimeProcessingCommandStep({
        budget: input.commandBudget,
        operation: async () => await ensureProcessing({
          activeRuntime: input.activeRuntime,
          reason: input.reason,
          userId: input.activeRuntime.userId,
        }),
        stepTimeoutMs: input.env.runnerTimeoutMs,
      });
      if (
        result.kind === "accepted"
        || result.kind === "start-required"
        || result.kind === "wake-unconfirmed"
      ) {
        return result;
      }
      return { kind: "wake-unconfirmed", reason: "container-rpc-error" };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted runner could not ensure active runtime processing.",
        phase: "scheduled",
        userId: input.activeRuntime.userId,
      });
      return {
        kind: "wake-unconfirmed",
        reason: isRuntimeProcessingCommandBudgetTimeout(error)
          ? "container-rpc-timeout"
          : "container-rpc-error",
      };
    }
  }

  const wakeRuntime = container.wakeRuntime;
  if (!wakeRuntime) {
    return { kind: "wake-unconfirmed", reason: "missing-wake-method" };
  }

  try {
    const runtimeWake = normalizeRunnerRuntimeWakeResult(
      await runRuntimeProcessingCommandStep({
        budget: input.commandBudget,
        operation: async () => await wakeRuntime(input.activeRuntime),
        stepTimeoutMs: input.env.runnerTimeoutMs,
      }),
    );
    if (runtimeWake.kind === "accepted") {
      return { action: runtimeWake.action, kind: "accepted" };
    }
    if (runtimeWake.kind === "not-wakeable") {
      return { kind: "start-required", reason: "no-active-child" };
    }
    return { kind: "wake-unconfirmed", reason: runtimeWake.reason };
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: buildHostedRunnerMetadataOnlyErrorDetails(error),
      level: "warn",
      message: "Hosted runner could not ensure active runtime processing.",
      phase: "scheduled",
      userId: input.activeRuntime.userId,
    });
    return {
      kind: "wake-unconfirmed",
      reason: isRuntimeProcessingCommandBudgetTimeout(error)
        ? "container-rpc-timeout"
        : "container-rpc-error",
    };
  }
}

export function normalizeRunnerRuntimeWakeResult(value: unknown): RunnerRuntimeWakeResult {
  if (isObjectRecord(value)) {
    if (value.kind === "accepted") {
      return {
        action: value.action === "already_running" ? "already_running" : "woken",
        kind: "accepted",
      };
    }
    if (value.kind === "not-wakeable" && value.reason === "no-active-child") {
      return { kind: "not-wakeable", reason: "no-active-child" };
    }
    if (value.kind === "unknown" && typeof value.reason === "string") {
      return {
        kind: "unknown",
        reason: isRunnerRuntimeWakeUnknownReason(value.reason)
          ? value.reason
          : "container-rpc-error",
      };
    }
  }

  return { kind: "unknown", reason: "container-rpc-error" };
}

function isRunnerRuntimeWakeUnknownReason(
  value: string,
): value is Extract<RunnerRuntimeWakeResult, { kind: "unknown" }>["reason"] {
  return value === "active-child-rejected"
    || value === "container-rpc-error"
    || value === "container-rpc-timeout"
    || value === "missing-container-binding"
    || value === "missing-wake-method";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
