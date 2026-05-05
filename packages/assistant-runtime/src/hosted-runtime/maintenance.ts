import { createConfiguredDeviceSyncProvidersFromConfigs } from "@murphai/device-syncd/config";
import type { ConfiguredDeviceSyncProviderConfigs } from "@murphai/device-syncd/config";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/registry";
import { sanitizeHostedRuntimeErrorText } from "@murphai/device-syncd/hosted-runtime";
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
  HostedRuntimePlatform,
} from "./platform.ts";
import {
  createHostedAssistantInputSource,
} from "./turn-input.ts";
import {
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
import { emitHostedAssistantProviderTraceLog } from "./events.ts";
import {
  closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService,
} from "../device-sync-service.ts";

const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_ASSISTANT_AUTOMATION_REDACTED_EVENT_LOG_LIMIT = 12;
const HOSTED_DEVICE_SYNC_FAILURE_SUMMARY_MAX_LENGTH = 2048;

interface HostedAssistantAutomationReadiness {
  activeProfileId: string | null;
  activeProfileManagedBy: "member" | "platform" | null;
  activeProfileReady: boolean;
  configInvalid: boolean;
  configPresent: boolean;
  configStatus: "hosted-env" | "invalid" | "missing" | "saved" | "unready";
  configured: boolean;
  provider: "codex-cli" | null;
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
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig"
  >;
  signal?: AbortSignal;
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

  const deviceSyncResult = await runHostedDeviceSyncPass(
    input.wake,
    input.vaultRoot,
    input.runtime.resolvedConfig.deviceSync,
    input.runtime.platform.deviceSyncPort,
    input.runtime.commitTimeoutMs,
    {
      runtimeLogPlatform: input.runtime.platform,
    },
  );

  const assistantResult = assistantAutomation.shouldRun
    ? await runHostedAssistantAutomation(
        input.vaultRoot,
        input.requestId,
        input.executionContext,
        input.wake,
        input.runtime,
        input.signal,
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
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: earliestHostedMaintenanceWakeAt(
      nextWakeAt,
      earliestHostedMaintenanceWakeAt(
        deviceSyncResult.nextWakeAt,
        deviceSyncResult.postCheckpointRecord?.nextWakeAt ?? null,
      ),
    ),
    parserProcessed: 0,
    postCheckpointRecord: deviceSyncResult.postCheckpointRecord ?? null,
    ...(redactedLogEntries.length === 0 ? {} : { redactedLogEntries }),
  };
}

export async function runHostedAssistantAutomation(
  vaultRoot: string,
  requestId: string,
  executionContext: AssistantExecutionContext,
  wake: HostedRuntimeEvent,
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv">,
  signal?: AbortSignal,
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
  const inputSource = createHostedAssistantInputSource({
    requestId,
    runtime,
    vaultRoot,
    wake,
  });
  const beforeState = await readAssistantAutomationState(vaultRoot);
  redactedLogEntries.push(emitHostedRuntimeRedactedLog({
    component: "runtime",
    details: {
      autoReplyChannels: beforeState.autoReply.map((entry) => entry.channel).join(","),
      autoReplyEligibleAfterSummary: beforeState.autoReply.map((entry) =>
        `${entry.channel}:${entry.eligibleAfter?.inputId ?? "null"}`
      ).join(","),
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
      signal,
      inputSource,
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
        ...buildHostedAssistantAutomationEventCountLogDetails(automationEventCounts),
        autoReplyChannels: afterState.autoReply.map((entry) => entry.channel).join(","),
        autoReplyEligibleAfterSummary: afterState.autoReply.map((entry) =>
          `${entry.channel}:${entry.eligibleAfter?.inputId ?? "null"}`
        ).join(","),
        cronProcessed: result.cronProcessed,
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
      const nextWakeAt = new Date(Date.now() + 30_000).toISOString();
      redactedLogEntries.push(emitHostedRuntimeRedactedLog({
        component: "runtime",
        details: {
          nextWakeAt,
          requestId,
        },
        wake,
        message: "Hosted assistant automation could not run because the inbox runtime is not initialized yet; scheduling a retry.",
        phase: "wake.running",
      }));
      return {
        nextWakeAt,
        progressed: true,
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

function buildHostedAssistantAutomationEventCountLogDetails(
  counts: ReadonlyMap<string, number>,
): Record<string, number | string> {
  const details: Record<string, number | string> = {};
  let index = 0;
  for (const [eventType, count] of [...counts.entries()].slice(0, 8)) {
    details[`automationEventType${index}`] = eventType;
    details[`automationEventCount${index}`] = count;
    index += 1;
  }
  details.automationEventTypeCount = counts.size;
  return details;
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
    errorCode: event.errorCode ?? null,
    failureFieldsPresent: event.failureContext !== undefined,
    ...prefixHostedAssistantAutomationFailureContext(event.failureContext),
    inputIdPresent: "inputId" in event ? event.inputId != null : false,
    providerKind: event.providerKind ?? null,
    providerState: event.providerState ?? null,
    requestId,
    safeDetails: event.safeDetails ?? null,
    safeErrorLength: event.safeErrorMessage?.length ?? null,
    safeErrorMessage: event.safeErrorMessage ?? null,
    safeErrorPresent: event.safeErrorMessage !== undefined,
    toolCount: event.tools?.length ?? null,
    type: event.type,
  };
}

function prefixHostedAssistantAutomationFailureContext(
  context: AssistantRunEvent["failureContext"] | undefined,
): Record<string, boolean | number | string | null> {
  if (!context) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      `failure${key.charAt(0).toUpperCase()}${key.slice(1)}`,
      value,
    ]),
  );
}

function shouldPersistHostedAssistantAutomationEvent(type: string): boolean {
  return new Set([
    "capture.failed",
    "cron.job.completed",
    "cron.scan.job",
    "cron.scan.started",
    "input.replied",
    "input.reply-failed",
    "input.reply-skipped",
    "input.reply-started",
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
  options: {
    runtimeLogPlatform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  } = {},
): Promise<{
  nextWakeAt: string | null;
  postCheckpointRecord: HostedMaintenanceMetrics["postCheckpointRecord"];
  processedJobs: number;
  skipped: boolean;
}> {
  const service = createHostedDeviceSyncRuntime({
    deviceSyncConfig,
    vaultRoot,
  });

  if (!service) {
    return {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    };
  }

  const secret = deviceSyncConfig?.secret ?? null;
  let syncState: HostedDeviceSyncRuntimeSyncState = {
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    pendingDirtyAck: null,
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
    await writeHostedDeviceSyncJobFailureRuntimeLogs({
      platform: options.runtimeLogPlatform ?? null,
      processedJobs,
      service,
      state: syncState,
      wake,
    });

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

    const postCheckpointRecord = resolveHostedDeviceSyncDirtyPostCheckpointRecord({
      state: syncState,
    });

    return {
      nextWakeAt: service.getNextWakeAt(),
      postCheckpointRecord,
      processedJobs,
      skipped: false,
    };
  } finally {
    closeHostedRuntimeDeviceSyncService(service);
  }
}

export async function runHostedDeviceSyncWakeLane(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  runtimeLogPlatform?: Pick<HostedRuntimePlatform, "logPort"> | null;
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
    {
      runtimeLogPlatform: input.runtimeLogPlatform ?? null,
    },
  );

  return {
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: earliestHostedMaintenanceWakeAt(
      deviceSyncResult.nextWakeAt,
      deviceSyncResult.postCheckpointRecord?.nextWakeAt ?? null,
    ),
    parserProcessed: 0,
    postCheckpointRecord: deviceSyncResult.postCheckpointRecord ?? null,
  };
}

export function runHostedNoopSystemWakeLane(): HostedMaintenanceMetrics {
  return {
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
    postCheckpointRecord: null,
  };
}

function resolveHostedDeviceSyncDirtyPostCheckpointRecord(input: {
  state: HostedDeviceSyncRuntimeSyncState;
}): HostedMaintenanceMetrics["postCheckpointRecord"] {
  const pendingDirtyAck = input.state.pendingDirtyAck;
  if (!pendingDirtyAck) {
    return null;
  }

  return {
    connectionId: pendingDirtyAck.connectionId,
    kind: "device-sync.dirty-processed",
    nextWakeAt: pendingDirtyAck.nextWakeAt,
    processedRevision: pendingDirtyAck.processedRevision,
  };
}

function earliestHostedMaintenanceWakeAt(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return Date.parse(left) <= Date.parse(right) ? left : right;
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

async function writeHostedDeviceSyncJobFailureRuntimeLogs(input: {
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
  service: HostedDeviceSyncRuntimeService;
  state: HostedDeviceSyncRuntimeSyncState;
  wake: HostedRuntimeEvent;
}): Promise<void> {
  if (!input.platform?.logPort || input.processedJobs === 0 || !input.state.snapshot) {
    return;
  }

  const baselineByHostedConnectionId = new Map(
    input.state.snapshot.connections.map((entry) => [entry.connection.id, entry]),
  );

  for (const account of input.service.listAccounts()) {
    const hostedConnectionId = input.state.localToHostedAccountIds.get(account.id) ?? null;
    if (!hostedConnectionId) {
      continue;
    }

    const baseline = baselineByHostedConnectionId.get(hostedConnectionId) ?? null;

    if (!account.lastSyncErrorAt || baseline?.localState.lastSyncErrorAt === account.lastSyncErrorAt) {
      continue;
    }

    await writeHostedRuntimeLogBestEffort({
      entry: {
        at: account.lastSyncErrorAt,
        component: "device-sync",
        errorCode: toHostedRuntimeLogCode(account.lastErrorCode),
        eventCode: "device-sync.job_failed",
        level: "warn",
        phase: "invoke",
        redactedJson: buildHostedDeviceSyncFailureLogRedactedJson({
          account,
          baseline,
          hostedConnectionKnown: Boolean(hostedConnectionId),
          processedJobs: input.processedJobs,
          wake: input.wake,
        }),
      },
      platform: input.platform,
    });
  }
}

type HostedDeviceSyncRuntimeService = NonNullable<ReturnType<typeof createHostedDeviceSyncRuntime>>;
type HostedDeviceSyncRuntimeSnapshotEntry = NonNullable<HostedDeviceSyncRuntimeSyncState["snapshot"]>["connections"][number];

function buildHostedDeviceSyncFailureLogRedactedJson(input: {
  account: ReturnType<HostedDeviceSyncRuntimeService["listAccounts"]>[number];
  baseline: HostedDeviceSyncRuntimeSnapshotEntry | null;
  hostedConnectionKnown: boolean;
  processedJobs: number;
  wake: HostedRuntimeEvent;
}): Record<string, boolean | number | string | null> {
  const summary = sanitizeHostedDeviceSyncFailureSummary(input.account.lastErrorMessage);
  const priorLocalState = input.baseline?.localState ?? null;

  return {
    failureCode: toHostedRuntimeLogCode(input.account.lastErrorCode),
    ...(summary ? { failureSummary: summary } : {}),
    hadPriorFailure: Boolean(priorLocalState?.lastSyncErrorAt),
    hadPriorSuccess: Boolean(priorLocalState?.lastSyncCompletedAt),
    hostedConnectionKnown: input.hostedConnectionKnown,
    nextReconcileAt: input.account.nextReconcileAt,
    processedJobs: input.processedJobs,
    provider: toHostedRuntimeLogCode(input.account.provider),
    setupPhase: input.account.setupPhase ?? null,
    status: toHostedRuntimeLogCode(input.account.status),
    syncCompletedAt: input.account.lastSyncCompletedAt,
    syncFailedAt: input.account.lastSyncErrorAt,
    syncStartedAt: input.account.lastSyncStartedAt,
    wakeKind: toHostedRuntimeLogCode(input.wake.kind),
    wakeReason: "reason" in input.wake
      ? toHostedRuntimeLogCode(input.wake.reason)
      : "runtime_timer",
  };
}

function sanitizeHostedDeviceSyncFailureSummary(value: string | null): string | null {
  const sanitized = sanitizeHostedRuntimeErrorText(value);

  if (!sanitized) {
    return null;
  }

  const redacted = sanitized
    .replace(/\bfile:\/\/[^\s)"']+/giu, "<redacted-path>")
    .replace(/(^|[\s(])\/[^\s)]+/gu, "$1<redacted-path>")
    .replace(/[A-Za-z]:\\[^\s)"']+/gu, "<redacted-path>")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "<redacted-email>")
    .replace(/\+\d[\d().\s-]{7,}\d/gu, "<redacted-phone>")
    .replace(
      /\b(?:authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session(?:[_-]?(?:token|id))?|cookie|set-cookie|password)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/giu,
      "<redacted-secret>",
    )
    .trim();

  const bounded = redacted.length <= HOSTED_DEVICE_SYNC_FAILURE_SUMMARY_MAX_LENGTH
    ? redacted
    : `${redacted.slice(0, HOSTED_DEVICE_SYNC_FAILURE_SUMMARY_MAX_LENGTH - 3).trimEnd()}...`;

  return isHostedDeviceSyncSafeRuntimeLogSummary(bounded)
    ? bounded
    : "[redacted]";
}

function isHostedDeviceSyncSafeRuntimeLogSummary(value: string): boolean {
  return value.length > 0
    && value.length <= HOSTED_DEVICE_SYNC_FAILURE_SUMMARY_MAX_LENGTH
    && !(
      /\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s(])\/[^\s)]+/u.test(value)
      || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
      || /\+\d[\d().\s-]{7,}\d/u.test(value)
      || /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/iu
        .test(value)
      || /\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/iu.test(value)
      || /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/iu.test(value)
      || /\bwhsec_[A-Z0-9]+\b/iu.test(value)
    );
}

function createHostedDeviceSyncRuntime(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  vaultRoot: string;
}) {
  if (!input.deviceSyncConfig) {
    return null;
  }

  const registry = createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(
      resolveHostedRuntimeDeviceSyncProviderConfigs(input.deviceSyncConfig.providerConfigs),
    ),
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

function resolveHostedRuntimeDeviceSyncProviderConfigs(
  providerConfigs: HostedAssistantRuntimeDeviceSyncConfig["providerConfigs"],
): ConfiguredDeviceSyncProviderConfigs {
  const runtimeProviderConfigs: ConfiguredDeviceSyncProviderConfigs = {};

  // Junction provider-config credentials require provider-owned API/HMAC
  // secrets. The resolved hosted config is serializable, so Junction must be
  // hydrated through an explicit runtime secret channel before provider
  // instantiation instead of being reconstructed from this envelope.

  if (providerConfigs.oura) {
    runtimeProviderConfigs.oura = providerConfigs.oura;
  }

  if (providerConfigs.whoop) {
    runtimeProviderConfigs.whoop = providerConfigs.whoop;
  }

  if (providerConfigs.strava) {
    runtimeProviderConfigs.strava = providerConfigs.strava;
  }

  return runtimeProviderConfigs;
}
