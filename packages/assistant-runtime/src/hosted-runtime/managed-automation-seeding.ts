import {
  applyMurphManagedAutomations,
  getAssistantCronStatus,
} from "@murphai/assistant-engine";
import type {
  AutomationRoute,
} from "@murphai/contracts";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  sanitizeHostedExecutionStructuredLogText,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeLogEntry,
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";
import {
  buildHostedRuntimeLogContextFields,
  toHostedRuntimeLogCode,
  type HostedRuntimeLogContext,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import { normalizeHostedFutureWakeAt } from "./wake-time.ts";

const HOSTED_ASSISTANT_CRON_STATUS_RETRY_DELAY_MS = 30_000;

export interface HostedManagedAutomationSeedResult {
  checkpointReason: "assistant_runtime_commit";
  progressed: true;
  redactedStatus: HostedRuntimeRedactedJson;
}

export async function seedHostedManagedAutomationsBestEffort(input: {
  defaultRoute?: AutomationRoute | null;
  nowMs: number;
  operatorHomeRoot: string | null;
  runtimeEnv: Readonly<Record<string, string>>;
  runtimeLog?: {
    context?: HostedRuntimeLogContext | null;
    platform: Pick<HostedRuntimePlatform, "logPort">;
  } | null;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  vaultRoot: string;
}): Promise<HostedManagedAutomationSeedResult | null> {
  if (input.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  try {
    const result = await applyMurphManagedAutomations({
      now: new Date(input.nowMs),
      operatorHomeRoot: input.operatorHomeRoot,
      ...(input.defaultRoute !== undefined
        ? { defaultRoute: input.defaultRoute }
        : {}),
      routeValidationProfile: "hosted",
      runtimeEnv: input.runtimeEnv,
      vaultRoot: input.vaultRoot,
    });
    const changed = result.created + result.updated;
    if (changed === 0) {
      return null;
    }

    await writeHostedManagedAutomationSeedLog({
      eventCode: "assistant.pass_finished",
      level: "info",
      redactedJson: {
        murphManagedAutomationCreated: result.created,
        murphManagedAutomationSkipped: result.skipped,
        murphManagedAutomationUpdated: result.updated,
      },
      runtimeLog: input.runtimeLog ?? null,
    });

    return {
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: {
        murphManagedAutomationCreated: result.created,
        murphManagedAutomationSkipped: result.skipped,
        murphManagedAutomationUpdated: result.updated,
      },
    };
  } catch (error) {
    const failure = buildHostedManagedAutomationFailureDiagnostics(
      error,
      "Hosted managed automation setup failed.",
    );
    await writeHostedManagedAutomationSeedLog({
      errorCode: failure.errorCode,
      eventCode: "runner.error",
      level: "warn",
      phase: "error",
      redactedJson: {
        ...failure.redactedJson,
        murphManagedAutomationFailed: true,
      },
      runtimeLog: input.runtimeLog ?? null,
    });
    return null;
  }
}

export async function resolveHostedManagedAutomationSeedNextWakeAt(input: {
  nowMs: number;
  vaultRoot: string;
}): Promise<string | null> {
  try {
    const cronStatus = await getAssistantCronStatus(input.vaultRoot);
    if (cronStatus.dueJobs > 0) {
      return new Date(input.nowMs).toISOString();
    }
    return normalizeHostedFutureWakeAt(cronStatus.nextRunAt, input.nowMs);
  } catch {
    return new Date(input.nowMs + HOSTED_ASSISTANT_CRON_STATUS_RETRY_DELAY_MS).toISOString();
  }
}

function buildHostedManagedAutomationFailureDiagnostics(
  error: unknown,
  fallbackMessage: string,
): {
  errorCode: string;
  redactedJson: HostedRuntimeRedactedJson;
} {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  const diagnosticErrorCode = typeof diagnostics?.errorCode === "string"
    ? diagnostics.errorCode
    : null;
  const diagnosticErrorMessage = typeof diagnostics?.errorMessage === "string"
    ? diagnostics.errorMessage
    : null;
  const errorCode = toHostedRuntimeLogCode(
    diagnosticErrorCode ?? deriveHostedExecutionErrorCode(error),
  );
  const safeErrorMessage = sanitizeHostedExecutionStructuredLogText(
    diagnosticErrorMessage ?? fallbackMessage,
  ) ?? fallbackMessage;

  return {
    errorCode,
    redactedJson: {
      errorCode,
      safeErrorMessage,
    },
  };
}

async function writeHostedManagedAutomationSeedLog(input: {
  errorCode?: string | null;
  eventCode: HostedRuntimeLogEntry["eventCode"];
  level: "info" | "warn";
  phase?: "error" | "invoke";
  redactedJson: HostedRuntimeRedactedJson;
  runtimeLog: {
    context?: HostedRuntimeLogContext | null;
    platform: Pick<HostedRuntimePlatform, "logPort">;
  } | null;
}): Promise<void> {
  if (!input.runtimeLog) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.runtimeLog.context ?? null),
      component: "runtime",
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      eventCode: input.eventCode,
      level: input.level,
      phase: input.phase ?? "invoke",
      redactedJson: input.redactedJson,
    },
    platform: input.runtimeLog.platform,
  });
}
