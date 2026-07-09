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

import type {
  HostedAssistantAutomationLaneMetrics,
  HostedMaintenanceMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
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
  readHostedIngressLatencySource,
} from "@murphai/hosted-execution/runtime-control";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
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
} from "./runtime-logs.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
import { emitHostedAssistantTurnTimingTraceLog } from "./turn-timing-diagnostics.ts";
import { normalizeHostedFutureWakeAt } from "./wake-time.ts";

const HOSTED_ASSISTANT_BACKGROUND_AUTOMATION_SCAN_LIMIT = 1;

const HOSTED_ASSISTANT_AUTOMATION_REDACTED_EVENT_LOG_LIMIT = 12;
const HOSTED_ASSISTANT_INPUT_QUERY_REDACTED_LOG_LIMIT = 20;

type HostedBackgroundDynamicContextPromptBuilder = (input: {
  signal?: AbortSignal;
}) => Promise<string | null>;

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
  buildBackgroundDynamicContextPrompt?: HostedBackgroundDynamicContextPromptBuilder;
  runtimeEnv?: Readonly<Record<string, string>>;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
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
          buildBackgroundDynamicContextPrompt:
            input.buildBackgroundDynamicContextPrompt,
          latencyTracePort: input.runtime.platform.latencyTracePort ?? null,
          runtimeAttemptId: input.runtimeAttemptId ?? null,
          ...(input.shouldYieldBackgroundMaintenance
            ? {
                shouldYieldBackgroundMaintenance:
                  input.shouldYieldBackgroundMaintenance,
              }
            : {}),
        },
      )
    : {
        currentTurnDeliveryIntentIds: [],
        cronProcessed: 0,
        nextWakeAt: null,
        progressed: false,
        redactedLogEntries: [],
        replyFailed: 0,
        terminalLinqCleanup: null,
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
    assistantAutomationCronProcessed: assistantResult.cronProcessed,
    assistantAutomationCronStatusDeferred:
      assistantResult.timings?.cronStatusDeferred ?? null,
    assistantAutomationCronStatusElapsedMs:
      assistantResult.timings?.cronStatusElapsedMs ?? null,
    assistantAutomationPostScanTailElapsedMs:
      assistantResult.timings?.postScanTailElapsedMs ?? null,
    assistantAutomationProgressed: assistantResult.progressed,
    assistantAutomationReplyFailed: assistantResult.replyFailed,
    assistantAutomationScanElapsedMs: assistantResult.timings?.scanElapsedMs ?? null,
    assistantAutomationTerminalLinqCleanup: assistantResult.terminalLinqCleanup,
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
  options?: {
    buildBackgroundDynamicContextPrompt?: HostedBackgroundDynamicContextPromptBuilder;
    latencyTracePort?: HostedRuntimePlatform["latencyTracePort"] | null;
    runtimeAttemptId?: string | null;
    shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  },
): Promise<{
  currentTurnDeliveryIntentIds: string[];
  cronProcessed: number;
  nextWakeAt: string | null;
  progressed: boolean;
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
  replyFailed: number;
  terminalLinqCleanup: string[] | null;
  timings?: {
    activeTurnInputIngested?: boolean | null;
    afterStateElapsedMs: number;
    beforeStateElapsedMs: number;
    cronStatusDeferred?: boolean | null;
    cronStatusElapsedMs?: number | null;
    inputCandidateListed?: boolean | null;
    inputCandidateQueryCount?: number | null;
    passElapsedMs: number;
    postScanTailElapsedMs?: number | null;
    scanElapsedMs?: number | null;
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
  const shouldDeferCronForSelectedForegroundInput =
    selectedInputIds.mode === "foreground" && selectedInputIds.inputIds.length > 0;
  const shouldDeferCron = shouldDeferCronForSelectedForegroundInput
    ? () => true
    : options?.shouldYieldBackgroundMaintenance;
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
    async refresh(refreshInput) {
      const result = await baseInputSource.refresh(refreshInput);
      if (
        selectedInputIds.mode === "background"
        && result.progressed
        && result.reason === "ingested_input"
      ) {
        activeTurnInputIngested = true;
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
  let passStartedAt: number | null = null;
  try {
    passStartedAt = Date.now();
    const maxPerScan = selectedInputIds.mode === "foreground"
      ? Math.max(1, selectedInputIds.inputIds.length)
      : HOSTED_ASSISTANT_BACKGROUND_AUTOMATION_SCAN_LIMIT;
    const buildBackgroundDynamicContextPrompt =
      selectedInputIds.mode === "background"
      && selectedInputIds.inputIds.length === 0
        ? options?.buildBackgroundDynamicContextPrompt
        : undefined;

    const result = await runAssistantAutomationPass({
      ...(buildBackgroundDynamicContextPrompt
        ? { buildDynamicContextPrompt: buildBackgroundDynamicContextPrompt }
        : {}),
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
          latencyTracePort: options?.latencyTracePort ?? null,
          runtimeAttemptId: options?.runtimeAttemptId ?? null,
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
        const turnTimingEntry = emitHostedAssistantTurnTimingTraceLog({
          event,
          wake,
        });
        if (turnTimingEntry) {
          redactedLogEntries.push(turnTimingEntry);
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
      ...(shouldDeferCron ? { shouldDeferCron } : {}),
      signal,
      shouldYieldBackgroundMaintenance: options?.shouldYieldBackgroundMaintenance ?? null,
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
      cronProcessed: result.cronProcessed,
      nextWakeAt,
      progressed: result.progressed,
      redactedLogEntries,
      replyFailed: replies.failed,
      terminalLinqCleanup: replies.terminalLinqCleanup ?? null,
      timings: {
        activeTurnInputIngested,
        afterStateElapsedMs,
        beforeStateElapsedMs,
        cronStatusDeferred: result.passTiming?.cronStatusDeferred ?? null,
        cronStatusElapsedMs: result.passTiming?.cronStatusElapsedMs ?? null,
        inputCandidateListed,
        inputCandidateQueryCount,
        passElapsedMs,
        postScanTailElapsedMs: result.passTiming?.postScanTailElapsedMs ?? null,
        scanElapsedMs: result.passTiming?.scanElapsedMs ?? null,
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
        cronProcessed: 0,
        nextWakeAt,
        progressed: true,
        redactedLogEntries,
        replyFailed: 0,
        terminalLinqCleanup: null,
      };
    }

    redactedLogEntries.push(emitHostedRuntimeRedactedLog({
      component: "runtime",
      details: {
        requestId,
      },
      error,
      level: "error",
      wake,
      message: "Hosted assistant automation pass failed.",
      phase: "failed",
    }));
    attachHostedAssistantAutomationFailureLogEntries(error, redactedLogEntries);
    throw error;
  }
}

function attachHostedAssistantAutomationFailureLogEntries(
  error: unknown,
  redactedLogEntries: readonly HostedExecutionRedactedLogEntry[],
): void {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return;
  }

  Object.defineProperty(error, "hostedAssistantAutomationRedactedLogEntries", {
    configurable: true,
    enumerable: false,
    value: [...redactedLogEntries],
  });
}

function recordHostedAssistantProviderStartLatencyTraceBestEffort(input: {
  admissionMs?: number;
  assistantInputIds: readonly string[];
  codexAppServerInitializeMs?: number;
  codexAppServerPreProviderMs?: number;
  codexAppServerSpawnReadyMs?: number;
  codexAppServerThreadResumeMs?: number;
  codexAppServerThreadStartMs?: number;
  codexAppServerWarmReuseMs?: number;
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
  const source = readHostedIngressLatencySource(input.source);
  if (!source) {
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
    ...(input.codexAppServerInitializeMs === undefined
      ? {}
      : { codexAppServerInitializeMs: input.codexAppServerInitializeMs }),
    ...(input.codexAppServerPreProviderMs === undefined
      ? {}
      : { codexAppServerPreProviderMs: input.codexAppServerPreProviderMs }),
    ...(input.codexAppServerSpawnReadyMs === undefined
      ? {}
      : { codexAppServerSpawnReadyMs: input.codexAppServerSpawnReadyMs }),
    ...(input.codexAppServerThreadResumeMs === undefined
      ? {}
      : { codexAppServerThreadResumeMs: input.codexAppServerThreadResumeMs }),
    ...(input.codexAppServerThreadStartMs === undefined
      ? {}
      : { codexAppServerThreadStartMs: input.codexAppServerThreadStartMs }),
    ...(input.codexAppServerWarmReuseMs === undefined
      ? {}
      : { codexAppServerWarmReuseMs: input.codexAppServerWarmReuseMs }),
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
      source,
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
    "cron.occurrence.expired",
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

export function runHostedNoopSystemWakeLane(): HostedMaintenanceMetrics {
  return {
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
    postCheckpointRecord: null,
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
