import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  readHostedRunnerContainerIdentity,
} from "../hosted-runner-container-identity.js";
import { isHostedRunnerTargetName } from "../standby-runner-contract.js";
import {
  type HostedExecutionContainerNamespaceLike,
  type RunnerContainerEnsureProcessingResult,
  type RunnerRuntimeWakeInput,
  type RunnerRuntimeWakeResult,
} from "../runner-container.js";
import {
  buildHostedRunnerMetadataOnlyErrorDetails,
  type RuntimeProcessingDiagnostics,
} from "./diagnostics.js";
import {
  isRuntimeProcessingCommandBudgetTimeout,
  runRuntimeProcessingCommandStep,
  type RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";

export async function ensureActiveRuntimeProcessing(
  input: {
    activeRuntime: RunnerRuntimeWakeInput;
    diagnostics: RuntimeProcessingDiagnostics;
    commandBudget: RuntimeProcessingCommandBudget;
    env: HostedExecutionEnvironment;
    runnerContainerName: string | null;
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
    runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  },
): Promise<
  | Extract<RunnerContainerEnsureProcessingResult, { kind: "accepted" }>
  | Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>
  | Extract<RunnerContainerEnsureProcessingResult, { kind: "wake-unconfirmed" }>
> {
  // A command can converge on a new owner and issue another wake. Missing
  // metadata from that wake must not retain an earlier owner's observations.
  delete input.diagnostics.wakeDetails;
  if (!input.runnerContainerNamespace) {
    return { kind: "wake-unconfirmed", reason: "missing-container-binding" };
  }

  const runnerContainerName = readActiveRuntimeRunnerContainerName(input);
  if (!runnerContainerName) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        activeRuntimeAttemptIdPresent: input.activeRuntime.attemptId.length > 0,
        runnerContainerNamePresent: Boolean(input.runnerContainerName),
      },
      level: "warn",
      message: "Hosted runner active write fence container identity did not match the runtime user.",
      phase: "scheduled",
      userId: input.activeRuntime.userId,
    });
    return { kind: "wake-unconfirmed", reason: "container-rpc-error" };
  }

  const container = input.runnerContainerNamespace.getByName(runnerContainerName);

  if (container.ensureProcessing) {
    try {
      const result = await runRuntimeProcessingCommandStep({
        budget: input.commandBudget,
        operation: async () => {
          input.diagnostics.details.activeWakeRpcDispatchedAtEpochMs = Date.now();
          return await container.ensureProcessing!({
            activeRuntime: input.activeRuntime,
            userId: input.activeRuntime.userId,
          });
        },
        stepTimeoutMs: input.env.webControlTimeoutMs,
      });
      input.diagnostics.details.activeWakeRpcOutcome = "returned";
      copyRuntimeWakeDiagnostics(input.diagnostics, result);
      if (
        result.kind === "accepted"
        || result.kind === "start-required"
        || result.kind === "wake-unconfirmed"
      ) {
        return result;
      }
      return { kind: "wake-unconfirmed", reason: "container-rpc-error" };
    } catch (error) {
      input.diagnostics.details.activeWakeRpcOutcome = isRuntimeProcessingCommandBudgetTimeout(error)
        ? "caller_timeout" : "rpc_error";
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

  if (!container.wakeRuntime) {
    return { kind: "wake-unconfirmed", reason: "missing-wake-method" };
  }

  try {
    const result = await runRuntimeProcessingCommandStep({
      budget: input.commandBudget,
      operation: async () => {
        input.diagnostics.details.activeWakeRpcDispatchedAtEpochMs = Date.now();
        return await container.wakeRuntime!(input.activeRuntime);
      },
      stepTimeoutMs: input.env.webControlTimeoutMs,
    });
    input.diagnostics.details.activeWakeRpcOutcome = "returned";
    copyRuntimeWakeDiagnostics(input.diagnostics, result);
    const runtimeWake = normalizeRunnerRuntimeWakeResult(result);
    if (runtimeWake.kind === "accepted") {
      return { action: runtimeWake.action, kind: "accepted" };
    }
    if (runtimeWake.kind === "not-wakeable") {
      return { kind: "start-required", reason: "no-active-child" };
    }
    return { kind: "wake-unconfirmed", reason: runtimeWake.reason };
  } catch (error) {
    input.diagnostics.details.activeWakeRpcOutcome = isRuntimeProcessingCommandBudgetTimeout(error)
      ? "caller_timeout" : "rpc_error";
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

export function readActiveRuntimeRunnerContainerName(input: {
  activeRuntime: RunnerRuntimeWakeInput;
  runnerContainerName: string | null;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
}): string | null {
  if (!input.runnerContainerName) {
    return input.activeRuntime.userId;
  }

  if (isHostedRunnerTargetName(input.runnerContainerName)) {
    return input.runnerContainerName.trim();
  }

  const identity = readHostedRunnerContainerIdentity({
    containerName: input.runnerContainerName,
    source: input.runnerRuntimeEnvSource,
  });
  if (identity?.userId === input.activeRuntime.userId) {
    return identity.runnerContainerName;
  }

  const versionSuffixStart = input.runnerContainerName.lastIndexOf("--v-");
  if (versionSuffixStart <= 0) {
    return null;
  }
  const storedUserId = input.runnerContainerName.slice(0, versionSuffixStart).trim();
  return storedUserId === input.activeRuntime.userId
    ? input.runnerContainerName.trim()
    : null;
}

// Do not spread RPC values into runtime-log JSON. Older Workers may omit these
// fields; unknown fields/stages and malformed values remain unattributed.
function copyRuntimeWakeDiagnostics(
  diagnostics: RuntimeProcessingDiagnostics,
  result: unknown,
): void {
  if (!isObjectRecord(result)) return;
  // Diagnostics are optional across Worker revisions and cannot change the
  // control result, even for an unexpected throwing in-process test double.
  try {
    const details: RuntimeProcessingDiagnostics["details"] = {};
    copyRuntimeWakeDiagnosticFields(details, result.wakeDiagnostics);
    diagnostics.wakeDetails = details;
  } catch {
    // Keep the original wake result; never reinterpret telemetry as failure.
  }
}

function copyRuntimeWakeDiagnosticFields(
  details: RuntimeProcessingDiagnostics["details"],
  value: unknown,
): void {
  if (!isObjectRecord(value)) return;
  for (const key of [
    "wakeEnteredAtEpochMs", "wakeFinishedAtEpochMs", "wakeDispatchAtEpochMs",
    "wakeResponseAtEpochMs", "wakeDrainFinishedAtEpochMs",
    "wakeHandlerReceivedAtEpochMs", "wakeHandlerAcceptedAtEpochMs",
    "wakeStatus", "wakeLifecyclePendingCount",
  ] as const) {
    const number = value[key];
    if (typeof number === "number" && Number.isSafeInteger(number) && number >= 0) {
      details[key] = number;
    }
  }
  for (const key of [
    "wakeAccepted", "wakePending", "wakeIdentityChecked", "wakeAbsent",
    "wakeMismatch", "wakeSignalAborted", "wakeActivePointerPresent",
  ] as const) {
    if (typeof value[key] === "boolean") details[key] = value[key];
  }
  if (["admission", "dispatch", "drain", "acknowledgement", "legacy_health", "exiting_owner"]
    .some((stage) => stage === value.wakeStage)) {
    details.wakeStage = String(value.wakeStage);
  }
}
