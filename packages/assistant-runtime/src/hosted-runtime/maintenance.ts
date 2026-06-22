import {
  createConfiguredDeviceSyncProvidersFromConfigs,
  readConfiguredJunctionDeviceSyncProviderConfig,
} from "@murphai/device-syncd/config";
import type { ConfiguredDeviceSyncProviderConfigs } from "@murphai/device-syncd/config";
import type { DeviceSyncJobFailureDiagnostic } from "@murphai/device-syncd/types";
import type { DeviceSyncService } from "@murphai/device-syncd/service";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/registry";
import { sanitizeHostedRuntimeErrorText } from "@murphai/device-syncd/hosted-runtime";
import {
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  type AssistantExecutionContext,
  type AssistantInputCandidateBatch,
  type AssistantInputCandidateQuery,
  type AssistantInputSource,
  type AssistantRunEvent,
  type AssistantTurnEnvironment,
  type AssistantTurnConversationInputQuery,
  readAssistantAutomationState,
  runAssistantAutomationPass,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import {
  pruneWearableDenseRawTimeseries,
} from "@murphai/core";

import type {
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedAssistantAutomationLaneMetrics,
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedMaintenanceMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncRuntimeSyncState,
} from "../hosted-device-sync-runtime.ts";
import {
  readHostedAssistantRuntimeState,
  type HostedAssistantRuntimeReadinessState,
} from "./context.ts";
import type {
  HostedExecutionRedactedLogEntry,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeDeviceSyncPort,
  HostedRuntimePlatform,
} from "./platform.ts";
import {
  createHostedAssistantInputSource,
  selectHostedAssistantInputIds,
} from "./turn-input.ts";
import {
  createHostedAssistantTurnEnvironment,
} from "./environment.ts";
import { emitHostedAssistantProviderTraceLog } from "./events/provider-trace-log.ts";
import {
  summarizeHostedAssistantAutoReplyEligibleAfter,
  summarizeHostedRuntimeStatusCounts,
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
import {
  closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService,
} from "../device-sync-service.ts";
import { normalizeHostedFutureWakeAt } from "./wake-time.ts";
import {
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

const HOSTED_ASSISTANT_BACKGROUND_AUTOMATION_SCAN_LIMIT = 1;

const HOSTED_MAX_DEVICE_SYNC_JOBS = 100;
const HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS = 30_000;
const HOSTED_ASSISTANT_AUTOMATION_REDACTED_EVENT_LOG_LIMIT = 12;
const HOSTED_ASSISTANT_INPUT_QUERY_REDACTED_LOG_LIMIT = 20;
const HOSTED_DEVICE_SYNC_FAILURE_SUMMARY_MAX_LENGTH = 2048;
const HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_FILES = 25;
const HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_BYTES = 512 * 1024 * 1024;
const HOSTED_RUNTIME_JUNCTION_PLATFORM_ENV_KEYS = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_ENV",
  "JUNCTION_REGION",
] as const;

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
  assistantRuntimeState?: HostedAssistantRuntimeReadinessState | null;
  operatorHomeRoot?: string | null;
  skipAssistantAutomation: boolean;
}): Promise<HostedAssistantAutomationReadiness> {
  const assistantState = input.assistantRuntimeState
    ?? await readHostedAssistantRuntimeState({
      homeDirectory: input.operatorHomeRoot ?? undefined,
    });

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

export async function runHostedAssistantAutomationLane(input: {
  wake: HostedRuntimeEvent;
  executionContext: AssistantExecutionContext;
  requestId: string;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig"
  >;
  freshAssistantInputIds?: readonly string[] | null;
  operatorHomeRoot?: string | null;
  runtimeAttemptId?: string | null;
  assistantRuntimeState?: HostedAssistantRuntimeReadinessState | null;
  runtimeEnv?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  skipAssistantAutomation?: boolean;
  vaultRoot: string;
}): Promise<HostedAssistantAutomationLaneMetrics> {
  const startedAt = Date.now();
  const readinessStartedAt = Date.now();
  const assistantAutomation = await resolveHostedAssistantAutomationReadiness({
    assistantRuntimeState: input.assistantRuntimeState ?? null,
    operatorHomeRoot: input.operatorHomeRoot ?? null,
    skipAssistantAutomation: input.skipAssistantAutomation ?? false,
  });
  const readinessElapsedMs = elapsedSince(readinessStartedAt);
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [];

  if (!assistantAutomation.configured) {
    redactedLogEntries.push(
      reportHostedAssistantAutomationSkipped(input.wake, assistantAutomation),
    );
  }

  const assistantStartedAt = Date.now();
  const assistantResult = assistantAutomation.shouldRun
    ? await runHostedAssistantAutomation(
        input.vaultRoot,
        input.requestId,
        input.executionContext,
        input.wake,
        input.freshAssistantInputIds ?? [],
        input.signal,
        createHostedAssistantTurnEnvironment({
          operatorHomeRoot: input.operatorHomeRoot ?? null,
          runtimeEnv: input.runtimeEnv ?? {},
          vaultRoot: input.vaultRoot,
        }),
        {
          latencyTracePort: input.runtime.platform.latencyTracePort ?? null,
          runtimeAttemptId: input.runtimeAttemptId ?? null,
        },
      )
    : {
        currentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        progressed: false,
        redactedLogEntries: [],
        replyFailed: 0,
        timings: undefined,
      };
  const assistantAutomationElapsedMs = elapsedSince(assistantStartedAt);
  redactedLogEntries.push(...assistantResult.redactedLogEntries);

  return {
    activeTurnInputIngested:
      assistantResult.timings?.activeTurnInputIngested ?? false,
    assistantAutomationAfterStateElapsedMs:
      assistantResult.timings?.afterStateElapsedMs ?? null,
    assistantAutomationBeforeStateElapsedMs:
      assistantResult.timings?.beforeStateElapsedMs ?? null,
    assistantAutomationCurrentTurnDeliveryIntentIds:
      assistantResult.currentTurnDeliveryIntentIds ?? [],
    assistantAutomationElapsedMs,
    assistantAutomationPassElapsedMs: assistantResult.timings?.passElapsedMs ?? null,
    assistantAutomationProgressed: assistantResult.progressed,
    assistantAutomationReplyFailed: assistantResult.replyFailed,
    assistantAutomationTotalElapsedMs: assistantResult.timings?.totalElapsedMs ?? null,
    assistantInputCandidateListed:
      assistantResult.timings?.inputCandidateListed ?? false,
    assistantInputCandidateQueryCount:
      assistantResult.timings?.inputCandidateQueryCount ?? 0,
    nextWakeAt: assistantResult.nextWakeAt,
    readinessElapsedMs,
    ...(redactedLogEntries.length === 0 ? {} : { redactedLogEntries }),
    totalElapsedMs: elapsedSince(startedAt),
  };
}

export async function runHostedAssistantAutomation(
  vaultRoot: string,
  requestId: string,
  executionContext: AssistantExecutionContext,
  wake: HostedRuntimeEvent,
  freshAssistantInputIds: readonly string[] = [],
  signal?: AbortSignal,
  turnEnvironment?: AssistantTurnEnvironment | null,
  latencyTrace?: {
    latencyTracePort?: HostedRuntimePlatform["latencyTracePort"] | null;
    runtimeAttemptId?: string | null;
  },
): Promise<{
  currentTurnDeliveryIntentIds: string[];
  nextWakeAt: string | null;
  progressed: boolean;
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
  replyFailed: number;
  timings?: {
    activeTurnInputIngested?: boolean | null;
    afterStateElapsedMs: number;
    beforeStateElapsedMs: number;
    inputCandidateListed?: boolean | null;
    inputCandidateQueryCount?: number | null;
    passElapsedMs: number;
    totalElapsedMs: number;
  };
}> {
  const startedAt = Date.now();
  const inboxServices = createIntegratedInboxServices();
  const vaultServices = createIntegratedVaultServices();
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [];
  const automationEventCounts = new Map<string, number>();
  let redactedAutomationEventLogCount = 0;
  let redactedInputQueryLogCount = 0;
  let activeTurnInputIngested = false;
  let inputCandidateListed = false;
  let inputCandidateQueryCount = 0;
  const freshAssistantInputIdCount = new Set(freshAssistantInputIds).size;
  const selectedInputIds = await selectHostedAssistantInputIds(
    freshAssistantInputIdCount > 0
      ? {
          freshAssistantInputIds,
          mode: "foreground",
          vaultRoot,
        }
      : {
          limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
          mode: "background",
          vaultRoot,
        },
  );
  const baseInputSource = createHostedAssistantInputSource({
    initialPendingInputIds: selectedInputIds.pendingInputIds,
    pendingInputRefreshMode:
      selectedInputIds.mode === "foreground" ? "existing" : "compact",
    selectedInputIds: selectedInputIds.inputIds,
    vaultRoot,
  });
  const inputSource: AssistantInputSource = {
    ...baseInputSource,
    async listInputCandidates(query) {
      const queryIndex = inputCandidateQueryCount;
      inputCandidateQueryCount += 1;
      const startedAt = Date.now();
      const result = await baseInputSource.listInputCandidates(query);
      if (result.inputs.length > 0) {
        inputCandidateListed = true;
      }
      if (redactedInputQueryLogCount < HOSTED_ASSISTANT_INPUT_QUERY_REDACTED_LOG_LIMIT) {
        redactedLogEntries.push(emitHostedRuntimeRedactedLog({
          component: "runtime",
          details: buildHostedAssistantInputCandidateQueryLogDetails({
            elapsedMs: elapsedSince(startedAt),
            query,
            queryIndex,
            result,
            selectedInputCount: selectedInputIds.inputIds.length,
          }),
          wake,
          message: "Hosted assistant input candidate query finished.",
          phase: "wake.running",
        }));
        redactedInputQueryLogCount += 1;
      }
      return result;
    },
    async listNewConversationInputs(query) {
      const startedAt = Date.now();
      const result = await baseInputSource.listNewConversationInputs(query);
      if (result.inputs.length > 0) {
        activeTurnInputIngested = true;
      }
      if (redactedInputQueryLogCount < HOSTED_ASSISTANT_INPUT_QUERY_REDACTED_LOG_LIMIT) {
        redactedLogEntries.push(emitHostedRuntimeRedactedLog({
          component: "runtime",
          details: buildHostedAssistantNewConversationInputQueryLogDetails({
            elapsedMs: elapsedSince(startedAt),
            query,
            result,
          }),
          wake,
          message: "Hosted assistant new conversation input query finished.",
          phase: "wake.running",
        }));
        redactedInputQueryLogCount += 1;
      }
      return result;
    },
  };
  const beforeStateStartedAt = Date.now();
  const beforeState = await readAssistantAutomationState(vaultRoot);
  const beforeStateElapsedMs = elapsedSince(beforeStateStartedAt);
  redactedLogEntries.push(emitHostedRuntimeRedactedLog({
    component: "runtime",
    details: {
      autoReplyChannels: beforeState.autoReply.map((entry) => entry.channel).join(","),
      autoReplyEligibleAfterSummary: summarizeHostedAssistantAutoReplyEligibleAfter(
        beforeState.autoReply,
      ),
      freshAssistantInputCount: freshAssistantInputIdCount,
      pendingAssistantInputCount: selectedInputIds.pendingInputIds.length,
      requestId,
      selectedAssistantInputCount: selectedInputIds.inputIds.length,
      selectedAssistantInputMode: selectedInputIds.mode,
    },
    wake,
    message: "Hosted assistant automation pass starting.",
    phase: "wake.running",
  }));
  try {
    const passStartedAt = Date.now();
    const maxPerScan = selectedInputIds.mode === "foreground"
      ? Math.max(1, selectedInputIds.inputIds.length)
      : HOSTED_ASSISTANT_BACKGROUND_AUTOMATION_SCAN_LIMIT;
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
          && (
            shouldAlwaysPersistHostedAssistantAutomationEvent(event.type)
            || redactedAutomationEventLogCount < HOSTED_ASSISTANT_AUTOMATION_REDACTED_EVENT_LOG_LIMIT
          )
        ) {
          redactedLogEntries.push(logEntry);
          if (!shouldAlwaysPersistHostedAssistantAutomationEvent(event.type)) {
            redactedAutomationEventLogCount += 1;
          }
        }
      },
      onProviderRequestStarted: (event) => {
        recordHostedAssistantProviderStartLatencyTraceBestEffort({
          ...event,
          latencyTracePort: latencyTrace?.latencyTracePort ?? null,
          runtimeAttemptId: latencyTrace?.runtimeAttemptId ?? null,
        });
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
      maxPerScan,
      requestId,
      signal,
      inputSource,
      turnEnvironment: turnEnvironment ?? null,
      vault: vaultRoot,
    });
    const passElapsedMs = elapsedSince(passStartedAt);
    const afterStateStartedAt = Date.now();
    const afterState = await readAssistantAutomationState(vaultRoot);
    const afterStateElapsedMs = elapsedSince(afterStateStartedAt);
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
    const currentTurnDeliveryIntentIds =
      result.currentTurnDeliveryIntentIds ?? [];
    const nextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
      nowMs: resolveHostedMaintenanceWakeNowMs(wake),
      resultNextWakeAt: result.nextWakeAt,
      scanLimit: maxPerScan,
      scanResult: {
        replies,
        routing,
      },
    });
    redactedLogEntries.push(emitHostedRuntimeRedactedLog({
      component: "runtime",
      details: {
        ...buildHostedAssistantAutomationEventCountLogDetails(automationEventCounts),
        autoReplyChannels: afterState.autoReply.map((entry) => entry.channel).join(","),
        autoReplyEligibleAfterSummary: summarizeHostedAssistantAutoReplyEligibleAfter(
          afterState.autoReply,
        ),
        cronProcessed: result.cronProcessed,
        nextWakeAt,
        outboxAttempted: result.outboxAttempted,
        progressed: result.progressed,
        inputCandidateListed,
        inputCandidateQueryCount,
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
      currentTurnDeliveryIntentIds,
      nextWakeAt,
      progressed: result.progressed,
      redactedLogEntries,
      replyFailed: replies.failed,
      timings: {
        activeTurnInputIngested,
        afterStateElapsedMs,
        beforeStateElapsedMs,
        inputCandidateListed,
        inputCandidateQueryCount,
        passElapsedMs,
        totalElapsedMs: elapsedSince(startedAt),
      },
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
        currentTurnDeliveryIntentIds: [],
        nextWakeAt,
        progressed: true,
        redactedLogEntries,
        replyFailed: 0,
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

function recordHostedAssistantProviderStartLatencyTraceBestEffort(input: {
  admissionMs?: number;
  assistantInputIds: readonly string[];
  latencyTracePort?: HostedRuntimePlatform["latencyTracePort"] | null;
  preProviderSetupMs?: number;
  promptBuildMs?: number;
  providerRequestOrdinal: number;
  runtimeAttemptId?: string | null;
  sessionResolveMs?: number;
  source: string;
  startedAt: string;
  turnLockWaitMs?: number;
}): void {
  if (input.source !== "linq") {
    return;
  }
  if (!input.latencyTracePort || input.assistantInputIds.length === 0) {
    return;
  }

  // In-memory provider sub-split rides the EXISTING provider_started POST. No new
  // request, await, or I/O: the durations were measured during turn setup and are
  // attached to the request object already being sent best-effort.
  const provider: NonNullable<
    HostedRuntimeLatencyPhaseBreakdown["provider"]
  > = {
    ...(input.turnLockWaitMs === undefined ? {} : { turnLockWaitMs: input.turnLockWaitMs }),
    ...(input.sessionResolveMs === undefined ? {} : { sessionResolveMs: input.sessionResolveMs }),
    ...(input.promptBuildMs === undefined ? {} : { promptBuildMs: input.promptBuildMs }),
    ...(input.admissionMs === undefined ? {} : { admissionMs: input.admissionMs }),
    ...(input.preProviderSetupMs === undefined
      ? {}
      : { preProviderSetupMs: input.preProviderSetupMs }),
  };

  void recordHostedAssistantProviderStartLatencyTraceWithRetry(input.latencyTracePort, {
    event: {
      assistantInputIds: [...input.assistantInputIds],
      at: input.startedAt,
      ...(Object.keys(provider).length > 0
        ? { phaseBreakdown: { schemaVersion: 1, provider } }
        : {}),
      providerRequestOrdinal: input.providerRequestOrdinal,
      runtimeAttemptId: input.runtimeAttemptId ?? null,
      source: "linq",
      type: "provider_started",
    },
  }).catch(() => {
    // Latency traces are diagnostic-only and must not affect runtime progress.
  });
}

const HOSTED_ASSISTANT_PROVIDER_START_TRACE_RETRY_DELAYS_MS = [250, 1_000] as const;

async function recordHostedAssistantProviderStartLatencyTraceWithRetry(
  latencyTracePort: NonNullable<HostedRuntimePlatform["latencyTracePort"]>,
  request: Parameters<NonNullable<HostedRuntimePlatform["latencyTracePort"]>["record"]>[0],
): Promise<void> {
  let response = await latencyTracePort.record(request);

  for (const delayMs of HOSTED_ASSISTANT_PROVIDER_START_TRACE_RETRY_DELAYS_MS) {
    if (response.unmatchedCount === 0) {
      return;
    }
    await sleep(delayMs);
    response = await latencyTracePort.record(request);
  }
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function resolveHostedAssistantAutomationNextWakeAt(input: {
  nowMs: number;
  resultNextWakeAt: string | null;
  scanLimit: number;
  scanResult: {
    replies: {
      considered: number;
      nextWakeAt?: string | null;
    };
    routing: {
      considered: number;
      nextWakeAt?: string | null;
    };
  };
}): string | null {
  return earliestHostedMaintenanceWakeAt(
    normalizeHostedFutureWakeAt(
      input.resultNextWakeAt,
      input.nowMs,
    ),
    resolveHostedAssistantBacklogWakeAt(input),
  );
}

function resolveHostedMaintenanceWakeNowMs(wake: HostedRuntimeEvent): number {
  const occurredAtMs = Date.parse(wake.occurredAt);
  return Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now();
}

function resolveHostedAssistantBacklogWakeAt(input: {
  nowMs: number;
  scanLimit: number;
  scanResult: {
    replies: {
      considered: number;
      nextWakeAt?: string | null;
    };
    routing: {
      considered: number;
      nextWakeAt?: string | null;
    };
  };
}): string | null {
  const repliesMayHaveBacklog =
    input.scanResult.replies.considered >= input.scanLimit
    && !input.scanResult.replies.nextWakeAt;
  const routingMayHaveBacklog =
    input.scanResult.routing.considered >= input.scanLimit
    && !input.scanResult.routing.nextWakeAt;
  if (!repliesMayHaveBacklog && !routingMayHaveBacklog) {
    return null;
  }

  return new Date(input.nowMs).toISOString();
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

function buildHostedAssistantInputCandidateQueryLogDetails(input: {
  elapsedMs: number;
  query: AssistantInputCandidateQuery;
  queryIndex: number;
  result: AssistantInputCandidateBatch;
  selectedInputCount: number;
}): Record<string, boolean | number | string | null> {
  return {
    afterCursorPresent: input.query.afterCursor != null,
    candidateConversationCount: input.result.inputs.filter((candidate) =>
      candidate.event.conversation !== null
    ).length,
    candidateCount: input.result.inputs.length,
    candidateProjectionStatusSummary: summarizeHostedRuntimeLogCodeCounts(
      input.result.inputs.map((candidate) => candidate.projection.status),
    ),
    candidateReplyTargetPresentCount: input.result.inputs.filter((candidate) =>
      candidate.event.replyTarget !== null
    ).length,
    candidateSelfAuthoredCount: input.result.inputs.filter((candidate) =>
      candidate.event.conversation?.actorIsSelf === true
    ).length,
    candidateSourceSummary: summarizeHostedRuntimeLogCodeCounts(
      input.result.inputs.map((candidate) => candidate.event.source),
    ),
    elapsedMs: input.elapsedMs,
    knownInputIdCount: input.query.knownInputIds?.length ?? 0,
    limit: normalizeHostedRuntimeLogLimit(input.query.limit),
    nextCursorPresent: input.result.nextCursor !== null,
    queryIndex: input.queryIndex,
    selectedInputCount: input.selectedInputCount,
    sourceId: normalizeHostedRuntimeLogSourceId(input.query.sourceId ?? null),
    sourceIdPresent: input.query.sourceId != null,
    type: "assistant.input_candidates.listed",
  };
}

function buildHostedAssistantNewConversationInputQueryLogDetails(input: {
  elapsedMs: number;
  query: AssistantTurnConversationInputQuery;
  result: AssistantInputCandidateBatch;
}): Record<string, boolean | number | string | null> {
  return {
    afterCursorPresent: input.query.afterCursor != null,
    candidateCount: input.result.inputs.length,
    conversationActorIsSelf: input.query.conversation.actorIsSelf,
    conversationDirect: input.query.conversation.threadIsDirect,
    conversationSource: normalizeHostedRuntimeLogSourceId(input.query.conversation.source),
    elapsedMs: input.elapsedMs,
    knownInputIdCount: input.query.knownInputIds?.length ?? 0,
    knownProjectionCaptureIdCount: input.query.knownProjectionCaptureIds?.length ?? 0,
    limit: normalizeHostedRuntimeLogLimit(input.query.limit),
    nextCursorPresent: input.result.nextCursor !== null,
    type: "assistant.new_conversation_inputs.listed",
  };
}

function summarizeHostedRuntimeLogCodeCounts(values: readonly string[]): string {
  const safeValues = values.map((value) => toHostedRuntimeLogCode(value));
  const summary = summarizeHostedRuntimeStatusCounts(safeValues).statusSummary;
  return typeof summary === "string" ? summary : "";
}

function normalizeHostedRuntimeLogLimit(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeHostedRuntimeLogSourceId(value: string | null | undefined): string | null {
  return value ? toHostedRuntimeLogCode(value) : null;
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
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
    "assistant.reply.intent_created",
    "assistant.delivery.foreground_started",
    "assistant.delivery.sent",
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

function shouldAlwaysPersistHostedAssistantAutomationEvent(type: string): boolean {
  return type === "input.reply-failed";
}

export async function runHostedDeviceSyncPass(
  wake: HostedRuntimeEvent,
  vaultRoot: string,
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null,
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined,
  timeoutMs: number | null,
  options: {
    platformEnv?: Readonly<Record<string, string>>;
    runtimeLogPlatform?: Pick<HostedRuntimePlatform, "logPort"> | null;
    shouldYield?: (() => boolean) | null;
    skipDirtyPendingFetch?: boolean;
    signal?: AbortSignal | null;
    stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  } = {},
): Promise<{
  nextWakeAt: string | null;
  postCheckpointRecord: HostedMaintenanceMetrics["postCheckpointRecord"];
  processedJobs: number;
  skipped: boolean;
  stagedDirtyAcks?: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[];
}> {
  const platformEnv = options.platformEnv ?? {};
  await writeHostedLegacyDeviceSyncPlatformEnvLog({
    deviceSyncConfig,
    platform: options.runtimeLogPlatform ?? null,
    platformEnv,
  });
  const shouldYield = createHostedDeviceSyncYieldPredicate(
    options.shouldYield ?? null,
    options.signal ?? null,
  );
  const startedAtMs = Date.now();
  const service = createHostedDeviceSyncRuntime({
    deviceSyncConfig,
    platformEnv,
    shouldYield,
    vaultRoot,
  });

  if (!service) {
    if (deviceSyncConfig) {
      reportHostedDeviceSyncConfigMissing(wake);
    }

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
    pendingDirtyAcks: [],
    snapshot: null,
  };
  let controlPlaneSynced = false;
  let processedJobs = 0;

  try {
    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        service,
        stagedDirtyAcks: options.stagedDirtyAcks ?? null,
        wake,
      });
    }

    if (secret) {
      syncState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake,
        secret,
        signal: options.signal ?? null,
        service,
        skipDirtyPendingFetch: options.skipDirtyPendingFetch ?? false,
        stagedDirtyAcks: options.stagedDirtyAcks ?? null,
      });
      controlPlaneSynced = true;
    }

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        service,
        syncState,
        wake,
      });
    }

    await service.runSchedulerOnce();

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        service,
        syncState,
        wake,
      });
    }

    processedJobs = await drainHostedDeviceSyncWorker({
      service,
      shouldYield,
    });
    await writeHostedDeviceSyncJobFailureRuntimeLogs({
      platform: options.runtimeLogPlatform ?? null,
      processedJobs,
      service,
      state: syncState,
      wake,
    });

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        service,
        syncState,
        wake,
      });
    }

    if (secret && controlPlaneSynced) {
      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake,
        secret,
        signal: options.signal ?? null,
        service,
        state: syncState,
      });
    }

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        service,
        syncState,
        wake,
      });
    }

    const denseRawRetention = await runHostedDeviceSyncDenseRawRetention({
      deadlineMs: remainingHostedDeviceSyncDeadlineMs(startedAtMs, timeoutMs),
      platform: options.runtimeLogPlatform ?? null,
      processedJobs,
      shouldYield,
      vaultRoot,
    });

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        service,
        syncState,
        wake,
      });
    }

    const postCheckpointRecord = resolveHostedDeviceSyncDirtyPostCheckpointRecord({
      state: syncState,
    });
    const stagedDirtyAcks = listHostedDeviceSyncDirtyProcessedRecords({
      state: syncState,
    });

    return {
      nextWakeAt: earliestHostedMaintenanceWakeAt(
        service.getNextWakeAt(),
        denseRawRetention.hasMore ? resolveHostedDeviceSyncYieldRetryAt() : null,
      ),
      postCheckpointRecord,
      processedJobs,
      skipped: false,
      ...(stagedDirtyAcks.length > 0 ? { stagedDirtyAcks } : {}),
    };
  } catch (error) {
    if (isHostedDeviceSyncAbortError(error, options.signal ?? null)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        service,
        syncState,
        wake,
      });
    }
    throw error;
  } finally {
    closeHostedRuntimeDeviceSyncService(service);
  }
}

function createHostedDeviceSyncYieldPredicate(
  shouldYield: (() => boolean) | null,
  signal: AbortSignal | null,
): (() => boolean) | null {
  if (!shouldYield && !signal) {
    return null;
  }

  return () => signal?.aborted === true || shouldYield?.() === true;
}

function shouldYieldHostedDeviceSync(shouldYield: (() => boolean) | null): boolean {
  return shouldYield?.() === true;
}

function isHostedDeviceSyncAbortError(error: unknown, signal: AbortSignal | null): boolean {
  if (!signal?.aborted) {
    return false;
  }
  if (error === signal.reason) {
    return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

function buildHostedDeviceSyncYieldedPassResult(input: {
  processedJobs: number;
  service: DeviceSyncService;
  stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  syncState?: HostedDeviceSyncRuntimeSyncState | null;
  wake: HostedRuntimeEvent;
}): {
  nextWakeAt: string | null;
  postCheckpointRecord: HostedMaintenanceMetrics["postCheckpointRecord"];
  processedJobs: number;
  skipped: boolean;
  stagedDirtyAcks?: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[];
} {
  const syncState = input.syncState ?? null;
  const stagedDirtyAcks = syncState
    ? listHostedDeviceSyncDirtyProcessedRecords({ state: syncState })
    : input.stagedDirtyAcks ?? [];
  return {
    nextWakeAt: resolveHostedDeviceSyncYieldRetryAt(),
    postCheckpointRecord: syncState
      ? resolveHostedDeviceSyncDirtyPostCheckpointRecord({ state: syncState })
      : null,
    processedJobs: input.processedJobs,
    skipped: true,
    ...(stagedDirtyAcks.length > 0
      ? { stagedDirtyAcks: [...stagedDirtyAcks] }
      : {}),
  };
}

function resolveHostedDeviceSyncYieldRetryAt(now = new Date()): string {
  return new Date(now.getTime() + HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS).toISOString();
}

function remainingHostedDeviceSyncDeadlineMs(
  startedAtMs: number,
  timeoutMs: number | null,
): number | undefined {
  if (timeoutMs === null) {
    return undefined;
  }
  return Math.max(0, timeoutMs - (Date.now() - startedAtMs));
}

async function drainHostedDeviceSyncWorker(input: {
  service: DeviceSyncService;
  shouldYield?: (() => boolean) | null;
}): Promise<number> {
  if (!input.shouldYield) {
    return await input.service.drainWorker(HOSTED_MAX_DEVICE_SYNC_JOBS);
  }

  let processedJobs = 0;
  for (let index = 0; index < HOSTED_MAX_DEVICE_SYNC_JOBS; index += 1) {
    if (input.shouldYield()) {
      break;
    }
    const processed = await input.service.drainWorker(1);
    if (processed <= 0) {
      break;
    }
    processedJobs += processed;
    if (processed !== 1) {
      break;
    }
  }
  return processedJobs;
}

async function runHostedDeviceSyncDenseRawRetention(input: {
  deadlineMs?: number;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
  shouldYield: (() => boolean) | null;
  vaultRoot: string;
}): Promise<{ hasMore: boolean }> {
  try {
    if (shouldYieldHostedDeviceSync(input.shouldYield) || input.deadlineMs === 0) {
      return {
        hasMore: true,
      };
    }

    const result = await pruneWearableDenseRawTimeseries({
      deadlineMs: input.deadlineMs,
      maxBytes: HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_BYTES,
      maxFiles: HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_FILES,
      vaultRoot: input.vaultRoot,
    });

    await writeHostedDeviceSyncDenseRawRetentionRuntimeLog({
      platform: input.platform,
      processedJobs: input.processedJobs,
      result,
    });

    return {
      hasMore: result.hasMore,
    };
  } catch (error) {
    await writeHostedDeviceSyncDenseRawRetentionFailureRuntimeLog({
      error,
      platform: input.platform,
      processedJobs: input.processedJobs,
    });
    return {
      hasMore: true,
    };
  }
}

async function writeHostedDeviceSyncDenseRawRetentionRuntimeLog(input: {
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
  result: Awaited<ReturnType<typeof pruneWearableDenseRawTimeseries>>;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }
  if (
    input.result.tombstonedDenseRawArtifactCount === 0
    && input.result.skippedCount === 0
    && input.result.denseRawBytesBefore === 0
    && !input.result.hasMore
  ) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      eventCode: "device-sync.dense_raw_retention",
      level: "info",
      phase: "invoke",
      redactedJson: {
        denseRawAfterBytes: input.result.denseRawBytesAfter,
        denseRawBeforeBytes: input.result.denseRawBytesBefore,
        denseRawFreedBytes: input.result.denseRawBytesFreed,
        hasMore: input.result.hasMore,
        processedJobs: input.processedJobs,
        skippedCount: input.result.skippedCount,
        tombstonedDenseRawArtifactCount: input.result.tombstonedDenseRawArtifactCount,
      },
    },
    platform: input.platform,
  });
}

async function writeHostedDeviceSyncDenseRawRetentionFailureRuntimeLog(input: {
  error: unknown;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      eventCode: "device-sync.dense_raw_retention",
      level: "warn",
      phase: "invoke",
      redactedJson: {
        errorSummary: sanitizeHostedDeviceSyncFailureSummary(errorToString(input.error))
          ?? "dense raw retention failed",
        failed: true,
        hasMore: true,
        processedJobs: input.processedJobs,
      },
    },
    platform: input.platform,
  });
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export async function runHostedDeviceSyncWakeLane(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  platformEnv?: Readonly<Record<string, string>>;
  runtimeLogPlatform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
  signal?: AbortSignal | null;
  skipDirtyPendingFetch?: boolean;
  stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
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
      platformEnv: input.platformEnv ?? {},
      runtimeLogPlatform: input.runtimeLogPlatform ?? null,
      shouldYield: input.shouldYieldDeviceSync ?? null,
      signal: input.signal ?? null,
      skipDirtyPendingFetch: input.skipDirtyPendingFetch ?? false,
      stagedDirtyAcks: input.stagedDirtyAcks ?? null,
    },
  );
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      deviceSyncResult.nextWakeAt,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      deviceSyncResult.postCheckpointRecord?.nextWakeAt ?? null,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
  ]);

  return {
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: nextWake.at,
    ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
    parserProcessed: 0,
    postCheckpointRecord: deviceSyncResult.postCheckpointRecord ?? null,
    ...(deviceSyncResult.stagedDirtyAcks
      ? { stagedDirtyAcks: deviceSyncResult.stagedDirtyAcks }
      : {}),
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
  const pendingDirtyAcks = input.state.pendingDirtyAcks;
  if (pendingDirtyAcks.length === 0) {
    return null;
  }

  if (pendingDirtyAcks.length === 1) {
    const [pendingDirtyAck] = pendingDirtyAcks;
    return {
      kind: "device-sync.dirty-processed",
      ...toHostedDeviceSyncDirtyProcessedPostCheckpointRecord(pendingDirtyAck),
    };
  }

  return {
    kind: "device-sync.dirty-processed-batch",
    nextWakeAt: pendingDirtyAcks.reduce<string | null>(
      (nextWakeAt, ack) => earliestHostedMaintenanceWakeAt(nextWakeAt, ack.nextWakeAt),
      null,
    ),
    records: pendingDirtyAcks.map(toHostedDeviceSyncDirtyProcessedPostCheckpointRecord),
  };
}

function listHostedDeviceSyncDirtyProcessedRecords(input: {
  state: HostedDeviceSyncRuntimeSyncState;
}): HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] {
  return input.state.pendingDirtyAcks.map(toHostedDeviceSyncDirtyProcessedPostCheckpointRecord);
}

function toHostedDeviceSyncDirtyProcessedPostCheckpointRecord(
  ack: HostedDeviceSyncRuntimeSyncState["pendingDirtyAcks"][number],
): HostedDeviceSyncDirtyProcessedPostCheckpointRecord {
  return {
    connectionId: ack.connectionId,
    nextWakeAt: ack.nextWakeAt,
    ...(ack.processedDirtyPayloadIds
      ? { processedDirtyPayloadIds: ack.processedDirtyPayloadIds }
      : {}),
    processedRevision: ack.processedRevision,
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

function reportHostedDeviceSyncConfigMissing(wake: HostedRuntimeEvent): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      eventCode: "dirty_state.device_sync_config_missing",
      reason: "device_sync_config_missing",
    },
    level: "warn",
    message: "Hosted device-sync dirty state skipped: dirty_state.device_sync_config_missing.",
    phase: "wake.running",
    wake,
  });
}

async function writeHostedDeviceSyncJobFailureRuntimeLogs(input: {
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
  service: HostedDeviceSyncRuntimeService;
  state: HostedDeviceSyncRuntimeSyncState;
  wake: HostedRuntimeEvent;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }

  // Per-attempt failure diagnostics are recorded by the worker at the moment a
  // job attempt fails, so they survive a later job success that clears the
  // account-level last_sync_error_at state in the same drain. Webhook-triggered
  // wakes and idle maintenance both reach this writer through
  // runHostedDeviceSyncPass.
  const failureDiagnostics = input.service.listJobFailureDiagnostics();
  if (failureDiagnostics.length === 0) {
    return;
  }

  const baselineByHostedConnectionId = new Map(
    (input.state.snapshot?.connections ?? []).map((entry) => [entry.connection.id, entry]),
  );
  const accountsByLocalAccountId = new Map(
    input.service.listAccounts().map((account) => [account.id, account]),
  );

  for (const failureDiagnostic of failureDiagnostics) {
    const account = accountsByLocalAccountId.get(failureDiagnostic.accountId) ?? null;
    const hostedConnectionId =
      input.state.localToHostedAccountIds.get(failureDiagnostic.accountId) ?? null;
    const baseline = hostedConnectionId
      ? baselineByHostedConnectionId.get(hostedConnectionId) ?? null
      : null;

    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...(failureDiagnostic.at ? { at: failureDiagnostic.at } : {}),
        component: "device-sync",
        errorCode: toHostedRuntimeLogCode(failureDiagnostic.code),
        eventCode: "device-sync.job_failed",
        level: "warn",
        phase: "invoke",
        redactedJson: buildHostedDeviceSyncFailureLogRedactedJson({
          account,
          baseline,
          failureDiagnostic,
          hostedConnectionKnown: Boolean(hostedConnectionId),
          processedJobs: input.processedJobs,
          wake: input.wake,
        }),
      },
      platform: input.platform,
    });
  }
}

async function writeHostedLegacyDeviceSyncPlatformEnvLog(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  platformEnv: Readonly<Record<string, string>>;
}): Promise<void> {
  if (!input.platform?.logPort || !input.deviceSyncConfig?.providerConfigs.junction) {
    return;
  }

  const legacyPlatformEnvKeyCount = Object.keys(input.platformEnv).length;
  const junctionPlatformEnvPresent = hasHostedRuntimeJunctionPlatformEnv(input.platformEnv);
  if (legacyPlatformEnvKeyCount === 0 || !junctionPlatformEnvPresent) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      eventCode: "device-sync.legacy_platform_env_present",
      level: "info",
      phase: "invoke",
      redactedJson: {
        junctionPlatformEnvPresent,
        legacyPlatformEnvKeyCount,
      },
    },
    platform: input.platform,
  });
}

type HostedDeviceSyncRuntimeService = NonNullable<ReturnType<typeof createHostedDeviceSyncRuntime>>;
type HostedDeviceSyncRuntimeSnapshotEntry = NonNullable<HostedDeviceSyncRuntimeSyncState["snapshot"]>["connections"][number];

function buildHostedDeviceSyncFailureLogRedactedJson(input: {
  account: ReturnType<HostedDeviceSyncRuntimeService["listAccounts"]>[number] | null;
  baseline: HostedDeviceSyncRuntimeSnapshotEntry | null;
  failureDiagnostic: DeviceSyncJobFailureDiagnostic;
  hostedConnectionKnown: boolean;
  processedJobs: number;
  wake: HostedRuntimeEvent;
}): Record<string, boolean | number | string | null> {
  const summary = sanitizeHostedDeviceSyncFailureSummary(
    input.failureDiagnostic.summary
      ?? (input.account && input.account.lastErrorCode === input.failureDiagnostic.code
        ? input.account.lastErrorMessage
        : null),
  );
  const priorLocalState = input.baseline?.localState ?? null;
  const provider = input.failureDiagnostic.provider ?? input.account?.provider ?? null;

  return {
    failureCode: toHostedRuntimeLogCode(input.failureDiagnostic.code),
    failureDisposition: input.failureDiagnostic.retryable ? "retry" : "drop",
    ...(typeof input.failureDiagnostic.attempts === "number"
      ? { failureJobAttempts: input.failureDiagnostic.attempts }
      : {}),
    ...(input.failureDiagnostic.jobKind
      ? { failureJobKind: toHostedRuntimeLogCode(input.failureDiagnostic.jobKind) }
      : {}),
    ...(input.failureDiagnostic.resource
      ? { failureResource: toHostedRuntimeLogCode(input.failureDiagnostic.resource) }
      : {}),
    failureSummary: summary ?? "Hosted device-sync job failed.",
    ...buildHostedDeviceSyncFailureDiagnosticRedactedJson(input.failureDiagnostic),
    hadPriorFailure: Boolean(priorLocalState?.lastSyncErrorAt),
    hadPriorSuccess: Boolean(priorLocalState?.lastSyncCompletedAt),
    hostedConnectionKnown: input.hostedConnectionKnown,
    nextReconcileAt: input.account?.nextReconcileAt ?? null,
    processedJobs: input.processedJobs,
    provider: provider ? toHostedRuntimeLogCode(provider) : null,
    setupPhase: input.account?.setupPhase ?? null,
    status: input.account ? toHostedRuntimeLogCode(input.account.status) : null,
    syncCompletedAt: input.account?.lastSyncCompletedAt ?? null,
    syncFailedAt: input.account?.lastSyncErrorAt ?? null,
    syncStartedAt: input.account?.lastSyncStartedAt ?? null,
    wakeKind: toHostedRuntimeLogCode(input.wake.kind),
    wakeReason: "reason" in input.wake
      ? toHostedRuntimeLogCode(input.wake.reason)
      : "runtime_timer",
  };
}

type DeviceSyncFailureDiagnosticDetails = DeviceSyncJobFailureDiagnostic["details"];
type DeviceSyncFailureDiagnosticStringField = {
  [Key in keyof DeviceSyncFailureDiagnosticDetails]: DeviceSyncFailureDiagnosticDetails[Key] extends string | undefined
    ? Key
    : never;
}[keyof DeviceSyncFailureDiagnosticDetails];
type DeviceSyncFailureDiagnosticNumberField = {
  [Key in keyof DeviceSyncFailureDiagnosticDetails]: DeviceSyncFailureDiagnosticDetails[Key] extends number | undefined
    ? Key
    : never;
}[keyof DeviceSyncFailureDiagnosticDetails];
type DeviceSyncFailureDiagnosticBooleanField = {
  [Key in keyof DeviceSyncFailureDiagnosticDetails]: DeviceSyncFailureDiagnosticDetails[Key] extends boolean | undefined
    ? Key
    : never;
}[keyof DeviceSyncFailureDiagnosticDetails];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_CODE_FIELDS = [
  "failureCauseCode",
  "failureCauseName",
  "failureErrorName",
  "providerRequestAuthKind",
  "providerRequestAuthPlacement",
  "providerRequestBodyFieldNames",
  "providerRequestBodyKind",
  "providerRequestContentType",
  "providerRequestEndpointKind",
  "providerRequestMethod",
  "providerRequestQueryParameterNames",
  "providerResponseErrorCode",
  "providerResponseShapeKind",
  "providerOAuthErrorCode",
  "providerOAuthGrantType",
  "providerOAuthRequestBodyBuilderKind",
  "providerOAuthRequestClientAuthPlacement",
  "providerOAuthRequestContentType",
  "providerOAuthRequestEncodingKind",
  "providerOAuthRequestMethod",
  "providerOAuthRequestParameterNames",
  "providerOAuthRequestScopeValue",
  "providerOAuthRequestTokenEndpointKind",
  "providerOAuthResponseShapeKind",
] as const satisfies readonly DeviceSyncFailureDiagnosticStringField[];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_REASON_FIELDS = [
  "failureErrorCause",
  "providerHttpStatusText",
  "providerResponseErrorDescription",
  "providerOAuthErrorDescription",
] as const satisfies readonly DeviceSyncFailureDiagnosticStringField[];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_NUMBER_FIELDS = [
  "providerHttpStatus",
  "providerRequestBodyFieldCount",
  "providerRequestQueryParameterCount",
  "providerOAuthRequestDuplicateParameterCount",
  "providerOAuthRequestParameterCount",
  "providerOAuthRequestScopeCount",
] as const satisfies readonly DeviceSyncFailureDiagnosticNumberField[];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_BOOLEAN_FIELDS = [
  "providerRequestCredentialPresent",
  "providerResponseErrorDescriptionFieldPresent",
  "providerResponseErrorFieldPresent",
  "providerOAuthRequestClientCredentialPresent",
  "providerOAuthRequestClientIdPresent",
  "providerOAuthRequestHasDuplicateParameters",
  "providerOAuthRequestOfflineScopePresent",
  "providerOAuthRequestRefreshCredentialPresent",
  "providerOAuthRequestScopePresent",
  "providerOAuthResponseErrorDescriptionFieldPresent",
  "providerOAuthResponseErrorFieldPresent",
] as const satisfies readonly DeviceSyncFailureDiagnosticBooleanField[];

function buildHostedDeviceSyncFailureDiagnosticRedactedJson(
  diagnostic: DeviceSyncJobFailureDiagnostic,
): Record<string, boolean | number | string | null> {
  const redacted: Record<string, boolean | number | string | null> = {
    failureRetryable: diagnostic.retryable,
  };

  if (diagnostic.accountStatus) {
    redacted.providerAccountStatus = toHostedRuntimeLogCode(diagnostic.accountStatus);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_CODE_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticCode(redacted, field, diagnostic.details[field]);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_REASON_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticReason(redacted, field, diagnostic.details[field]);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_NUMBER_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticNumber(redacted, field, diagnostic.details[field]);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_BOOLEAN_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticBoolean(redacted, field, diagnostic.details[field]);
  }

  return redacted;
}

function appendHostedDeviceSyncFailureDiagnosticBoolean(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    redacted[key] = value;
  }
}

function appendHostedDeviceSyncFailureDiagnosticNumber(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: number | undefined,
): void {
  if (value === undefined) {
    return;
  }

  redacted[key] = value;
}

function appendHostedDeviceSyncFailureDiagnosticCode(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  redacted[key] = toHostedRuntimeLogCode(value);
}

function appendHostedDeviceSyncFailureDiagnosticReason(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  const reason = sanitizeHostedDeviceSyncFailureSummary(value);
  if (reason) {
    redacted[key] = reason;
  }
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
  platformEnv: Readonly<Record<string, string>>;
  shouldYield?: (() => boolean) | null;
  vaultRoot: string;
}) {
  if (!input.deviceSyncConfig) {
    return null;
  }

  const registry = createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(
      resolveHostedRuntimeDeviceSyncProviderConfigs(
        input.deviceSyncConfig.providerConfigs,
        input.platformEnv,
      ),
    ),
  );

  if (registry.list().length === 0) {
    return null;
  }

  return createHostedRuntimeDeviceSyncService({
    secret: input.deviceSyncConfig.secret,
    config: {
      publicBaseUrl: input.deviceSyncConfig.publicBaseUrl,
      shouldYieldJobExecution: input.shouldYield ?? null,
      vaultRoot: input.vaultRoot,
    },
    registry,
  });
}

function resolveHostedRuntimeDeviceSyncProviderConfigs(
  providerConfigs: HostedAssistantRuntimeDeviceSyncConfig["providerConfigs"],
  platformEnv: Readonly<Record<string, string>>,
): ConfiguredDeviceSyncProviderConfigs {
  const runtimeProviderConfigs: ConfiguredDeviceSyncProviderConfigs = {};

  if (providerConfigs.junction && hasHostedRuntimeJunctionPlatformEnv(platformEnv)) {
    const junction = readConfiguredJunctionDeviceSyncProviderConfig(platformEnv);

    if (junction) {
      runtimeProviderConfigs.junction = junction;
    }
  }

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

function hasHostedRuntimeJunctionPlatformEnv(
  platformEnv: Readonly<Record<string, string>>,
): boolean {
  return HOSTED_RUNTIME_JUNCTION_PLATFORM_ENV_KEYS.some((key) => Boolean(platformEnv[key]));
}
