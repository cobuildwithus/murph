import { createHash } from "node:crypto";

import type {
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionRedactedLogEntry,
  HostedExecutionLogLevel,
  HostedExecutionSystemWake,
  HostedExecutionWake,
  HostedExecutionLogPhase,
  HostedExecutionStructuredLogDetails,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantContextFingerprintDetails,
  sendAssistantNotification,
  scheduleDeviceActivityTriggeredAutomations,
  type AssistantExecutionContext,
  type AssistantTurnEnvironment,
} from "@murphai/assistant-engine";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  isHostedConversationMessageWake,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
} from "@murphai/hosted-execution";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { emitHostedAssistantContextTraceLog } from "./context-diagnostics.ts";
import { createHostedAssistantTurnEnvironment } from "./environment.ts";
import { runHostedDeviceSyncWakeLane } from "./maintenance.ts";
import type {
  HostedMailboxEffect,
  HostedMailboxLane,
  HostedMailboxExecutionMetrics,
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  HOSTED_ASSISTANT_WAKE_REASON,
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

type HostedMailboxOutcome = HostedMailboxEffect & {
  mailboxLane: HostedMailboxLane;
};

const DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE =
  "Hosted conversation wakes must be imported through mailbox AssistantInputEvent staging.";
const ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA =
  "murph.assistant-provider-plan-diagnostics.v1";
const ASSISTANT_PROVIDER_PLAN_TRACE_TYPE = "assistant.provider.plan";
const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_SCHEMA =
  "murph.assistant-provider-prompt-size-diagnostics.v1";
const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_TYPE =
  "assistant.provider.prompt_size";
const ASSISTANT_CODEX_INVALID_OUTPUT_TRACE_SCHEMA =
  "murph.assistant-codex-invalid-output-diagnostics.v1";
const ASSISTANT_CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE =
  "assistant.codex.invalid_output_resume_failure";
const ASSISTANT_CODEX_INVALID_OUTPUT_FALLBACK_TRACE_TYPE =
  "assistant.codex.invalid_output_resume_fallback";
const ASSISTANT_CODEX_RESUME_FAILURE_TRACE_SCHEMA =
  "murph.assistant-codex-resume-failure-diagnostics.v1";
const ASSISTANT_CODEX_RESUME_FAILURE_TRACE_TYPE =
  "assistant.codex.resume_failure";
const ASSISTANT_CODEX_APP_SERVER_TIMING_TRACE_SCHEMA =
  "murph.assistant-codex-app-server-timing.v1";
const ASSISTANT_CODEX_APP_SERVER_TIMING_TRACE_TYPE =
  "assistant.codex.app_server_timing";
const ASSISTANT_CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA =
  "murph.assistant-codex-action-diagnostics.v1";
const ASSISTANT_CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE =
  "assistant.codex.action_diagnostics";
const HOSTED_ASSISTANT_CODEX_CONTINUATION_VALUES = new Set([
  "explicit-structured-history",
  "provider-state-optimization",
  "thread-start",
]);
const HOSTED_ASSISTANT_PROVIDER_WORKING_DIRECTORY_KIND_VALUES = new Set([
  "hosted-stable-proc-cwd",
  "raw",
]);
const HOSTED_ASSISTANT_ROUTE_PLANNING_STAGE_VALUES = new Set([
  "active_experiment_context",
  "assistant_context_snapshot",
  "cli_bootstrap",
  "fallback_instructions",
  "memory_overview",
  "primary_instructions",
  "resume_binding",
  "supported_experiment_protocols",
  "target_capabilities",
]);
const HOSTED_ASSISTANT_PROVIDER_PROMPT_DIAGNOSTIC_KIND_VALUES = new Set([
  "fresh-thread-fallback",
  "primary",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_PHASE_VALUES = new Set([
  "fallback-failed",
  "fallback-succeeded",
  "resume-failed",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_RESULT_VALUES = new Set([
  "failed",
  "succeeded",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_ERROR_CODES = new Set([
  "ASSISTANT_CODEX_APPROVAL_POLICY_UNSUPPORTED",
  "ASSISTANT_CODEX_APP_SERVER_FAILED",
  "ASSISTANT_CODEX_APP_SERVER_LIVE_TURN_INACTIVE",
  "ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID",
  "ASSISTANT_CODEX_APP_SERVER_RPC_FAILED",
  "ASSISTANT_CODEX_APP_SERVER_TIMEOUT",
  "ASSISTANT_CODEX_CONNECTION_LOST",
  "ASSISTANT_CODEX_FAILED",
  "ASSISTANT_CODEX_HOME_INVALID",
  "ASSISTANT_CODEX_IMAGE_INVALID",
  "ASSISTANT_CODEX_INTERRUPTED",
  "ASSISTANT_CODEX_NOT_FOUND",
  "ASSISTANT_CODEX_RESUME_STALE",
  "ASSISTANT_CODEX_USAGE_LIMIT",
  "ASSISTANT_PROVIDER_UNSUPPORTED",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_ERROR_KIND_VALUES = new Set([
  "invalid-input-output",
  "invalid-output",
]);
const HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_PHASE_VALUES = new Set([
  "resume-failed",
]);
const HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_ERROR_KIND_VALUES = new Set([
  "codex-failed",
  "connection-lost",
  "invalid-input-output",
  "provider-unsupported",
  "rpc-failed",
  "resume-stale",
  "timeout",
  "turn-failed",
  "unknown",
  "usage-limit",
]);
const HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_ERROR_PHRASE_VALUES = new Set([
  "codex-turn-failed",
  "connection-lost",
  "credits-exhausted",
  "input-output-field",
  "invalid-input",
  "quota-exceeded",
  "rate-limit",
  "resume-stale",
  "status-failed",
  "timeout",
  "usage-limit",
]);
const HOSTED_ASSISTANT_CODEX_PROCESS_SIGNAL_VALUES = new Set([
  "SIGINT",
  "SIGKILL",
  "SIGTERM",
]);
const HOSTED_ASSISTANT_CODEX_PROCESS_LIFECYCLE_STAGE_VALUES = new Set([
  "error_cleanup",
  "initialize",
  "initialized",
  "shutdown",
  "shutdown_complete",
  "spawn_start",
  "spawn_wait",
  "thread-resumed",
  "thread-started",
  "thread_resume",
  "thread_start",
  "turn_completed",
  "turn_running",
  "turn_start",
  "turn_started",
]);
const HOSTED_ASSISTANT_CODEX_APP_SERVER_TIMING_STAGE_VALUES = new Set([
  "initialized",
  "shutdown",
  "spawn-ready",
  "thread-resumed",
  "thread-started",
  "turn-completed",
  "turn-started",
  "warm-abort-poisoned",
  "warm-idle",
  "warm-reused",
]);
const HOSTED_ASSISTANT_CODEX_ACTION_KIND_VALUES = new Set([
  "command.execution",
  "dynamic.tool.call",
  "file.change",
  "mcp.tool.call",
  "web.search",
]);
const HOSTED_ASSISTANT_CODEX_ACTION_TOOL_IDENTIFIER_PART_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_METHOD_VALUES = new Set([
  "initialize",
  "rpc.error",
  "rpc.response",
  "thread/resume",
  "thread/start",
  "turn/completed",
  "turn/interrupt",
  "turn/start",
  "turn/started",
  "turn/steer",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_STRUCTURAL_TOKEN_VALUES = new Set([
  "array",
  "boolean",
  "cancelled",
  "canceled",
  "command.execution",
  "completed",
  "connection_lost",
  "dynamic.tool.call",
  "error",
  "failed",
  "file.change",
  "function_call",
  "function_call_output",
  "image",
  "in_progress",
  "input_image",
  "input_text",
  "interrupted",
  "message",
  "null",
  "number",
  "object",
  "other",
  "process_exit",
  "reasoning",
  "running",
  "string",
  "succeeded",
  "turn_failed",
  "undefined",
  "unknown",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_KEY_BUCKET_VALUES = new Set([
  "[key]",
  "[sensitive-key]",
  "content",
  "id",
  "image_url",
  "kind",
  "method",
  "output",
  "params",
  "status",
  "text",
  "type",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_BOOLEAN_KEYS = [
  "codexInvalidOutputFallbackAttempted",
  "codexInvalidOutputFallbackErrorMessagePresent",
  "codexInvalidOutputFallbackSessionChanged",
  "codexInvalidOutputFallbackSessionPresent",
  "codexInvalidOutputFallbackTurnPresent",
  "codexInvalidOutputFailureSessionPresent",
  "codexInvalidOutputFailureTurnPresent",
  "codexInvalidOutputResumeMatchesFailureSession",
  "codexInvalidOutputResumeSessionPresent",
] as const;
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_NUMBER_KEYS = [
  "codexInvalidOutputFallbackEventCount",
  "codexInvalidOutputFallbackErrorMessageLength",
  "codexInvalidOutputFallbackProviderActionCount",
  "codexInvalidOutputFailureEventCount",
  "codexInvalidOutputFailureProviderActionCount",
  "codexInvalidOutputErrorMessageLength",
  "codexInvalidOutputInputIndex",
] as const;
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_NUMBER_ARRAY_KEYS = [
  "codexInvalidOutputFailureOutputArrayLengths",
  "codexInvalidOutputFailureOutputStringLengths",
] as const;
const HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_BOOLEAN_KEYS = [
  "codexResumeFailureCodexAbortRequested",
  "codexResumeFailureCodexLiveTurnOpen",
  "codexResumeFailureCodexProcessGroupPresent",
  "codexResumeFailureCodexProviderRequestStarted",
  "codexResumeFailureCodexShutdownRequested",
  "codexResumeFailureErrorMessagePresent",
  "codexResumeFailureResumeMatchesFailureSession",
  "codexResumeFailureResumeSessionPresent",
  "codexResumeFailureRetryable",
  "codexResumeFailureSessionPresent",
  "codexResumeFailureTurnPresent",
] as const;
const HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_NUMBER_KEYS = [
  "codexResumeFailureCodexJsonEventCount",
  "codexResumeFailureCodexPendingRpcCount",
  "codexResumeFailureCodexProcessLifetimeMs",
  "codexResumeFailureCodexStderrBytes",
  "codexResumeFailureErrorMessageLength",
  "codexResumeFailureEventCount",
  "codexResumeFailureProviderActionCount",
] as const;
const HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_NUMBER_ARRAY_KEYS = [
  "codexResumeFailureOutputArrayLengths",
  "codexResumeFailureOutputStringLengths",
] as const;
const HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_BOOLEAN_KEYS = [
  "codexActionThreadIdPresent",
  "codexActionTurnIdPresent",
] as const;
const HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_NUMBER_KEYS = [
  "codexActionCachedInputUnitMax",
  "codexActionCommandCount",
  "codexActionCompletedCount",
  "codexActionDurationMsMax",
  "codexActionDurationMsTotal",
  "codexActionDynamicToolCallCount",
  "codexActionEventCount",
  "codexActionFailedCount",
  "codexActionFileChangeCount",
  "codexActionFinalCachedInputUnit",
  "codexActionFinalInputUnit",
  "codexActionFinalOutputUnit",
  "codexActionFinalReasoningOutputUnit",
  "codexActionFinalTotalUnit",
  "codexActionInputUnitMax",
  "codexActionMcpToolCallCount",
  "codexActionOutputBytesMax",
  "codexActionOutputBytesTotal",
  "codexActionOutputItemCount",
  "codexActionOutputUnitMax",
  "codexActionProviderActionCount",
  "codexActionReasoningOutputUnitMax",
  "codexActionStartedCount",
  "codexActionTotalUnitMax",
  "codexActionUsageSampleCount",
  "codexActionWebSearchCount",
] as const;
const HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_NUMBER_ARRAY_KEYS = [
  "codexActionSlowDurationMs",
] as const;
const HOSTED_ASSISTANT_PROVIDER_PROMPT_SIZE_BOOLEAN_KEYS = [
  "conversationContextPresent",
  "developerInstructionsPresent",
  "refreshThreadInstructions",
  "resumeCodexThreadIdPresent",
] as const;
const HOSTED_ASSISTANT_PROVIDER_PROMPT_SIZE_NUMBER_KEYS = [
  "conversationContextBytes",
  "developerInstructionsBytes",
  "providerPromptBytes",
  "systemPromptBytes",
  "turnContextPromptBytes",
  "userPromptBytes",
] as const;
const HOSTED_ASSISTANT_PROVIDER_DIAGNOSTIC_TEXT_MAX_LENGTH = 2048;
const HOSTED_ASSISTANT_PROVIDER_DIAGNOSTIC_TEXT_KEY_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.-]{0,127}(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u;

export async function executeHostedMailboxEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification?: boolean;
  operatorHomeRoot?: string | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId?: string | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<HostedMailboxExecutionMetrics> {
  if (isHostedConversationMessageWake(input.wake)) {
    throw new TypeError(DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE);
  }

  const bootstrapResult = await prepareHostedWakeContext(
    input.vaultRoot,
    input.wake,
    input.runtimeEnv,
    input.runtime.resolvedConfig,
    {
      operatorHomeRoot: input.operatorHomeRoot ?? null,
    },
  );
  const bootstrappedExecutionContext = await hydrateHostedExecutionDefaultTarget(
    input.executionContext,
    {
      homeDirectory: input.operatorHomeRoot ?? undefined,
      runtimeEnv: input.runtimeEnv,
    },
  );
  const mailboxEffect = await handleHostedMailboxEvent({
    wake: input.wake,
    executionContext: bootstrappedExecutionContext,
    forceQueueOnlyAssistantNotification: input.forceQueueOnlyAssistantNotification === true,
    operatorHomeRoot: input.operatorHomeRoot ?? null,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    ...(input.shouldYieldDeviceSync
      ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
      : {}),
    sourceMailboxItemId: input.sourceMailboxItemId ?? null,
    vaultRoot: input.vaultRoot,
  });

  return {
    bootstrapResult,
    conversationMetrics: mailboxEffect.conversationMetrics,
    mailboxLane: mailboxEffect.mailboxLane,
    nextWakeAt: mailboxEffect.nextWakeAt,
    ...(Object.hasOwn(mailboxEffect, "nextWakeReason")
      ? { nextWakeReason: mailboxEffect.nextWakeReason ?? null }
      : {}),
    postCheckpointRecord: mailboxEffect.postCheckpointRecord,
    redactedLogEntries: mailboxEffect.redactedLogEntries ?? [],
  };
}

async function handleHostedMailboxEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification: boolean;
  operatorHomeRoot: string | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId: string | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  if (isHostedConversationMessageWake(input.wake)) {
    throw new TypeError(DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE);
  }

  return executeHostedSystemWake({
    wake: input.wake,
    executionContext: input.executionContext,
    forceQueueOnlyAssistantNotification: input.forceQueueOnlyAssistantNotification,
    operatorHomeRoot: input.operatorHomeRoot,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    ...(input.shouldYieldDeviceSync
      ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
      : {}),
    sourceMailboxItemId: input.sourceMailboxItemId,
    vaultRoot: input.vaultRoot,
  });
}

async function executeHostedSystemWake(input: {
  wake: HostedExecutionSystemWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification: boolean;
  operatorHomeRoot: string | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "platformEnv" | "resolvedConfig"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId: string | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  switch (input.wake.kind) {
    case "member.activated":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-activated",
      });
    case "member.channels.updated":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-channels-updated",
      });
    case "assistant.notification.requested":
      return executeHostedAssistantNotificationWake({
        wake: input.wake,
        executionContext: input.executionContext,
        forceQueueOnly: input.forceQueueOnlyAssistantNotification,
        sourceMailboxItemId: input.sourceMailboxItemId,
        turnEnvironment: createHostedAssistantTurnEnvironment({
          operatorHomeRoot: input.operatorHomeRoot,
          runtimeEnv: input.runtimeEnv,
          vaultRoot: input.vaultRoot,
        }),
        vaultRoot: input.vaultRoot,
      });
    case "device-sync.wake":
      const deviceSyncMetrics = await runHostedDeviceSyncWakeLane({
        deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
        platformEnv: input.runtime.platformEnv,
        runtimeLogPlatform: input.runtime.platform,
        resolvedConfig: input.runtime.resolvedConfig,
        ...(input.shouldYieldDeviceSync
          ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
          : {}),
        timeoutMs: input.runtime.commitTimeoutMs,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
      const activityAutomation = input.shouldYieldDeviceSync?.() === true
        ? { matched: 0, nextWakeAt: null, scheduled: 0 }
        : await scheduleDeviceActivityTriggeredAutomations({
          vault: input.vaultRoot,
        }).catch((error: unknown) => {
          emitHostedDeviceActivityAutomationFailureLog({
            error,
            wake: input.wake,
          });
          return { matched: 0, nextWakeAt: null, scheduled: 0 };
        });
      const nextWake = selectHostedRuntimeWakeCandidate([
        createHostedRuntimeWakeCandidate(
          deviceSyncMetrics.nextWakeAt,
          deviceSyncMetrics.nextWakeReason ?? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        ),
        createHostedRuntimeWakeCandidate(
          activityAutomation.nextWakeAt,
          HOSTED_ASSISTANT_WAKE_REASON,
        ),
      ]);
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: nextWake.at,
        ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
        postCheckpointRecord: deviceSyncMetrics.postCheckpointRecord ?? null,
      });
    case "runtime.manual-requested":
    case "runtime.browser-vault-refresh-requested":
    case "runtime.device-sync-recovery-requested":
    case "runtime.mailbox-lag-observed":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "runtime-control",
      });
  }

  const exhaustiveWake: never = input.wake;
  void exhaustiveWake;
  throw new TypeError('Unsupported hosted system wake kind.');
}

function emitHostedDeviceActivityAutomationFailureLog(input: {
  error: unknown;
  wake: HostedExecutionSystemWake;
}): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      eventCode: "assistant.device_activity_automation_failed",
    },
    error: input.error,
    level: "warn",
    message: "Hosted device activity automation pass failed; continuing device-sync wake.",
    phase: "wake.running",
    wake: input.wake,
  });
}

export async function executeHostedAssistantNotificationWake(input: {
  wake: HostedExecutionAssistantNotificationRequestedWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnly?: boolean;
  sourceMailboxItemId?: string | null;
  turnEnvironment?: AssistantTurnEnvironment | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [
    emitHostedAssistantNotificationLifecycleLog({
      message: "Hosted assistant notification started.",
      phase: "wake.running",
      wake: input.wake,
    }),
  ];

  try {
    await sendAssistantNotification(
      buildAssistantNotificationInput(
        input.wake,
        input.executionContext,
        input.forceQueueOnly === true,
        input.vaultRoot,
        input.sourceMailboxItemId ?? null,
        input.turnEnvironment ?? null,
        (entry) => {
          redactedLogEntries.push(entry);
        },
      ),
    );
  } catch (error) {
    if (!shouldSkipFailedHostedAssistantNotification(input.wake)) {
      redactedLogEntries.push(
        emitHostedAssistantNotificationLifecycleLog({
          error,
          level: "error",
          message: "Hosted assistant notification failed.",
          phase: "failed",
          wake: input.wake,
        }),
      );
      throw error;
    }

    redactedLogEntries.push(emitHostedAssistantNotificationSkipLog(input.wake, error));
    return createNoopMailboxEffect({
      conversationMetrics: null,
      mailboxLane: "assistant-notification",
      redactedLogEntries,
    });
  }

  redactedLogEntries.push(
    emitHostedAssistantNotificationLifecycleLog({
      message: "Hosted assistant notification finished.",
      phase: "wake.running",
      wake: input.wake,
    }),
  );

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "assistant-notification",
    redactedLogEntries,
  });
}

function shouldSkipFailedHostedAssistantNotification(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): boolean {
  return wake.notification.firstContact != null
    || wake.notification.responsePolicy?.kind === "allow_send_or_skip";
}

function emitHostedAssistantNotificationSkipLog(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  error: unknown,
): HostedExecutionRedactedLogEntry {
  return emitHostedAssistantNotificationLifecycleLog({
    error,
    level: "warn",
    message: "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
    phase: "wake.running",
    wake,
  });
}

function buildHostedAssistantNotificationLogDetails(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): HostedExecutionStructuredLogDetails {
  const route = wake.notification.route;
  const delivery = route.delivery;

  return {
    deliveryDedupeTokenPresent: wake.notification.deliveryDedupeToken != null,
    deliveryDispatchMode: wake.notification.deliveryDispatchMode ?? "default",
    firstContact: wake.notification.firstContact != null,
    notificationRouteChannel: route.channel,
    notificationRouteDeliveryKind: route.delivery.kind,
    notificationRouteIdentityPresent: route.identityId != null,
    notificationRouteThreadIdPresent: route.threadId != null,
    notificationRouteThreadIsDirect: route.threadIsDirect,
    responsePolicyKind: wake.notification.responsePolicy?.kind ?? "none",
    ...buildHostedAssistantContextFingerprintDetails({
      actorId: route.actorId,
      channel: route.channel,
      identityId: route.identityId,
      threadId: route.threadId,
      threadIsDirect: route.threadIsDirect,
    }),
  };
}

function createNoopMailboxEffect(input: {
  conversationMetrics: HostedConversationWakeMetrics | null;
  mailboxLane: HostedMailboxLane;
  nextWakeAt?: HostedMailboxOutcome["nextWakeAt"];
  nextWakeReason?: HostedMailboxOutcome["nextWakeReason"];
  postCheckpointRecord?: HostedMailboxOutcome["postCheckpointRecord"];
  redactedLogEntries?: HostedExecutionRedactedLogEntry[];
}): HostedMailboxOutcome {
  return {
    conversationMetrics: input.conversationMetrics,
    nextWakeAt: input.nextWakeAt ?? null,
    ...(input.nextWakeReason === undefined
      ? {}
      : { nextWakeReason: input.nextWakeReason ?? null }),
    mailboxLane: input.mailboxLane,
    postCheckpointRecord: input.postCheckpointRecord ?? null,
    redactedLogEntries: input.redactedLogEntries ?? [],
  };
}

function emitHostedAssistantNotificationLifecycleLog(input: {
  error?: unknown;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedExecutionRedactedLogEntry {
  const details = buildHostedAssistantNotificationLogDetails(input.wake);

  emitHostedExecutionStructuredLog({
    component: "runtime",
    details,
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.level === undefined ? {} : { level: input.level }),
    message: input.message,
    phase: input.phase,
    wake: input.wake,
  });

  return {
    component: "runtime",
    eventId: input.wake.eventId,
    level: input.level ?? (input.error === undefined ? "info" : "error"),
    message: input.message,
    phase: input.phase,
    redacted: {
      ...details,
      ...(extractHostedAssistantNotificationRedactedDetails(input.error) ?? {}),
      ...(input.error === undefined ? {} : { errorCode: deriveHostedExecutionErrorCode(input.error) }),
    },
  };
}

export function emitHostedAssistantProviderTraceLog(input: {
  details?: HostedExecutionStructuredLogDetails | null;
  event: unknown;
  wake: HostedRuntimeEvent;
}): HostedExecutionRedactedLogEntry | null {
  const diagnostic = readHostedAssistantProviderDiagnosticTrace(input.event);
  if (!diagnostic) {
    return null;
  }

  const redactedDiagnostic =
    sanitizeHostedAssistantProviderDiagnosticDetails(diagnostic.details);
  const redactedContext =
    sanitizeHostedExecutionStructuredLogDetails(input.details ?? {}) ?? {};
  const redactedDetails = {
    ...redactedContext,
    ...redactedDiagnostic,
  };

  emitHostedExecutionStructuredLog({
    component: "runtime.provider",
    details: redactedDetails,
    message: diagnostic.message,
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime.provider",
    eventId: input.wake.eventId,
    level: "info",
    message: diagnostic.message,
    phase: "wake.running",
    redacted: redactedDetails,
  };
}

function readHostedAssistantProviderDiagnosticTrace(
  event: unknown,
): {
  details: HostedExecutionStructuredLogDetails;
  message: string;
} | null {
  const planDiagnostic = readHostedAssistantProviderPlanDiagnosticTrace(event);
  if (planDiagnostic) {
    return {
      details: planDiagnostic,
      message: "Hosted assistant provider plan captured.",
    };
  }

  const promptSizeDiagnostic =
    readHostedAssistantProviderPromptSizeDiagnosticTrace(event);
  if (promptSizeDiagnostic) {
    return {
      details: promptSizeDiagnostic,
      message: "Hosted assistant provider prompt-size diagnostics captured.",
    };
  }

  const invalidOutputDiagnostic =
    readHostedAssistantCodexInvalidOutputDiagnosticTrace(event);
  if (invalidOutputDiagnostic) {
    return {
      details: invalidOutputDiagnostic,
      message: "Hosted assistant Codex invalid-output diagnostics captured.",
    };
  }

  const resumeFailureDiagnostic =
    readHostedAssistantCodexResumeFailureDiagnosticTrace(event);
  if (resumeFailureDiagnostic) {
    return {
      details: resumeFailureDiagnostic,
      message: "Hosted assistant Codex resume-failure diagnostics captured.",
    };
  }

  const appServerTimingDiagnostic =
    readHostedAssistantCodexAppServerTimingTrace(event);
  if (appServerTimingDiagnostic) {
    return {
      details: appServerTimingDiagnostic,
      message: "Hosted assistant Codex app-server timing captured.",
    };
  }

  const actionDiagnostic =
    readHostedAssistantCodexActionDiagnosticTrace(event);
  if (actionDiagnostic) {
    return {
      details: actionDiagnostic,
      message: "Hosted assistant Codex action diagnostics captured.",
    };
  }

  return null;
}

function sanitizeHostedAssistantProviderDiagnosticDetails(
  details: HostedExecutionStructuredLogDetails,
): HostedExecutionStructuredLogDetails {
  const sanitized: HostedExecutionStructuredLogDetails = {};

  for (const [key, value] of Object.entries(details)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(key)) {
      continue;
    }

    if (value === null) {
      sanitized[key] = null;
      continue;
    }

    const sanitizedValue = sanitizeHostedExecutionStructuredLogDetails({ [key]: value })?.[key];
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  for (const [key, value] of Object.entries(details)) {
    if (!isHostedAssistantProviderDiagnosticTextKey(key) || typeof value !== "string") {
      continue;
    }

    const text = sanitizeHostedExecutionStructuredLogText(value);
    if (!text || text.length > HOSTED_ASSISTANT_PROVIDER_DIAGNOSTIC_TEXT_MAX_LENGTH) {
      continue;
    }

    sanitized[key] = text;
  }

  return sanitized;
}

function readHostedAssistantProviderPlanDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA
    || type !== ASSISTANT_PROVIDER_PLAN_TRACE_TYPE
  ) {
    return null;
  }

  const codexContinuation =
    readHostedAssistantProviderPlanAllowedString(
      record,
      "codexContinuation",
      HOSTED_ASSISTANT_CODEX_CONTINUATION_VALUES,
    )
    ?? readHostedAssistantProviderPlanAllowedString(
      record,
      "providerContinuation",
      HOSTED_ASSISTANT_CODEX_CONTINUATION_VALUES,
    );
  const workingDirectoryKind = readHostedAssistantProviderPlanAllowedString(
    record,
    "workingDirectoryKind",
    HOSTED_ASSISTANT_PROVIDER_WORKING_DIRECTORY_KIND_VALUES,
  );
  if (!codexContinuation || !workingDirectoryKind) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    codexContinuation,
    providerPlanKind: "provider.plan",
    providerRequestOrdinal:
      readHostedAssistantProviderPlanNullableNumber(record, "providerRequestOrdinal"),
    refreshThreadInstructions:
      readHostedAssistantProviderPlanBoolean(record, "refreshThreadInstructions"),
    resumeCodexThreadIdPresent:
      readHostedAssistantProviderPlanBoolean(record, "resumeCodexThreadIdPresent")
        ?? readHostedAssistantProviderPlanBoolean(record, "resumeProviderSessionIdPresent"),
    workingDirectoryKind,
  };

  for (const key of [
    "routePlanningActiveExperimentContextElapsedMs",
    "routePlanningAssistantContextSnapshotElapsedMs",
    "routePlanningCliBootstrapElapsedMs",
    "routePlanningElapsedMs",
    "routePlanningFallbackInstructionsElapsedMs",
    "routePlanningFreshThreadFallbackPromptElapsedMs",
    "routePlanningMemoryOverviewElapsedMs",
    "routePlanningMeasuredElapsedMs",
    "routePlanningPrimaryInstructionsElapsedMs",
    "routePlanningPrimarySystemPromptElapsedMs",
    "routePlanningResumeBindingElapsedMs",
    "routePlanningSlowestStageElapsedMs",
    "routePlanningSupportedExperimentProtocolsElapsedMs",
    "routePlanningTargetCapabilitiesElapsedMs",
    "routePlanningUnaccountedElapsedMs",
    "routePlanningVaultOverviewElapsedMs",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
    );
  }
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "routePlanningSlowestStage",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "routePlanningSlowestStage",
      HOSTED_ASSISTANT_ROUTE_PLANNING_STAGE_VALUES,
    ),
  );
  for (const key of [
    "routePlanningAnyBootstrapContextPrepared",
    "routePlanningBootstrapContextPrepared",
    "routePlanningFreshThreadFallbackPrepared",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticBoolean(record, key),
    );
  }

  return details;
}

function readHostedAssistantProviderPromptSizeDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_SCHEMA
    || type !== ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_TYPE
  ) {
    return null;
  }

  const diagnosticKind = readHostedAssistantProviderDiagnosticAllowedString(
    record,
    "providerPromptDiagnosticKind",
    HOSTED_ASSISTANT_PROVIDER_PROMPT_DIAGNOSTIC_KIND_VALUES,
  );
  if (!diagnosticKind) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    providerPromptDiagnosticKind: diagnosticKind,
    providerTraceKind: "provider.prompt_size",
    schema: ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_SCHEMA,
  };
  for (const key of HOSTED_ASSISTANT_PROVIDER_PROMPT_SIZE_BOOLEAN_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticBoolean(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_PROVIDER_PROMPT_SIZE_NUMBER_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
    );
  }

  return details;
}

function readHostedAssistantCodexInvalidOutputDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_CODEX_INVALID_OUTPUT_TRACE_SCHEMA
    || (
      type !== ASSISTANT_CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE
      && type !== ASSISTANT_CODEX_INVALID_OUTPUT_FALLBACK_TRACE_TYPE
    )
  ) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    codexInvalidOutputTraceType:
      type === ASSISTANT_CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE
        ? "failure"
        : "fallback",
    providerTraceKind:
      type === ASSISTANT_CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE
        ? "codex.invalid_output_resume_failure"
        : "codex.invalid_output_resume_fallback",
    schema: ASSISTANT_CODEX_INVALID_OUTPUT_TRACE_SCHEMA,
  };

  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexInvalidOutputPhase",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexInvalidOutputPhase",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_PHASE_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexInvalidOutputFallbackResult",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexInvalidOutputFallbackResult",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_RESULT_VALUES,
    ),
  );

  for (const key of HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_BOOLEAN_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticBoolean(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_NUMBER_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
    );
  }

  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexInvalidOutputErrorCode",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexInvalidOutputErrorCode",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_ERROR_CODES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexInvalidOutputFallbackErrorCode",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexInvalidOutputFallbackErrorCode",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_ERROR_CODES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexInvalidOutputErrorField",
    readHostedAssistantCodexInvalidOutputField(record),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexInvalidOutputErrorKind",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexInvalidOutputErrorKind",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_ERROR_KIND_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexInvalidOutputFailureEventMethods",
    readHostedAssistantProviderDiagnosticAllowedStringArray(
      record,
      "codexInvalidOutputFailureEventMethods",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_METHOD_VALUES,
    ),
  );
  for (const key of [
    "codexInvalidOutputFailureEventKinds",
    "codexInvalidOutputFailureEventStatuses",
    "codexInvalidOutputFailureOutputKinds",
    "codexInvalidOutputFailureOutputPartTypes",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticAllowedStringArray(
        record,
        key,
        HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_STRUCTURAL_TOKEN_VALUES,
      ),
    );
  }
  for (const key of [
    "codexInvalidOutputFailureOutputObjectKeys",
    "codexInvalidOutputFailureParamKeys",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticKeySummaryArray(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_NUMBER_ARRAY_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNumberArray(record, key),
    );
  }

  return details;
}

function readHostedAssistantCodexResumeFailureDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_CODEX_RESUME_FAILURE_TRACE_SCHEMA
    || type !== ASSISTANT_CODEX_RESUME_FAILURE_TRACE_TYPE
  ) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    codexResumeFailureTraceType: "failure",
    providerTraceKind: "codex.resume_failure",
    schema: ASSISTANT_CODEX_RESUME_FAILURE_TRACE_SCHEMA,
  };

  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailurePhase",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailurePhase",
      HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_PHASE_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureErrorCode",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureErrorCode",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_ERROR_CODES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureErrorKind",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureErrorKind",
      HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_ERROR_KIND_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureErrorMessage",
    readHostedAssistantProviderDiagnosticText(record, "codexResumeFailureErrorMessage"),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureCodexFailureStage",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureCodexFailureStage",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_STRUCTURAL_TOKEN_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureCodexTurnStatus",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureCodexTurnStatus",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_STRUCTURAL_TOKEN_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureCodexExitSignal",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureCodexExitSignal",
      HOSTED_ASSISTANT_CODEX_PROCESS_SIGNAL_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureCodexLifecycleStage",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureCodexLifecycleStage",
      HOSTED_ASSISTANT_CODEX_PROCESS_LIFECYCLE_STAGE_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureCodexPendingRpcMethod",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureCodexPendingRpcMethod",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_METHOD_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureCodexTerminationSignalSent",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "codexResumeFailureCodexTerminationSignalSent",
      HOSTED_ASSISTANT_CODEX_PROCESS_SIGNAL_VALUES,
    ),
  );
  for (const key of HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_BOOLEAN_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticBoolean(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_NUMBER_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
    );
  }
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureEventMethods",
    readHostedAssistantProviderDiagnosticAllowedStringArray(
      record,
      "codexResumeFailureEventMethods",
      HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_METHOD_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexResumeFailureErrorPhrases",
    readHostedAssistantProviderDiagnosticAllowedStringArray(
      record,
      "codexResumeFailureErrorPhrases",
      HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_ERROR_PHRASE_VALUES,
    ),
  );
  for (const key of [
    "codexResumeFailureEventKinds",
    "codexResumeFailureEventStatuses",
    "codexResumeFailureOutputKinds",
    "codexResumeFailureOutputPartTypes",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticAllowedStringArray(
        record,
        key,
        HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_STRUCTURAL_TOKEN_VALUES,
      ),
    );
  }
  for (const key of [
    "codexResumeFailureOutputObjectKeys",
    "codexResumeFailureParamKeys",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticKeySummaryArray(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_CODEX_RESUME_FAILURE_NUMBER_ARRAY_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNumberArray(record, key),
    );
  }

  return details;
}

function readHostedAssistantCodexAppServerTimingTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_CODEX_APP_SERVER_TIMING_TRACE_SCHEMA
    || type !== ASSISTANT_CODEX_APP_SERVER_TIMING_TRACE_TYPE
  ) {
    return null;
  }

  const stage = readHostedAssistantProviderDiagnosticAllowedString(
    record,
    "codexTimingStage",
    HOSTED_ASSISTANT_CODEX_APP_SERVER_TIMING_STAGE_VALUES,
  );
  if (!stage) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    codexTimingStage: stage,
    codexTimingTraceType: "app-server",
    providerTraceKind: "codex.app_server_timing",
    schema: ASSISTANT_CODEX_APP_SERVER_TIMING_TRACE_SCHEMA,
  };
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingElapsedMs",
    readHostedAssistantProviderDiagnosticNonnegativeNumber(record, "codexTimingElapsedMs"),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingProviderActionCount",
    readHostedAssistantProviderDiagnosticNonnegativeNumber(record, "codexTimingProviderActionCount"),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingThreadIdPresent",
    readHostedAssistantProviderDiagnosticBoolean(record, "codexTimingThreadIdPresent")
      ?? readHostedAssistantProviderDiagnosticBoolean(record, "codexTimingProviderSessionIdPresent"),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingTotalElapsedMs",
    readHostedAssistantProviderDiagnosticNonnegativeNumber(record, "codexTimingTotalElapsedMs"),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingTurnIdPresent",
    readHostedAssistantProviderDiagnosticBoolean(record, "codexTimingTurnIdPresent"),
  );

  return details;
}

function readHostedAssistantCodexActionDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA
    || type !== ASSISTANT_CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE
  ) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    codexActionTraceType: "action-diagnostics",
    providerTraceKind: "codex.action_diagnostics",
    schema: ASSISTANT_CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA,
  };

  for (const key of HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_BOOLEAN_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticBoolean(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_NUMBER_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_NUMBER_ARRAY_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNumberArray(record, key),
    );
  }
  for (const key of [
    "codexActionKinds",
    "codexActionSlowKinds",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticAllowedStringArray(
        record,
        key,
        HOSTED_ASSISTANT_CODEX_ACTION_KIND_VALUES,
      ),
    );
  }
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexActionToolSummaries",
    readHostedAssistantProviderDiagnosticToolSummaryArray(
      record,
      "codexActionToolSummaries",
    ),
  );
  return details;
}

function readHostedAssistantProviderRawTraceRecord(
  event: unknown,
): Record<string, unknown> | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  const rawEvent = (event as { rawEvent?: unknown }).rawEvent;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  return rawEvent as Record<string, unknown>;
}

function maybeSetHostedAssistantProviderDiagnosticDetail(
  details: HostedExecutionStructuredLogDetails,
  key: string,
  value: HostedExecutionStructuredLogDetails[string] | undefined,
): void {
  if (value !== undefined) {
    details[key] = value;
  }
}

function readHostedAssistantProviderPlanBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readHostedAssistantProviderPlanNullableNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readHostedAssistantProviderPlanAllowedString(
  record: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
): string | null {
  const value = readHostedAssistantProviderPlanString(record, key);
  return value && allowedValues.has(value) ? value : null;
}

function readHostedAssistantProviderPlanString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
}

function readHostedAssistantProviderDiagnosticBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  return value === null || typeof value === "boolean" ? value : undefined;
}

function readHostedAssistantProviderDiagnosticNonnegativeNumber(
  record: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readHostedAssistantProviderDiagnosticAllowedString(
  record: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
): string | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  const stringValue = readHostedAssistantProviderPlanString(record, key);
  return stringValue && allowedValues.has(stringValue) ? stringValue : undefined;
}

function readHostedAssistantProviderDiagnosticText(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }
  if (!isHostedAssistantProviderDiagnosticTextKey(key) || typeof value !== "string") {
    return undefined;
  }

  const normalized = sanitizeHostedExecutionStructuredLogText(value);
  return normalized
    && normalized.length <= HOSTED_ASSISTANT_PROVIDER_DIAGNOSTIC_TEXT_MAX_LENGTH
    ? normalized
    : undefined;
}

function isHostedAssistantProviderDiagnosticTextKey(key: string): boolean {
  return HOSTED_ASSISTANT_PROVIDER_DIAGNOSTIC_TEXT_KEY_PATTERN.test(key);
}

function readHostedAssistantCodexInvalidOutputField(
  record: Record<string, unknown>,
): string | null | undefined {
  const key = "codexInvalidOutputErrorField";
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  const stringValue = readHostedAssistantProviderPlanString(record, key);
  return stringValue && /^input\.\d+\.output$/u.test(stringValue)
    ? stringValue
    : undefined;
}

function readHostedAssistantProviderDiagnosticAllowedStringArray(
  record: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
): string[] | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return [];
    }
    const normalized = entry.trim();
    return allowedValues.has(normalized) ? [normalized] : [];
  });
  return output.length > 0 ? output : undefined;
}

function readHostedAssistantProviderDiagnosticToolSummaryArray(
  record: Record<string, unknown>,
  key: string,
): HostedExecutionStructuredLogDetails[] | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry): HostedExecutionStructuredLogDetails[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const entryRecord = entry as Record<string, unknown>;
    const kind = readHostedAssistantProviderPlanAllowedString(
      entryRecord,
      "kind",
      HOSTED_ASSISTANT_CODEX_ACTION_KIND_VALUES,
    );
    const callCount = readHostedAssistantProviderDiagnosticNonnegativeNumber(
      entryRecord,
      "callCount",
    );
    const outputBytesMax = readHostedAssistantProviderDiagnosticNonnegativeNumber(
      entryRecord,
      "outputBytesMax",
    );
    const outputBytesTotal = readHostedAssistantProviderDiagnosticNonnegativeNumber(
      entryRecord,
      "outputBytesTotal",
    );
    if (
      !kind
      || typeof callCount !== "number"
      || typeof outputBytesMax !== "number"
      || typeof outputBytesTotal !== "number"
    ) {
      return [];
    }

    const summary: HostedExecutionStructuredLogDetails = {
      callCount,
      kind,
      outputBytesMax,
      outputBytesTotal,
    };
    maybeSetHostedAssistantProviderDiagnosticDetail(
      summary,
      "namespacePresent",
      readHostedAssistantProviderDiagnosticBoolean(entryRecord, "namespacePresent"),
    );
    maybeSetHostedAssistantProviderDiagnosticDetail(
      summary,
      "serverPresent",
      readHostedAssistantProviderDiagnosticBoolean(entryRecord, "serverPresent"),
    );
    maybeSetHostedAssistantProviderDiagnosticDetail(
      summary,
      "tool",
      readHostedAssistantProviderDiagnosticToolIdentifierPart(entryRecord, "tool"),
    );
    return [summary];
  });
  return output.length > 0 ? output : undefined;
}

function readHostedAssistantProviderDiagnosticToolIdentifierPart(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return HOSTED_ASSISTANT_CODEX_ACTION_TOOL_IDENTIFIER_PART_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

function readHostedAssistantProviderDiagnosticKeySummaryArray(
  record: Record<string, unknown>,
  key: string,
): string[] | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return [];
    }
    const tokens = entry.split(",");
    return tokens.length > 0
      && tokens.every((token) =>
        HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_KEY_BUCKET_VALUES.has(token),
      )
      ? [tokens.join(",")]
      : [];
  });
  return output.length > 0 ? output : undefined;
}

function readHostedAssistantProviderDiagnosticNumberArray(
  record: Record<string, unknown>,
  key: string,
): number[] | null | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const value = record[key];
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry) =>
    typeof entry === "number" && Number.isFinite(entry) && entry >= 0
      ? [entry]
      : [],
  );
  return output.length > 0 ? output : undefined;
}

function buildAssistantNotificationInput(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  executionContext: AssistantExecutionContext,
  forceQueueOnly: boolean,
  vault: string,
  sourceMailboxItemId: string | null,
  turnEnvironment: AssistantTurnEnvironment | null,
  recordLogEntry: (entry: HostedExecutionRedactedLogEntry) => void,
): Parameters<typeof sendAssistantNotification>[0] {
  const route = wake.notification.route;
  const delivery = route.delivery;

  return {
    actorId: route.actorId,
    bindingDeliveryTarget:
      delivery.kind === "explicit" ? null : delivery.target,
    channel: route.channel,
    deliveryDedupeToken: wake.notification.deliveryDedupeToken ?? null,
    deliveryDispatchMode: forceQueueOnly
      ? "queue-only"
      : wake.notification.deliveryDispatchMode ?? undefined,
    deliveryIdempotencyKey: wake.notification.deliveryIdempotencyKey ?? null,
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: "assistant-notification:1",
      conversationId: hashHostedAssistantNotificationDeliveryKeyParts([
        route.channel,
        route.identityId,
        route.actorId,
        route.threadId,
        route.threadIsDirect,
      ]),
      inboundMailboxItemIds: [
        sourceMailboxItemId ?? wake.eventId,
      ],
      recipientKey: hashHostedAssistantNotificationDeliveryKeyParts([
        route.channel,
        delivery.kind,
        delivery.target,
        route.identityId,
        route.actorId,
        route.threadId,
      ]),
    },
    deliveryKind: delivery.kind === "explicit" ? null : delivery.kind,
    deliverySource: delivery.source ?? null,
    deliveryTarget: delivery.kind === "explicit" ? delivery.target : null,
    executionContext,
    firstContactPolicy: wake.notification.firstContact
      ? {
          markSeenOnDeliveryAccepted:
            wake.notification.firstContact.markSeenOnDeliveryAccepted,
        }
      : null,
    identityId: route.identityId,
    instructions: wake.notification.instructions,
    onTraceEvent(event) {
      const contextEntry = emitHostedAssistantContextTraceLog({
        event,
        wake,
      });
      if (contextEntry) {
        recordLogEntry(contextEntry);
      }
      const entry = emitHostedAssistantProviderTraceLog({
        details: buildHostedAssistantNotificationLogDetails(wake),
        event,
        wake,
      });
      if (entry) {
        recordLogEntry(entry);
      }
    },
    responsePolicy: wake.notification.responsePolicy ?? null,
    threadId: route.threadId,
    threadIsDirect: route.threadIsDirect,
    turnEnvironment,
    turnTrigger: "automation-cron",
    vault,
  };
}

function hashHostedAssistantNotificationDeliveryKeyParts(
  parts: readonly (boolean | null | string | undefined)[],
): string {
  return `sha256:${createHash("sha256")
    .update("murph.hosted-notification-delivery-key.v1")
    .update("\0")
    .update(JSON.stringify(parts.map((part) => part ?? null)))
    .digest("hex")}`;
}
