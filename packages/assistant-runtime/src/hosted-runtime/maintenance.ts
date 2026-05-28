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
  type AssistantTurnConversationInputQuery,
  readAssistantAutomationState,
  runAssistantAutomationPass,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";

import type {
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
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
  summarizeHostedAssistantAutoReplyEligibleAfter,
  summarizeHostedRuntimeStatusCounts,
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
import { emitHostedAssistantProviderTraceLog } from "./events.ts";
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

const HOSTED_MAX_DEVICE_SYNC_JOBS = 100;
const HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS = 30_000;
const HOSTED_ASSISTANT_AUTOMATION_REDACTED_EVENT_LOG_LIMIT = 12;
const HOSTED_ASSISTANT_INPUT_QUERY_REDACTED_LOG_LIMIT = 20;
const HOSTED_DEVICE_SYNC_FAILURE_SUMMARY_MAX_LENGTH = 2048;
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
  foregroundReplayInputIds?: readonly string[] | null;
  foregroundReplayPromptInputIds?: readonly string[] | null;
  preferredInputIds?: readonly string[] | null;
  runtimeAttemptId?: string | null;
  signal?: AbortSignal;
  skipAssistantAutomation?: boolean;
  skipDeviceSync?: boolean;
  shouldYieldDeviceSync?: (() => boolean) | null;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const startedAt = Date.now();
  const readinessStartedAt = Date.now();
  const assistantAutomation = await resolveHostedAssistantAutomationReadiness({
    skipAssistantAutomation: input.skipAssistantAutomation ?? false,
  });
  const readinessElapsedMs = elapsedSince(readinessStartedAt);
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [];

  if (!assistantAutomation.configured) {
    redactedLogEntries.push(
      reportHostedAssistantAutomationSkipped(input.wake, assistantAutomation),
    );
  }

  const deviceSyncStartedAt = Date.now();
  const deviceSyncResult = input.skipDeviceSync === true
    ? {
        nextWakeAt: null,
        postCheckpointRecord: null,
        processedJobs: 0,
        skipped: true,
      }
    : await runHostedDeviceSyncPass(
        input.wake,
        input.vaultRoot,
        input.runtime.resolvedConfig.deviceSync,
        input.runtime.platform.deviceSyncPort,
        input.runtime.commitTimeoutMs,
        {
          platformEnv: input.runtime.platformEnv,
          runtimeLogPlatform: input.runtime.platform,
          shouldYield: input.shouldYieldDeviceSync ?? null,
        },
      );
  const deviceSyncElapsedMs = elapsedSince(deviceSyncStartedAt);

  const assistantStartedAt = Date.now();
  const assistantResult = assistantAutomation.shouldRun
    ? await runHostedAssistantAutomation(
        input.vaultRoot,
        input.requestId,
        input.executionContext,
        input.wake,
        input.preferredInputIds ?? [],
        input.signal,
        input.foregroundReplayInputIds ?? [],
        input.foregroundReplayPromptInputIds ?? [],
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
        timings: undefined,
      };
  const assistantAutomationElapsedMs = elapsedSince(assistantStartedAt);
  redactedLogEntries.push(...assistantResult.redactedLogEntries);

  const deviceSyncNextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      deviceSyncResult.nextWakeAt,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      deviceSyncResult.postCheckpointRecord?.nextWakeAt ?? null,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
  ]);
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(assistantResult.nextWakeAt, null),
    deviceSyncNextWake,
  ]);

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
    assistantAutomationTotalElapsedMs: assistantResult.timings?.totalElapsedMs ?? null,
    assistantInputCandidateListed:
      assistantResult.timings?.inputCandidateListed ?? false,
    assistantInputCandidateQueryCount:
      assistantResult.timings?.inputCandidateQueryCount ?? 0,
    deviceSyncElapsedMs,
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: nextWake.at,
    ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
    parserProcessed: 0,
    postCheckpointRecord: deviceSyncResult.postCheckpointRecord ?? null,
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
  preferredInputIds: readonly string[] = [],
  signal?: AbortSignal,
  foregroundReplayInputIds: readonly string[] = [],
  foregroundReplayPromptInputIds: readonly string[] = [],
  latencyTrace?: {
    latencyTracePort?: HostedRuntimePlatform["latencyTracePort"] | null;
    runtimeAttemptId?: string | null;
  },
): Promise<{
  currentTurnDeliveryIntentIds: string[];
  nextWakeAt: string | null;
  progressed: boolean;
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
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
  const baseInputSource = createHostedAssistantInputSource({
    foregroundReplayInputIds,
    foregroundReplayPromptInputIds,
    preferredInputIds,
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
            foregroundReplayInputCount: foregroundReplayInputIds.length,
            foregroundReplayPromptInputCount: foregroundReplayPromptInputIds.length,
            preferredInputCount: preferredInputIds.length,
            query,
            queryIndex,
            result,
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
      foregroundReplayInputCount: foregroundReplayInputIds.length,
      foregroundReplayPromptInputCount: foregroundReplayPromptInputIds.length,
      preferredInputCount: preferredInputIds.length,
      requestId,
    },
    wake,
    message: "Hosted assistant automation pass starting.",
    phase: "wake.running",
  }));
  try {
    const passStartedAt = Date.now();
    const foregroundReplayScanLimit = foregroundReplayInputIds.length > 0
      ? normalizeHostedForegroundReplayScanLimit(foregroundReplayInputIds.length)
      : null;
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
      requestId,
      signal,
      inputSource,
      ...(foregroundReplayScanLimit !== null
        ? {
            maxPerScan: foregroundReplayScanLimit,
          }
        : {}),
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
      foregroundReplayScanLimit,
      nowMs: resolveHostedMaintenanceWakeNowMs(wake),
      resultNextWakeAt: result.nextWakeAt,
      scanLimit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
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
  assistantInputIds: readonly string[];
  latencyTracePort?: HostedRuntimePlatform["latencyTracePort"] | null;
  providerRequestOrdinal: number;
  runtimeAttemptId?: string | null;
  source: string;
  startedAt: string;
}): void {
  if (input.source !== "linq") {
    return;
  }
  if (!input.latencyTracePort || input.assistantInputIds.length === 0) {
    return;
  }

  void recordHostedAssistantProviderStartLatencyTraceWithRetry(input.latencyTracePort, {
    event: {
      assistantInputIds: [...input.assistantInputIds],
      at: input.startedAt,
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

function normalizeHostedForegroundReplayScanLimit(count: number): number {
  return Math.max(1, count);
}

function resolveHostedAssistantAutomationNextWakeAt(input: {
  foregroundReplayScanLimit: number | null;
  nowMs: number;
  resultNextWakeAt: string | null;
  scanLimit: number;
  scanResult: {
    replies: {
      considered: number;
    };
    routing: {
      considered: number;
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
  foregroundReplayScanLimit: number | null;
  scanLimit: number;
  scanResult: {
    replies: {
      considered: number;
    };
    routing: {
      considered: number;
    };
  };
}): string | null {
  if (input.foregroundReplayScanLimit !== null) {
    return null;
  }

  if (
    input.scanResult.replies.considered < input.scanLimit
    && input.scanResult.routing.considered < input.scanLimit
  ) {
    return null;
  }

  return new Date(Date.now()).toISOString();
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
  foregroundReplayInputCount: number;
  foregroundReplayPromptInputCount: number;
  preferredInputCount: number;
  query: AssistantInputCandidateQuery;
  queryIndex: number;
  result: AssistantInputCandidateBatch;
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
    foregroundReplayInputCount: input.foregroundReplayInputCount,
    foregroundReplayPromptInputCount: input.foregroundReplayPromptInputCount,
    knownInputIdCount: input.query.knownInputIds?.length ?? 0,
    limit: normalizeHostedRuntimeLogLimit(input.query.limit),
    nextCursorPresent: input.result.nextCursor !== null,
    preferredInputCount: input.preferredInputCount,
    queryIndex: input.queryIndex,
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
  } = {},
): Promise<{
  nextWakeAt: string | null;
  postCheckpointRecord: HostedMaintenanceMetrics["postCheckpointRecord"];
  processedJobs: number;
  skipped: boolean;
}> {
  const platformEnv = options.platformEnv ?? {};
  await writeHostedLegacyDeviceSyncPlatformEnvLog({
    deviceSyncConfig,
    platform: options.runtimeLogPlatform ?? null,
    platformEnv,
  });
  const service = createHostedDeviceSyncRuntime({
    deviceSyncConfig,
    platformEnv,
    shouldYield: options.shouldYield ?? null,
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

  try {
    if (shouldYieldHostedDeviceSync(options.shouldYield ?? null)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        service,
        wake,
      });
    }

    if (secret) {
      syncState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake,
        secret,
        service,
      });
      controlPlaneSynced = true;
    }

    if (shouldYieldHostedDeviceSync(options.shouldYield ?? null)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        service,
        wake,
      });
    }

    await service.runSchedulerOnce();

    if (shouldYieldHostedDeviceSync(options.shouldYield ?? null)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        service,
        wake,
      });
    }

    const processedJobs = await drainHostedDeviceSyncWorker({
      service,
      shouldYield: options.shouldYield ?? null,
    });
    await writeHostedDeviceSyncJobFailureRuntimeLogs({
      platform: options.runtimeLogPlatform ?? null,
      processedJobs,
      service,
      state: syncState,
      wake,
    });

    if (shouldYieldHostedDeviceSync(options.shouldYield ?? null)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        service,
        wake,
      });
    }

    if (secret && controlPlaneSynced) {
      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake,
        secret,
        service,
        state: syncState,
      });
    }

    if (shouldYieldHostedDeviceSync(options.shouldYield ?? null)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        service,
        wake,
      });
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

function shouldYieldHostedDeviceSync(shouldYield: (() => boolean) | null): boolean {
  return shouldYield?.() === true;
}

function buildHostedDeviceSyncYieldedPassResult(input: {
  processedJobs: number;
  service: DeviceSyncService;
  wake: HostedRuntimeEvent;
}): {
  nextWakeAt: string | null;
  postCheckpointRecord: HostedMaintenanceMetrics["postCheckpointRecord"];
  processedJobs: number;
  skipped: boolean;
} {
  return {
    nextWakeAt: resolveHostedDeviceSyncYieldRetryAt(),
    postCheckpointRecord: null,
    processedJobs: input.processedJobs,
    skipped: true,
  };
}

function resolveHostedDeviceSyncYieldRetryAt(now = new Date()): string {
  return new Date(now.getTime() + HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS).toISOString();
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

export async function runHostedDeviceSyncWakeLane(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  platformEnv?: Readonly<Record<string, string>>;
  runtimeLogPlatform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
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
  if (!input.platform?.logPort || input.processedJobs === 0 || !input.state.snapshot) {
    return;
  }

  const baselineByHostedConnectionId = new Map(
    input.state.snapshot.connections.map((entry) => [entry.connection.id, entry]),
  );
  const failureDiagnosticsByLocalAccountId = new Map(
    input.service.listJobFailureDiagnostics().map((entry) => [entry.accountId, entry]),
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
          failureDiagnostic: failureDiagnosticsByLocalAccountId.get(account.id) ?? null,
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
  account: ReturnType<HostedDeviceSyncRuntimeService["listAccounts"]>[number];
  baseline: HostedDeviceSyncRuntimeSnapshotEntry | null;
  failureDiagnostic: DeviceSyncJobFailureDiagnostic | null;
  hostedConnectionKnown: boolean;
  processedJobs: number;
  wake: HostedRuntimeEvent;
}): Record<string, boolean | number | string | null> {
  const summary = sanitizeHostedDeviceSyncFailureSummary(input.account.lastErrorMessage);
  const priorLocalState = input.baseline?.localState ?? null;

  return {
    failureCode: toHostedRuntimeLogCode(input.account.lastErrorCode),
    ...(summary ? { failureSummary: summary } : {}),
    ...buildHostedDeviceSyncFailureDiagnosticRedactedJson(input.failureDiagnostic),
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
  diagnostic: DeviceSyncJobFailureDiagnostic | null,
): Record<string, boolean | number | string | null> {
  if (!diagnostic) {
    return {};
  }

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
