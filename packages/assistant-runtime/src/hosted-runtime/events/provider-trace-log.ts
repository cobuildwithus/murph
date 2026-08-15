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
const ASSISTANT_CODEX_INVALID_OUTPUT_TRACE_SCHEMA =
  "murph.assistant-codex-invalid-output-diagnostics.v1";
const ASSISTANT_CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE =
  "assistant.codex.invalid_output_resume_failure";
const ASSISTANT_CODEX_RESUME_FAILURE_TRACE_SCHEMA =
  "murph.assistant-codex-resume-failure-diagnostics.v1";
const ASSISTANT_CODEX_RESUME_FAILURE_TRACE_TYPE =
  "assistant.codex.resume_failure";
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
const HOSTED_ASSISTANT_ROUTE_PLANNING_STAGE_VALUES = new Set([
  "active_experiment_context",
  "assistant_context_snapshot",
  "cli_bootstrap",
  "fallback_instructions",
  "memory_overview",
  "primary_instructions",
  "resume_binding",
  "target_capabilities",
]);
const HOSTED_ASSISTANT_PROVIDER_PROMPT_DIAGNOSTIC_KIND_VALUES = new Set([
  "primary",
]);
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_PHASE_VALUES = new Set([
  "resume-failed",
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
  "preinitialized",
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
  "codexInvalidOutputFailureSessionPresent",
  "codexInvalidOutputFailureTurnPresent",
  "codexInvalidOutputResumeMatchesFailureSession",
  "codexInvalidOutputResumeSessionPresent",
] as const;
const HOSTED_ASSISTANT_CODEX_INVALID_OUTPUT_NUMBER_KEYS = [
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
] as const;
const HOSTED_ASSISTANT_CODEX_TRANSPORT_DIAGNOSTIC_NUMBER_KEYS = [
  "codexTransportErrorMessageLength",
  "codexTransportProviderActionCount",
  "codexTransportRetryCount",
  "codexTransportRetryMax",
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
  "conversationHistoryPresent",
  "developerInstructionsPresent",
  "messageTargetDynamicToolsAvailable",
  "messageReactionsAvailable",
  "reactionDynamicToolAvailable",
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
const HOSTED_ASSISTANT_PROVIDER_DIAGNOSTIC_TEXT_MAX_LENGTH = 2048;
const HOSTED_ASSISTANT_PROVIDER_DIAGNOSTIC_TEXT_KEY_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.-]{0,127}(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u;

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
    messageTargetingAvailable:
      readHostedAssistantProviderPlanBoolean(record, "messageTargetingAvailable")
      ?? readHostedAssistantProviderPlanBoolean(record, "messageReactionsAvailable"),
    messageTargetDynamicToolsAvailable:
      readHostedAssistantProviderPlanBoolean(record, "messageTargetDynamicToolsAvailable")
      ?? readHostedAssistantProviderPlanBoolean(record, "reactionDynamicToolAvailable"),
    providerRequestOrdinal:
      readHostedAssistantProviderPlanNullableNumber(record, "providerRequestOrdinal"),
    resumeCodexThreadIdPresent:
      readHostedAssistantProviderPlanBoolean(record, "resumeCodexThreadIdPresent")
        ?? readHostedAssistantProviderPlanBoolean(record, "resumeProviderSessionIdPresent"),
    workingDirectoryKind,
  };

  for (const key of [
    "dynamicToolCount",
    "routePlanningActiveExperimentContextElapsedMs",
    "routePlanningAssistantContextSnapshotElapsedMs",
    "routePlanningCliBootstrapElapsedMs",
    "routePlanningElapsedMs",
    "routePlanningFallbackInstructionsElapsedMs",
    "routePlanningMemoryOverviewElapsedMs",
    "routePlanningMeasuredElapsedMs",
    "routePlanningPrimaryInstructionsElapsedMs",
    "routePlanningPrimarySystemPromptElapsedMs",
    "routePlanningResumeBindingElapsedMs",
    "routePlanningSlowestStageElapsedMs",
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
    || type !== ASSISTANT_CODEX_INVALID_OUTPUT_FAILURE_TRACE_TYPE
  ) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    codexInvalidOutputTraceType: "failure",
    providerTraceKind: "codex.invalid_output_resume_failure",
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
  maybeSetHostedAssistantProviderDiagnosticDetail(
    details,
    "codexTimingProviderActionCount",
    readHostedAssistantProviderDiagnosticNonnegativeNumber(record, "codexTimingProviderActionCount"),
  );
  if (stage === "turn-completed") {
    for (const key of [
      "codexTimingProviderRequestOrdinal",
      "codexTimingTurnStartAckElapsedMs",
      "codexTimingTurnStartedNotificationElapsedMs",
      "codexTimingTurnCompletedNotificationElapsedMs",
      "codexTimingTurnCompleteElapsedMs",
    ] as const) {
      maybeSetHostedAssistantProviderDiagnosticDetail(
        details,
        key,
        readHostedAssistantProviderDiagnosticNonnegativeNumber(record, key),
      );
    }
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
