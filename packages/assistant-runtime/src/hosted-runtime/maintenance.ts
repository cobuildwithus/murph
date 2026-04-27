import { createConfiguredDeviceSyncProvidersFromConfigs } from "@murphai/device-syncd/config";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/registry";
import {
  type AssistantExecutionContext,
  type AssistantRunEvent,
  readAssistantAutomationState,
  runAssistantAutomationPass,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";

import type {
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedMaintenanceMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncRuntimeSyncState,
} from "../hosted-device-sync-runtime.ts";
import { readHostedAssistantRuntimeState } from "./context.ts";
import type {
  HostedExecutionRedactedLogEntry,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeDeviceSyncPort,
} from "./platform.ts";
import { createHostedAssistantTurnInputPort } from "./turn-input.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
import { emitHostedAssistantProviderTraceLog } from "./events.ts";
import {
  closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService,
} from "../device-sync-service.ts";

const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_ASSISTANT_AUTOMATION_REDACTED_EVENT_LOG_LIMIT = 12;

interface HostedAssistantAutomationReadiness {
  activeProfileId: string | null;
  activeProfileManagedBy: "member" | "platform" | null;
  activeProfileReady: boolean;
  configInvalid: boolean;
  configPresent: boolean;
  configStatus: "hosted-env" | "invalid" | "missing" | "saved" | "unready";
  configured: boolean;
  provider: "openai-compatible" | null;
  shouldRun: boolean;
}

async function resolveHostedAssistantAutomationReadiness(input: {
  skipAssistantAutomation: boolean;
}): Promise<HostedAssistantAutomationReadiness> {
  const assistantState = await readHostedAssistantRuntimeState();

  return {
    activeProfileId: assistantState.assistantActiveProfileId,
    activeProfileManagedBy: assistantState.assistantActiveProfileManagedBy,
    activeProfileReady: assistantState.assistantActiveProfileReady,
    configInvalid: assistantState.assistantConfigInvalid,
    configPresent: assistantState.assistantConfigPresent,
    configStatus: assistantState.assistantConfigStatus,
    configured: assistantState.assistantConfigured,
    provider: assistantState.assistantProvider,
    shouldRun: assistantState.assistantConfigured && !input.skipAssistantAutomation,
  };
}

function reportHostedAssistantAutomationSkipped(
  wake: HostedRuntimeEvent,
  readiness: HostedAssistantAutomationReadiness,
): HostedExecutionRedactedLogEntry {
  return emitHostedRuntimeRedactedLog({
    component: "runtime",
    details: {
      activeProfileId: readiness.activeProfileId,
      activeProfileManagedBy: readiness.activeProfileManagedBy,
      activeProfileReady: readiness.activeProfileReady,
      assistantConfigured: readiness.configured,
      configInvalid: readiness.configInvalid,
      configPresent: readiness.configPresent,
      configStatus: readiness.configStatus,
      provider: readiness.provider,
    },
    wake,
    level: "warn",
    message:
      readiness.configStatus === "invalid"
        ? "Hosted assistant automation skipped because the saved hosted assistant config is invalid."
        : readiness.configStatus === "missing"
          ? "Hosted assistant automation skipped because no explicit hosted assistant profile is configured."
          : readiness.provider
            ? `Hosted assistant automation skipped because the active hosted assistant profile (${readiness.provider}) is not ready.`
            : "Hosted assistant automation skipped because the hosted assistant config is not ready.",
    phase: "wake.running",
  });
}

export async function runHostedAssistantRuntimeTimerLane(input: {
  wake: HostedRuntimeEvent;
  executionContext: AssistantExecutionContext;
  requestId: string;
  runtime?: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv">;
  skipAssistantAutomation?: boolean;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const assistantAutomation = await resolveHostedAssistantAutomationReadiness({
    skipAssistantAutomation: input.skipAssistantAutomation ?? false,
  });
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [];

  if (!assistantAutomation.configured) {
    redactedLogEntries.push(
      reportHostedAssistantAutomationSkipped(input.wake, assistantAutomation),
    );
  }

  const assistantResult = assistantAutomation.shouldRun
    ? await runHostedAssistantAutomation(
        input.vaultRoot,
        input.requestId,
        input.executionContext,
        input.wake,
        input.runtime,
      )
    : {
        nextWakeAt: null,
        progressed: false,
        redactedLogEntries: [],
      };
  const nextWakeAt = assistantResult.nextWakeAt
    ?? (assistantResult.progressed ? new Date().toISOString() : null);
  redactedLogEntries.push(...assistantResult.redactedLogEntries);

  return {
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt,
    parserProcessed: 0,
    ...(redactedLogEntries.length === 0 ? {} : { redactedLogEntries }),
  };
}

export async function runHostedAssistantAutomation(
  vaultRoot: string,
  requestId: string,
  executionContext: AssistantExecutionContext,
  wake: HostedRuntimeEvent,
  runtime?: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv">,
): Promise<{
  nextWakeAt: string | null;
  progressed: boolean;
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
}> {
  const inboxServices = createIntegratedInboxServices();
  const vaultServices = createIntegratedVaultServices();
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [];
  const automationEventCounts = new Map<string, number>();
  let redactedAutomationEventLogCount = 0;
  const turnInputPort = runtime
    ? createHostedAssistantTurnInputPort({
        inboxServices,
        requestId,
        runtime,
        vaultRoot,
        wake,
      })
    : undefined;
  const beforeState = await readAssistantAutomationState(vaultRoot);
  redactedLogEntries.push(emitHostedRuntimeRedactedLog({
    component: "runtime",
    details: {
      autoReplyChannels: beforeState.autoReply.map((entry) => entry.channel).join(","),
      autoReplyCursorSummary: beforeState.autoReply.map((entry) =>
        `${entry.channel}:${entry.cursor?.captureId ?? "null"}`
      ).join(","),
      inboxScanCursor: beforeState.inboxScanCursor?.captureId ?? null,
      requestId,
    },
    wake,
    message: "Hosted assistant automation pass starting.",
    phase: "wake.running",
  }));

  try {
    const result = await runAssistantAutomationPass({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      executionContext,
      inboxServices,
      onEvent: (event) => {
        automationEventCounts.set(
          event.type,
          (automationEventCounts.get(event.type) ?? 0) + 1,
        );
        const logEntry = emitHostedRuntimeRedactedLog({
          component: "runtime",
          details: buildHostedAssistantAutomationEventLogDetails(event, requestId),
          wake,
          message: `Hosted assistant automation event: ${event.type}.`,
          phase: "wake.running",
        });
        if (
          shouldPersistHostedAssistantAutomationEvent(event.type)
          && redactedAutomationEventLogCount < HOSTED_ASSISTANT_AUTOMATION_REDACTED_EVENT_LOG_LIMIT
        ) {
          redactedLogEntries.push(logEntry);
          redactedAutomationEventLogCount += 1;
        }
      },
      onTraceEvent: (event) => {
        const contextEntry = emitHostedAssistantContextTraceLog({
          event,
          wake,
        });
        if (contextEntry) {
          redactedLogEntries.push(contextEntry);
        }
        const providerEntry = emitHostedAssistantProviderTraceLog({
          details: {
            requestId,
          },
          event,
          wake,
        });
        if (providerEntry) {
          redactedLogEntries.push(providerEntry);
        }
      },
      vaultServices,
      requestId,
      ...(turnInputPort ? { turnInputPort } : {}),
      vault: vaultRoot,
    });
    const afterState = await readAssistantAutomationState(vaultRoot);
    const replies = result.replies ?? {
      considered: 0,
      failed: 0,
      replied: 0,
      skipped: 0,
    };
    const routing = result.routing ?? {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    };
    redactedLogEntries.push(emitHostedRuntimeRedactedLog({
      component: "runtime",
      details: {
        automationEventCounts: Object.fromEntries(automationEventCounts),
        autoReplyChannels: afterState.autoReply.map((entry) => entry.channel).join(","),
        autoReplyCursorSummary: afterState.autoReply.map((entry) =>
          `${entry.channel}:${entry.cursor?.captureId ?? "null"}`
        ).join(","),
        cronProcessed: result.cronProcessed,
        inboxScanCursor: afterState.inboxScanCursor?.captureId ?? null,
        nextWakeAt: result.nextWakeAt,
        outboxAttempted: result.outboxAttempted,
        progressed: result.progressed,
        requestId,
        replyConsidered: replies.considered,
        replyFailed: replies.failed,
        replyReplied: replies.replied,
        replySkipped: replies.skipped,
        routingConsidered: routing.considered,
        routingFailed: routing.failed,
        routingNoAction: routing.noAction,
        routingRouted: routing.routed,
        routingSkipped: routing.skipped,
      },
      wake,
      message: "Hosted assistant automation pass finished.",
      phase: "wake.running",
    }));
    return {
      nextWakeAt: result.nextWakeAt,
      progressed: result.progressed,
      redactedLogEntries,
    };
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "INBOX_NOT_INITIALIZED"
    ) {
      redactedLogEntries.push(emitHostedRuntimeRedactedLog({
        component: "runtime",
        details: {
          requestId,
        },
        wake,
        message: "Hosted assistant automation skipped because the inbox runtime is not initialized yet.",
        phase: "wake.running",
      }));
      return {
        nextWakeAt: null,
        progressed: false,
        redactedLogEntries,
      };
    }

    emitHostedRuntimeRedactedLog({
      component: "runtime",
      details: {
        requestId,
      },
      error,
      level: "error",
      wake,
      message: "Hosted assistant automation pass failed.",
      phase: "failed",
    });
    throw error;
  }
}

function emitHostedRuntimeRedactedLog(
  input: Parameters<typeof emitHostedExecutionStructuredLog>[0],
): HostedExecutionRedactedLogEntry {
  const record = emitHostedExecutionStructuredLog(input) as
    | ReturnType<typeof emitHostedExecutionStructuredLog>
    | undefined;

  return {
    component: record?.component ?? input.component,
    eventId: record?.eventId ?? input.wake?.eventId ?? input.eventId ?? null,
    level: record?.level ?? input.level ?? (input.error === undefined ? "info" : "error"),
    message: record?.message ?? input.message,
    phase: record?.phase ?? input.phase,
    ...((record?.details ?? input.details) ? { redacted: record?.details ?? input.details } : {}),
  };
}

function buildHostedAssistantAutomationEventLogDetails(
  event: AssistantRunEvent,
  requestId: string,
): Record<string, boolean | number | string | null> {
  return {
    captureIdPresent: "captureId" in event ? event.captureId != null : false,
    details: event.details ?? null,
    errorCode: event.errorCode ?? null,
    providerKind: event.providerKind ?? null,
    providerState: event.providerState ?? null,
    requestId,
    safeDetails: event.safeDetails ?? null,
    toolCount: event.tools?.length ?? null,
    type: event.type,
  };
}

function shouldPersistHostedAssistantAutomationEvent(type: string): boolean {
  return new Set([
    "capture.failed",
    "capture.replied",
    "capture.reply-failed",
    "capture.reply-skipped",
    "capture.reply-started",
    "reply.scan.started",
    "scan.started",
  ]).has(type);
}

export async function runHostedDeviceSyncPass(
  wake: HostedRuntimeEvent,
  vaultRoot: string,
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null,
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined,
  timeoutMs: number | null,
): Promise<{ nextWakeAt: string | null; processedJobs: number; skipped: boolean }> {
  const service = createHostedDeviceSyncRuntime({
    deviceSyncConfig,
    vaultRoot,
  });

  if (!service) {
    return {
      nextWakeAt: null,
      processedJobs: 0,
      skipped: true,
    };
  }

  const secret = deviceSyncConfig?.secret ?? null;
  let syncState: HostedDeviceSyncRuntimeSyncState = {
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    snapshot: null,
  };
  let controlPlaneSynced = false;
  const failHardOnControlPlaneError = wake.kind === "device-sync.wake";

  try {
    if (secret) {
      try {
        syncState = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          wake,
          secret,
          service,
        });
        controlPlaneSynced = true;
      } catch (error) {
        if (failHardOnControlPlaneError) {
          throw error;
        }

        reportHostedDeviceSyncControlPlaneFailure("sync", wake, error);
      }
    }

    await service.runSchedulerOnce();
    const processedJobs = await service.drainWorker(HOSTED_MAX_DEVICE_SYNC_JOBS);

    if (secret && controlPlaneSynced) {
      try {
        await reconcileHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          wake,
          secret,
          service,
          state: syncState,
        });
      } catch (error) {
        if (failHardOnControlPlaneError) {
          throw error;
        }

        reportHostedDeviceSyncControlPlaneFailure("reconcile", wake, error);
      }
    }

    return {
      nextWakeAt: service.getNextWakeAt(),
      processedJobs,
      skipped: false,
    };
  } finally {
    closeHostedRuntimeDeviceSyncService(service);
  }
}

export async function runHostedDeviceSyncWakeLane(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  wake: HostedRuntimeEvent;
  resolvedConfig: {
    deviceSync: HostedAssistantRuntimeDeviceSyncConfig | null;
  };
  timeoutMs: number | null;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const deviceSyncResult = await runHostedDeviceSyncPass(
    input.wake,
    input.vaultRoot,
    input.resolvedConfig.deviceSync,
    input.deviceSyncPort,
    input.timeoutMs,
  );

  return {
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: deviceSyncResult.nextWakeAt,
    parserProcessed: 0,
  };
}

export function runHostedNoopSystemWakeLane(): HostedMaintenanceMetrics {
  return {
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
  };
}

function reportHostedDeviceSyncControlPlaneFailure(
  phase: "reconcile" | "sync",
  wake: HostedRuntimeEvent,
  error: unknown,
): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake,
    error,
    level: "warn",
    message: `Hosted device-sync control-plane ${phase} failed; continuing hosted job.`,
    phase: "wake.running",
  });
}

function createHostedDeviceSyncRuntime(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  vaultRoot: string;
}) {
  if (!input.deviceSyncConfig) {
    return null;
  }

  const registry = createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(input.deviceSyncConfig.providerConfigs),
  );

  if (registry.list().length === 0) {
    return null;
  }

  return createHostedRuntimeDeviceSyncService({
    secret: input.deviceSyncConfig.secret,
    config: {
      publicBaseUrl: input.deviceSyncConfig.publicBaseUrl,
      vaultRoot: input.vaultRoot,
    },
    registry,
  });
}
