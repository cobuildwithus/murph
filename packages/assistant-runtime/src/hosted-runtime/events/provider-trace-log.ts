import type {
  HostedExecutionRedactedLogEntry,
  HostedExecutionStructuredLogDetails,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
} from "@murphai/hosted-execution";
import { emitHostedAssistantContextTraceLog } from "../context-diagnostics.ts";

const ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA =
  "murph.assistant-provider-plan-diagnostics.v1";
const ASSISTANT_PROVIDER_PLAN_TRACE_TYPE = "assistant.provider.plan";
const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_SCHEMA =
  "murph.assistant-provider-prompt-size-diagnostics.v1";
const ASSISTANT_PROVIDER_PROMPT_SIZE_TRACE_TYPE =
  "assistant.provider.prompt_size";
const ASSISTANT_CODEX_APP_SERVER_TIMING_TRACE_SCHEMA =
  "murph.assistant-codex-app-server-timing.v1";
const ASSISTANT_CODEX_APP_SERVER_TIMING_TRACE_TYPE =
  "assistant.codex.app_server_timing";
const ASSISTANT_CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA =
  "murph.assistant-codex-transport-diagnostics.v1";
const ASSISTANT_CODEX_TRANSPORT_DIAGNOSTICS_TRACE_TYPE =
  "assistant.codex.transport_diagnostics";
const ASSISTANT_CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA =
  "murph.assistant-codex-action-diagnostics.v1";
const ASSISTANT_CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE =
  "assistant.codex.action_diagnostics";
const ASSISTANT_CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_SCHEMA =
  "murph.assistant-codex-generated-audio-phase-timing.v1";
const ASSISTANT_CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_TYPE =
  "assistant.codex.generated_audio_phase_timing";
const HOSTED_ASSISTANT_CODEX_CONTINUATION_VALUES = new Set([
  "explicit-structured-history",
  "provider-state-optimization",
  "thread-start",
]);
const HOSTED_ASSISTANT_PROVIDER_WORKING_DIRECTORY_KIND_VALUES = new Set([
  "hosted-stable-proc-cwd",
  "raw",
]);
const HOSTED_ASSISTANT_REASONING_EFFORT_VALUES = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
]);
const HOSTED_ASSISTANT_THREAD_ROTATION_REASON_VALUES = new Set([
  "binding_absent", "route_mismatch", "contract_mismatch", "profile_isolated", "native_resume_disabled", "transcript_bookmark_missing",
]);
const HOSTED_ASSISTANT_ROUTE_PLANNING_STAGE_VALUES = new Set([
  "assistant_context_snapshot",
  "assistant_context_snapshot_refresh",
  "follow_up_context",
  "cli_bootstrap",
  "primary_instructions",
  "resume_binding",
]);
const HOSTED_ASSISTANT_PROVIDER_PROMPT_DIAGNOSTIC_KIND_VALUES = new Set([
  "primary",
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
  "preinitialized",
  "spawn-ready",
  "thread-resumed",
  "thread-started",
  "turn-completed",
  "turn-started",
  "warm-idle",
  "warm-reused",
  "provider-output-received",
  "assistant-output-received",
]);
const HOSTED_ASSISTANT_CODEX_RECEIPT_KIND_VALUES = new Set(["assistant", "reasoning", "tool"]);
const HOSTED_ASSISTANT_CODEX_APP_SERVER_COLD_START_REASON_VALUES = new Set([
  "node-process-first-use",
  "previous-explicit-stop",
  "previous-idle-compaction-failure",
  "previous-launch-identity-change",
  "previous-process-exit",
  "previous-process-unhealthy",
  "previous-turn-abort",
  "previous-turn-failure",
]);
const HOSTED_ASSISTANT_CODEX_TRANSPORT_TIMEOUT_PHASE_VALUES = new Set([
  "websocket-send", "websocket-ack", "websocket-read", "http-read",
]);
const HOSTED_ASSISTANT_CODEX_TRANSPORT_EVENT_KIND_VALUES = new Set([
  "stream-disconnected",
  "stream-idle-timeout",
  "stream-retry",
  "transport-fallback",
]);
const HOSTED_ASSISTANT_CODEX_TRANSPORT_METHOD_VALUES = new Set([
  "error",
  "warning",
]);
const HOSTED_ASSISTANT_CODEX_TRANSPORT_SCOPE_VALUES = new Set(["turn", "thread", "unscoped"]);
const HOSTED_ASSISTANT_CODEX_TRANSPORT_VALUES = new Set([
  "http",
  "unknown",
  "websocket",
]);
const HOSTED_ASSISTANT_CODEX_ACTION_KIND_VALUES = new Set([
  "command.execution",
  "dynamic.tool.call",
  "file.change",
  "mcp.tool.call",
  "web.search",
]);
const HOSTED_ASSISTANT_GENERATED_AUDIO_DELIVERY_MODE_VALUES = new Set([
  "deferred",
  "synchronous",
]);
const HOSTED_ASSISTANT_GENERATED_AUDIO_KIND_VALUES = new Set([
  "song",
  "voice_memo",
]);
const HOSTED_ASSISTANT_GENERATED_AUDIO_OUTCOME_VALUES = new Set([
  "aborted",
  "deferred",
  "generation_failed",
  "invalid_audio",
  "succeeded",
  "upload_failed",
]);
const HOSTED_ASSISTANT_GENERATED_AUDIO_TERMINAL_PHASE_VALUES = new Set([
  "delivery",
  "generation",
  "upload",
]);
const HOSTED_ASSISTANT_CODEX_ACTION_TOOL_IDENTIFIER_PART_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_BOOLEAN_KEYS = [
  "codexActionThreadIdPresent",
  "codexActionTurnIdPresent",
] as const;
const HOSTED_ASSISTANT_CODEX_TRANSPORT_DIAGNOSTIC_BOOLEAN_KEYS = [
  "codexTransportAdditionalDetailsPresent",
  "codexTransportErrorMessagePresent",
  "codexTransportFallbackActivated",
  "codexTransportIdleTimeout",
  "codexTransportRetryExhausted",
  "codexTransportStreamDisconnected",
  "codexTransportTerminalAfterProviderAction",
  "codexTransportThreadIdPresent",
  "codexTransportTurnIdPresent",
  "codexTransportWillRetry",
  "codexTransportWarmReused",
] as const;
const HOSTED_ASSISTANT_CODEX_TRANSPORT_DIAGNOSTIC_NUMBER_KEYS = [
  "codexTransportErrorMessageLength",
  "codexTransportElapsedMs",
  "codexTransportProviderRequestOrdinal",
  "codexTransportTurnCorrelation",
  "codexTransportProviderActionCount",
  "codexTransportRetryCount",
  "codexTransportRetryMax",
] as const;
const HOSTED_ASSISTANT_CODEX_ACTION_DIAGNOSTIC_NUMBER_KEYS = [
  "codexActionTurnCorrelation",
  "codexActionProgressUpdateCallCount",
  "codexActionProgressUpdateFirstCallElapsedMs",
  "codexActionProgressUpdateSentCount",
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
  "conversationHistoryPresent",
  "developerInstructionsPresent",
  "messageTargetDynamicToolsAvailable",
  "resumeCodexThreadIdPresent",
] as const;
const HOSTED_ASSISTANT_PROVIDER_PROMPT_SIZE_NUMBER_KEYS = [
  "baseInstructionsBytes",
  "conversationContextBytes",
  "conversationHistoryBytes",
  "conversationHistoryCount",
  "developerInstructionsBytes",
  "dynamicToolCount",
  "providerPromptBytes",
  "systemPromptBytes",
  "turnContextPromptBytes",
  "userPromptBytes",
] as const;
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

  const appServerTimingDiagnostic =
    readHostedAssistantCodexAppServerTimingTrace(event);
  if (appServerTimingDiagnostic) {
    return {
      details: appServerTimingDiagnostic,
      message: "Hosted assistant Codex app-server timing captured.",
    };
  }

  const transportDiagnostic =
    readHostedAssistantCodexTransportDiagnosticTrace(event);
  if (transportDiagnostic) {
    return {
      details: transportDiagnostic,
      message: "Hosted assistant Codex transport diagnostics captured.",
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

  const generatedAudioTiming =
    readHostedAssistantCodexGeneratedAudioPhaseTimingTrace(event);
  if (generatedAudioTiming) {
    return {
      details: generatedAudioTiming,
      message: "Hosted assistant generated-audio phase timing captured.",
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
    messageTargetingAvailable:
      readHostedAssistantProviderPlanBoolean(record, "messageTargetingAvailable"),
    messageTargetDynamicToolsAvailable:
      readHostedAssistantProviderPlanBoolean(record, "messageTargetDynamicToolsAvailable"),
    providerRequestOrdinal:
      readHostedAssistantProviderPlanNullableNumber(record, "providerRequestOrdinal"),
    resumeCodexThreadIdPresent:
      readHostedAssistantProviderPlanBoolean(record, "resumeCodexThreadIdPresent"),
    workingDirectoryKind,
  };

  maybeSetHostedAssistantProviderDiagnosticDetail(
    details, "threadRotationReason",
    readHostedAssistantProviderDiagnosticAllowedString(record, "threadRotationReason", HOSTED_ASSISTANT_THREAD_ROTATION_REASON_VALUES),
  );

  for (const key of [
    "dynamicToolCount",
    "routePlanningAssistantContextSnapshotElapsedMs",
    "routePlanningAssistantContextSnapshotRefreshElapsedMs",
    "routePlanningFollowUpContextElapsedMs",
    "routePlanningCliBootstrapElapsedMs",
    "routePlanningElapsedMs",
    "routePlanningMeasuredElapsedMs",
    "routePlanningPrimarySystemPromptElapsedMs",
    "routePlanningResumeBindingElapsedMs",
    "routePlanningSlowestStageElapsedMs",
    "routePlanningUnaccountedElapsedMs",
  ] as const) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
    );
  }
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "reasoningEffort",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "reasoningEffort",
      HOSTED_ASSISTANT_REASONING_EFFORT_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "routePlanningSlowestStage",
    readHostedAssistantProviderDiagnosticAllowedString(
      record,
      "routePlanningSlowestStage",
      HOSTED_ASSISTANT_ROUTE_PLANNING_STAGE_VALUES,
    ),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "routePlanningBootstrapContextPrepared",
    readHostedAssistantProviderDiagnosticBoolean(record, "routePlanningBootstrapContextPrepared"),
  );

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
  if (stage === "initialized" || stage === "preinitialized") {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      "codexTimingColdStartReason",
      readHostedAssistantProviderDiagnosticAllowedString(
        record,
        "codexTimingColdStartReason",
        HOSTED_ASSISTANT_CODEX_APP_SERVER_COLD_START_REASON_VALUES,
      ),
    );
  }
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingElapsedMs",
    readHostedAssistantProviderDiagnosticNonnegativeNumber(record, "codexTimingElapsedMs"),
  );
  if (stage === "thread-resumed") {
    const rolloutBytes = readHostedAssistantProviderDiagnosticNonnegativeNumber(record, "codexTimingRolloutBytes");
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      "codexTimingRolloutBytes",
      Number.isSafeInteger(rolloutBytes) ? rolloutBytes : undefined,
    );
  }
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingProviderActionCount",
    readHostedAssistantProviderDiagnosticNonnegativeNumber(record, "codexTimingProviderActionCount"),
  );
  if (stage === "turn-completed" || stage === "provider-output-received" || stage === "assistant-output-received") {
    for (const key of [
      "codexTimingProviderRequestOrdinal",
      "codexTimingTurnCorrelation",
      "codexTimingTurnStartAckElapsedMs",
      "codexTimingTurnStartedNotificationElapsedMs",
      "codexTimingTurnCompletedNotificationElapsedMs",
      "codexTimingTurnCompleteElapsedMs",
      "codexTimingFirstProviderReceiptElapsedMs",
      "codexTimingFirstAssistantReceiptElapsedMs",
      "codexTimingLastProviderReceiptElapsedMs",
      "codexTimingProviderReceiptCount",
    ] as const) {
      maybeSetHostedAssistantProviderDiagnosticDetail(
        details,
        key,
        readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
      );
    }
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      "codexTimingReceiptKind",
      readHostedAssistantProviderDiagnosticAllowedString(record, "codexTimingReceiptKind", HOSTED_ASSISTANT_CODEX_RECEIPT_KIND_VALUES),
    );
  }
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

function readHostedAssistantCodexTransportDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  const schema = readHostedAssistantProviderPlanString(record, "schema");
  const type = readHostedAssistantProviderPlanString(record, "type");
  if (
    schema !== ASSISTANT_CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA
    || type !== ASSISTANT_CODEX_TRANSPORT_DIAGNOSTICS_TRACE_TYPE
  ) {
    return null;
  }

  const eventKind = readHostedAssistantProviderDiagnosticAllowedString(
    record,
    "codexTransportEventKind",
    HOSTED_ASSISTANT_CODEX_TRANSPORT_EVENT_KIND_VALUES,
  );
  const sourceMethod = readHostedAssistantProviderDiagnosticAllowedString(
    record,
    "codexTransportSourceMethod",
    HOSTED_ASSISTANT_CODEX_TRANSPORT_METHOD_VALUES,
  );
  const transport = readHostedAssistantProviderDiagnosticAllowedString(
    record,
    "codexTransportTransport",
    HOSTED_ASSISTANT_CODEX_TRANSPORT_VALUES,
  );
  if (!eventKind || !sourceMethod || !transport) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    codexTransportEventKind: eventKind,
    codexTransportSourceMethod: sourceMethod,
    codexTransportTraceType: "transport-diagnostics",
    codexTransportTransport: transport,
    providerTraceKind: "codex.transport_diagnostics",
    schema: ASSISTANT_CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA,
  };

  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTransportTimeoutPhase",
    readHostedAssistantProviderDiagnosticAllowedString(record, "codexTransportTimeoutPhase", HOSTED_ASSISTANT_CODEX_TRANSPORT_TIMEOUT_PHASE_VALUES),
  );
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTransportScope",
    readHostedAssistantProviderDiagnosticAllowedString(record, "codexTransportScope", HOSTED_ASSISTANT_CODEX_TRANSPORT_SCOPE_VALUES),
  );

  for (const key of HOSTED_ASSISTANT_CODEX_TRANSPORT_DIAGNOSTIC_BOOLEAN_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticBoolean(record, key),
    );
  }
  for (const key of HOSTED_ASSISTANT_CODEX_TRANSPORT_DIAGNOSTIC_NUMBER_KEYS) {
    maybeSetHostedAssistantProviderDiagnosticDetail(
      details,
      key,
      readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
    );
  }
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

function readHostedAssistantCodexGeneratedAudioPhaseTimingTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  const record = readHostedAssistantProviderRawTraceRecord(event);
  if (!record) {
    return null;
  }

  if (
    !Object.hasOwn(record, "schema")
    || record.schema !== ASSISTANT_CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_SCHEMA
    || !Object.hasOwn(record, "type")
    || record.type !== ASSISTANT_CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_TYPE
  ) {
    return null;
  }

  const deliveryMode = readHostedAssistantProviderDiagnosticExactAllowedString(
    record,
    "generatedAudioDeliveryMode",
    HOSTED_ASSISTANT_GENERATED_AUDIO_DELIVERY_MODE_VALUES,
  );
  const kind = readHostedAssistantProviderDiagnosticExactAllowedString(
    record,
    "generatedAudioKind",
    HOSTED_ASSISTANT_GENERATED_AUDIO_KIND_VALUES,
  );
  const outcome = readHostedAssistantProviderDiagnosticExactAllowedString(
    record,
    "generatedAudioOutcome",
    HOSTED_ASSISTANT_GENERATED_AUDIO_OUTCOME_VALUES,
  );
  const terminalPhase = readHostedAssistantProviderDiagnosticExactAllowedString(
    record,
    "generatedAudioTerminalPhase",
    HOSTED_ASSISTANT_GENERATED_AUDIO_TERMINAL_PHASE_VALUES,
  );
  if (!deliveryMode || !kind || !outcome || !terminalPhase) {
    return null;
  }

  const generationDurationPresent = Object.hasOwn(
    record,
    "generatedAudioGenerationDurationMs",
  );
  const uploadDurationPresent = Object.hasOwn(
    record,
    "generatedAudioUploadDurationMs",
  );
  const generationDurationMs = generationDurationPresent
    ? readHostedAssistantProviderDiagnosticNonnegativeNumber(
        record,
        "generatedAudioGenerationDurationMs",
      )
    : undefined;
  const uploadDurationMs = uploadDurationPresent
    ? readHostedAssistantProviderDiagnosticNonnegativeNumber(
        record,
        "generatedAudioUploadDurationMs",
      )
    : undefined;
  if (
    (generationDurationPresent && typeof generationDurationMs !== "number")
    || (uploadDurationPresent && typeof uploadDurationMs !== "number")
  ) {
    return null;
  }

  if (deliveryMode === "deferred") {
    if (
      outcome !== "deferred"
      || terminalPhase !== "delivery"
      || generationDurationMs !== undefined
      || uploadDurationMs !== undefined
    ) {
      return null;
    }
  } else {
    if (
      outcome === "deferred"
      || terminalPhase === "delivery"
      || typeof generationDurationMs !== "number"
    ) {
      return null;
    }
    if (terminalPhase === "generation") {
      if (
        uploadDurationMs !== undefined
        || (
          outcome !== "aborted"
          && outcome !== "generation_failed"
          && outcome !== "invalid_audio"
        )
      ) {
        return null;
      }
    } else if (
      typeof uploadDurationMs !== "number"
      || (
        outcome !== "aborted"
        && outcome !== "succeeded"
        && outcome !== "upload_failed"
      )
    ) {
      return null;
    }
  }

  return {
    generatedAudioDeliveryMode: deliveryMode,
    ...(generationDurationMs === undefined
      ? {}
      : { generatedAudioGenerationDurationMs: generationDurationMs }),
    generatedAudioKind: kind,
    generatedAudioOutcome: outcome,
    generatedAudioTerminalPhase: terminalPhase,
    ...(uploadDurationMs === undefined
      ? {}
      : { generatedAudioUploadDurationMs: uploadDurationMs }),
    generatedAudioTraceType: "phase-timing",
    providerTraceKind: "codex.generated_audio_phase_timing",
    schema: ASSISTANT_CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_SCHEMA,
  };
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

function readHostedAssistantProviderDiagnosticExactAllowedString(
  record: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
): string | undefined {
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }

  const value = record[key];
  return typeof value === "string" && allowedValues.has(value)
    ? value
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
