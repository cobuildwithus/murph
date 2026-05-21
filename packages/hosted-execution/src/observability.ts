export const HOSTED_EXECUTION_LOG_PHASES = [
  "wake.running",
  "container.starting",
  "container.ready",
  "runtime.starting",
  "checkpoint",
  "outbox",
  "failed",
  "scheduled",
] as const;

export type HostedExecutionLogPhase = (typeof HOSTED_EXECUTION_LOG_PHASES)[number];

export const HOSTED_EXECUTION_LOG_LEVELS = ["info", "warn", "error"] as const;

export type HostedExecutionLogLevel = (typeof HOSTED_EXECUTION_LOG_LEVELS)[number];

export type HostedExecutionErrorCode =
  | "authorization_error"
  | "bundle_archive_validation_error"
  | "configuration_error"
  | "checkpoint_error"
  | "outbox_error"
  | "invalid_request"
  | "range_error"
  | "reference_error"
  | "runner_http_error"
  | "runtime_error"
  | "syntax_error"
  | "timeout"
  | "type_error"
  | "uri_error";

const HOSTED_EXECUTION_SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "Error",
  "EvalError",
  "HostedBundleArchiveValidationError",
  "HostedExecutionConfigurationError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

const HOSTED_EXECUTION_MAX_OPERATOR_MESSAGE_LENGTH = 400;
const HOSTED_EXECUTION_MAX_DIAGNOSTIC_MESSAGE_LENGTH = 320;
const HOSTED_EXECUTION_MAX_STACK_PREVIEW_LINES = 3;
const HOSTED_EXECUTION_MAX_DETAIL_ARRAY_LENGTH = 32;
const HOSTED_EXECUTION_MAX_DETAIL_DEPTH = 4;
const HOSTED_EXECUTION_MAX_DETAIL_KEYS = 32;
const HOSTED_EXECUTION_MAX_ERROR_PROPERTY_SCAN_DEPTH = 3;
const HOSTED_EXECUTION_SAFE_CONFIGURATION_MESSAGE_PATTERNS = [
  /^(?:[A-Z][A-Z0-9_]{1,127}|CF_[A-Z0-9_]{1,127}|HOSTED_[A-Z0-9_]{1,127}|DEVICE_SYNC_[A-Z0-9_]{1,127})\s+(?:must be|is)\s+configured(?:\s+for [A-Za-z0-9 ._/-]+)?\.?$/u,
  /^Native hosted execution requires a RunnerContainer binding\.$/u,
];
const HOSTED_EXECUTION_SENSITIVE_DETAIL_KEY_PATTERN =
  /authorization|secret|token|password|passcode|api[-_]?key|cookie|set-cookie|^(?:bundleRefKey|refKey)$/iu;
const HOSTED_EXECUTION_SENSITIVE_ID_PRESENT_DETAIL_KEYS = {
  boundUserId: "boundUserIdPresent",
  codexThreadId: "codexThreadIdPresent",
  providerSessionId: "providerSessionIdPresent",
  recoveredCodexThreadId: "recoveredCodexThreadIdPresent",
  resumeCodexThreadId: "resumeCodexThreadIdPresent",
  resumeProviderSessionId: "resumeProviderSessionIdPresent",
  userId: "userIdPresent",
} as const satisfies Record<string, string>;
const HOSTED_EXECUTION_ERROR_CODE_PROPERTY_KEYS = ["code", "errorCode"] as const;
const HOSTED_EXECUTION_ERROR_STATUS_PROPERTY_KEYS =
  ["status", "statusCode", "responseStatus"] as const;
const HOSTED_EXECUTION_ERROR_PROPERTY_CONTAINER_KEYS =
  ["context", "details", "cause", "error", "response", "data"] as const;
const HOSTED_EXECUTION_SAFE_ERROR_OWN_DETAIL_KEYS = new Set([
  "action",
  "attempt",
  "attemptCount",
  "bundleArchiveOperation",
  "bundleRefHash",
  "bundleRefKeyPresent",
  "bundleRefPresent",
  "bundleRefSize",
  "expectedKind",
  "kind",
  "maxAttempts",
  "maxEventAttempts",
  "operation",
  "phase",
  "reason",
  "refHash",
  "refKeyPresent",
  "refSize",
  "retryable",
  "runElapsedMs",
  "timeoutMs",
]);
const HOSTED_EXECUTION_NAMED_ERROR_CODES = {
  RangeError: "range_error",
  ReferenceError: "reference_error",
  SyntaxError: "syntax_error",
  TypeError: "type_error",
  URIError: "uri_error",
} as const satisfies Record<string, HostedExecutionErrorCode>;
const HOSTED_EXECUTION_ERROR_SUMMARIES = {
  authorization_error: "Hosted execution authorization failed.",
  bundle_archive_validation_error: "Hosted bundle archive validation failed.",
  configuration_error: "Hosted execution configuration is invalid.",
  checkpoint_error: "Hosted execution failed while recording a checkpoint.",
  outbox_error: "Hosted execution failed while draining hosted outbox.",
  invalid_request: "Hosted execution rejected an invalid request.",
  range_error: "Hosted execution runtime failed.",
  reference_error: "Hosted execution runtime failed.",
  runner_http_error: "Hosted runner container returned an HTTP error.",
  runtime_error: "Hosted execution runtime failed.",
  syntax_error: "Hosted execution runtime failed.",
  timeout: "Hosted execution timed out.",
  type_error: "Hosted execution runtime failed.",
  uri_error: "Hosted execution runtime failed.",
} as const satisfies Record<HostedExecutionErrorCode, string>;

export interface HostedExecutionStructuredLogRecord {
  component: string;
  details?: HostedExecutionStructuredLogDetails | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorName?: string | null;
  eventId: string | null;
  level: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  schema: "murph.hosted-execution.log.v1";
  time: string;
  userId: string | null;
  userIdPresent: boolean;
}

interface HostedExecutionWakeLike {
  eventId?: string | null;
}

export type HostedExecutionStructuredLogDetailValue =
  | boolean
  | number
  | string
  | null
  | HostedExecutionStructuredLogDetailValue[]
  | {
    [key: string]: HostedExecutionStructuredLogDetailValue;
  };

export type HostedExecutionStructuredLogDetails = {
  [key: string]: HostedExecutionStructuredLogDetailValue;
};

const HOSTED_ASSISTANT_NOTIFICATION_STRING_DETAIL_KEYS = [
  "assistantNotificationChannel",
  "assistantNotificationDeliveryDispatchMode",
  "assistantNotificationDeliveryKind",
  "assistantNotificationGatewayOnlyProviders",
  "assistantNotificationProvider",
  "assistantNotificationProviderModel",
  "assistantNotificationRouteId",
  "assistantNotificationStage",
  "assistantNotificationTurnTrigger",
] as const;

const HOSTED_ASSISTANT_PROVIDER_STRING_DETAIL_KEYS = [
  "assistantProviderAdapter",
  "assistantProviderBaseUrlOrigin",
  "assistantProviderBaseUrlPath",
  "assistantProviderErrorBodyCode",
  "assistantProviderErrorBodyMessage",
  "assistantProviderErrorBodyType",
  "assistantProviderErrorCode",
  "assistantProviderErrorMessage",
  "assistantProviderErrorStatusText",
  "assistantProviderErrorType",
  "assistantProviderExecutionDriver",
  "assistantProviderGatewayOnlyProviders",
  "assistantProviderModel",
  "assistantProviderName",
  "assistantProviderPresetId",
  "assistantProviderRequestUrlOrigin",
  "assistantProviderRequestUrlPath",
] as const;

const HOSTED_ASSISTANT_PROVIDER_BOOLEAN_DETAIL_KEYS = [
  "assistantProviderBaseUrlConfigured",
  "assistantProviderErrorBodyPresent",
  "assistantProviderErrorRetryable",
  "assistantProviderGatewayTarget",
  "assistantProviderZeroDataRetention",
] as const;

const HOSTED_ASSISTANT_PROVIDER_NUMBER_DETAIL_KEYS = [
  "assistantProviderErrorStatus",
  "assistantProviderGatewayOnlyProviderCount",
] as const;

const HOSTED_ASSISTANT_NOTIFICATION_CODEX_STRING_DETAIL_KEYS = {
  codexFailureStage: "assistantNotificationCodexFailureStage",
  codexTurnStatus: "assistantNotificationCodexTurnStatus",
} as const;

const HOSTED_ASSISTANT_NOTIFICATION_CODEX_BOOLEAN_DETAIL_KEYS = {
  codexFailureDetailPresent: "assistantNotificationCodexFailureDetailPresent",
  codexSignalPresent: "assistantNotificationCodexSignalPresent",
  codexStderrPresent: "assistantNotificationCodexStderrPresent",
  connectionLost: "assistantNotificationCodexConnectionLost",
  interrupted: "assistantNotificationCodexInterrupted",
  recoverableConnectionLoss: "assistantNotificationCodexRecoverableConnectionLoss",
  retryable: "assistantNotificationCodexRetryable",
} as const;

const HOSTED_ASSISTANT_NOTIFICATION_CODEX_NUMBER_DETAIL_KEYS = {
  codexExitCode: "assistantNotificationCodexExitCode",
  providerActionCount: "assistantNotificationProviderActionCount",
} as const;

const HOSTED_ASSISTANT_NOTIFICATION_BOOLEAN_DETAIL_KEYS = [
  "assistantNotificationExplicitTargetPresent",
  "assistantNotificationIdentityIdPresent",
  "assistantNotificationHostedExecutionPresent",
  "assistantNotificationThreadIdPresent",
  "assistantNotificationThreadIsDirect",
  "assistantNotificationWorkingDirectoryPresent",
] as const;

export interface HostedExecutionStructuredLogInput {
  component: string;
  details?: HostedExecutionStructuredLogDetails | null;
  error?: unknown;
  eventId?: string | null;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  time?: string;
  userId?: string | null;
  wake?: HostedExecutionWakeLike | null;
}

export function isHostedExecutionLogPhase(value: unknown): value is HostedExecutionLogPhase {
  return typeof value === "string" && HOSTED_EXECUTION_LOG_PHASES.includes(
    value as HostedExecutionLogPhase,
  );
}

export function isHostedExecutionLogLevel(value: unknown): value is HostedExecutionLogLevel {
  return typeof value === "string" && HOSTED_EXECUTION_LOG_LEVELS.includes(
    value as HostedExecutionLogLevel,
  );
}

export function normalizeHostedExecutionErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : error.name;
  }

  const message = String(error).trim();
  return message.length > 0 ? message : "Unknown hosted execution error.";
}

export function normalizeHostedExecutionOperatorMessage(message: string): string {
  const normalized = redactHostedExecutionText(message)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length === 0) {
    return "Hosted execution event.";
  }

  if (normalized.length <= HOSTED_EXECUTION_MAX_OPERATOR_MESSAGE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, HOSTED_EXECUTION_MAX_OPERATOR_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

export function deriveHostedExecutionErrorCode(error: unknown): HostedExecutionErrorCode {
  const name = error instanceof Error ? error.name : "";
  const message = normalizeHostedExecutionErrorMessage(error).toLowerCase();
  const status = readHostedExecutionNumericErrorProperty(
    error,
    HOSTED_EXECUTION_ERROR_STATUS_PROPERTY_KEYS,
    100,
    599,
  );
  const detailCode = readHostedExecutionStringErrorProperty(
    error,
    HOSTED_EXECUTION_ERROR_CODE_PROPERTY_KEYS,
  )?.toLowerCase();

  if (
    name === "HostedExecutionConfigurationError"
    || hostedExecutionMessageIncludesAny(message, [
      "not configured",
      "configuration",
      "missing token",
      "requires a runnercontainer binding",
      "must be configured",
    ])
  ) {
    return "configuration_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["checkpoint"])) {
    return "checkpoint_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["outbox"])) {
    return "outbox_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["returned http"])) {
    return "runner_http_error";
  }

  if (
    name === "HostedBundleArchiveValidationError"
    || hostedExecutionMessageIncludesAny(message, [
      "hosted bundle archive",
      "hosted bundle artifact integrity validation failed",
      "hosted bundle payload must be valid base64",
      "hosted bundle kind mismatch",
    ])
    || (detailCode
      ? hostedExecutionMessageIncludesAny(detailCode, [
          "bundle_archive_validation_error",
          "hosted_bundle_archive_validation_error",
        ])
      : false)
  ) {
    return "bundle_archive_validation_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["authorization", "unauthorized", "forbidden"])) {
    return "authorization_error";
  }
  if (
    status === 401
    || status === 403
    || (detailCode
      ? hostedExecutionMessageIncludesAny(detailCode, [
          "auth",
          "forbidden",
          "invalid_api_key",
          "unauthorized",
        ])
      : false)
  ) {
    return "authorization_error";
  }

  if (
    hostedExecutionMessageIncludesAny(message, [
      "invalid json",
      "invalid request",
      "request body must be a json object",
      "must be a json object",
      "malformed",
    ])
  ) {
    return "invalid_request";
  }
  if (
    status === 400
    || status === 404
    || (detailCode
      ? hostedExecutionMessageIncludesAny(detailCode, ["bad_request", "invalid_request", "not_found"])
      : false)
  ) {
    return "invalid_request";
  }

  if (
    name === "AbortError"
    || hostedExecutionMessageIncludesAny(message, ["abort", "timed out", "timeout"])
  ) {
    return "timeout";
  }
  if (
    status === 408
    || status === 504
    || (detailCode ? hostedExecutionMessageIncludesAny(detailCode, ["timeout", "timed_out"]) : false)
  ) {
    return "timeout";
  }

  return readHostedExecutionNamedErrorCode(name) ?? "runtime_error";
}

export function summarizeHostedExecutionError(error: unknown): string {
  const message = normalizeHostedExecutionErrorMessage(error);
  const errorCode = deriveHostedExecutionErrorCode(error);

  if (errorCode === "configuration_error") {
    return readHostedExecutionSafeConfigurationMessage(message)
      ?? HOSTED_EXECUTION_ERROR_SUMMARIES.configuration_error;
  }

  if (errorCode === "runner_http_error") {
    const status = extractHostedExecutionHttpStatus(message);
    return status
      ? `Hosted runner container returned HTTP ${status}.`
      : HOSTED_EXECUTION_ERROR_SUMMARIES.runner_http_error;
  }

  return summarizeHostedExecutionErrorCode(errorCode)
    ?? HOSTED_EXECUTION_ERROR_SUMMARIES.runtime_error;
}

export function summarizeHostedExecutionErrorCode(
  errorCode: string | null | undefined,
): string | null {
  if (!errorCode) {
    return null;
  }

  return isHostedExecutionErrorCode(errorCode)
    ? HOSTED_EXECUTION_ERROR_SUMMARIES[errorCode]
    : HOSTED_EXECUTION_ERROR_SUMMARIES.runtime_error;
}

export function formatHostedExecutionLogMessage(message: string, error?: unknown): string {
  const normalizedMessage = normalizeHostedExecutionOperatorMessage(message);

  if (error === undefined) {
    return normalizedMessage;
  }

  const errorFragments = buildHostedExecutionInlineErrorFragments(error);

  if (errorFragments.length === 0) {
    return normalizedMessage;
  }

  let combinedMessage = normalizedMessage === "Hosted execution event."
    ? ""
    : normalizedMessage;

  for (const fragment of errorFragments) {
    if (combinedMessage.includes(fragment)) {
      continue;
    }

    combinedMessage = combinedMessage.length > 0
      ? normalizeHostedExecutionOperatorMessage(`${combinedMessage} ${fragment}`)
      : fragment;
  }

  return combinedMessage.length > 0 ? combinedMessage : normalizedMessage;
}

function isHostedExecutionIsoTimestampOnlyMessage(message: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
    .test(message.trim());
}

export function buildHostedExecutionStructuredLogRecord(
  input: HostedExecutionStructuredLogInput,
): HostedExecutionStructuredLogRecord {
  const error = input.error;
  const level = input.level ?? (error === undefined ? "info" : "error");
  const errorCode = error === undefined
    ? (level === "error" ? "runtime_error" : null)
    : deriveHostedExecutionErrorCode(error);
  const errorMessage = error === undefined
    ? (level === "error" ? HOSTED_EXECUTION_ERROR_SUMMARIES.runtime_error : null)
    : summarizeHostedExecutionError(error);
  const formattedMessage = formatHostedExecutionLogMessage(input.message, error);
  const message = level === "error" && isHostedExecutionIsoTimestampOnlyMessage(formattedMessage)
    ? (errorMessage ?? HOSTED_EXECUTION_ERROR_SUMMARIES.runtime_error)
    : formattedMessage;
  const errorName = readHostedExecutionSafeErrorName(error);
  const details = mergeHostedExecutionStructuredLogDetails(
    sanitizeHostedExecutionStructuredLogDetails(input.details),
    buildHostedExecutionSafeErrorDetails(error),
  );
  return {
    component: input.component,
    ...(details ? { details } : {}),
    ...(errorCode === null || errorMessage === null ? {} : {
      errorCode,
      errorMessage,
      ...(errorName ? { errorName } : {}),
    }),
    eventId: input.wake?.eventId ?? input.eventId ?? null,
    level,
    message,
    phase: input.phase,
    schema: "murph.hosted-execution.log.v1",
    time: input.time ?? new Date().toISOString(),
    userId: null,
    userIdPresent: Boolean(input.userId),
  };
}

export function buildHostedExecutionSafeErrorDiagnostics(
  error: unknown,
): HostedExecutionStructuredLogDetails | null {
  if (error === undefined) {
    return null;
  }

  const safeErrorDetails = buildHostedExecutionSafeErrorDetails(error);
  const errorName = readHostedExecutionSafeErrorName(error);
  const diagnostics: HostedExecutionStructuredLogDetails = {
    errorCode: deriveHostedExecutionErrorCode(error),
    errorMessage: summarizeHostedExecutionError(error),
  };
  const errorDetail = safeErrorDetails?.errorDetail;
  const errorCause = safeErrorDetails?.errorCause;
  const errorStatus = safeErrorDetails?.errorStatus;
  const errorCodeDetail = safeErrorDetails?.errorCodeDetail;

  if (errorName) {
    diagnostics.errorName = errorName;
  }

  if (typeof errorDetail === "string" && errorDetail !== diagnostics.errorMessage) {
    diagnostics.errorDetail = errorDetail;
  }

  if (typeof errorCause === "string") {
    diagnostics.errorCause = errorCause;
  }

  if (typeof errorStatus === "number") {
    diagnostics.errorStatus = errorStatus;
  }

  if (typeof errorCodeDetail === "string") {
    diagnostics.errorCodeDetail = errorCodeDetail;
  }

  return diagnostics;
}

export function buildHostedExecutionPrefixedSafeErrorDiagnostics(input: {
  error: unknown;
  prefix: string;
}): HostedExecutionStructuredLogDetails | null {
  if (!/^[A-Za-z][A-Za-z0-9]{0,48}$/u.test(input.prefix)) {
    throw new TypeError("Hosted execution diagnostic prefix must be a short identifier.");
  }

  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(input.error);
  if (!diagnostics) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(diagnostics).map(([key, value]) => [
      `${input.prefix}${key.slice(0, 1).toUpperCase()}${key.slice(1)}`,
      value,
    ]),
  );
}

export function extractHostedAssistantNotificationRedactedDetails(
  error: unknown,
): HostedExecutionStructuredLogDetails | null {
  if (error === undefined) {
    return null;
  }

  const mergedDetails = mergeHostedExecutionStructuredLogDetails(
    sanitizeHostedExecutionStructuredLogDetails(
      readHostedExecutionObjectErrorProperty(error, ["context"]),
    ),
    sanitizeHostedExecutionStructuredLogDetails(
      readHostedExecutionObjectErrorProperty(error, ["details"]),
    ),
  );
  const details: HostedExecutionStructuredLogDetails = {};

  for (const key of HOSTED_ASSISTANT_NOTIFICATION_STRING_DETAIL_KEYS) {
    const value = mergedDetails?.[key];
    if (typeof value === "string" || value === null) {
      details[key] = value;
    }
  }

  for (const key of HOSTED_ASSISTANT_NOTIFICATION_BOOLEAN_DETAIL_KEYS) {
    const value = mergedDetails?.[key];
    if (typeof value === "boolean" || value === null) {
      details[key] = value;
    }
  }

  for (const key of HOSTED_ASSISTANT_PROVIDER_STRING_DETAIL_KEYS) {
    const value = mergedDetails?.[key];
    if (typeof value === "string" || value === null) {
      details[key] = value;
    }
  }

  for (const key of HOSTED_ASSISTANT_PROVIDER_BOOLEAN_DETAIL_KEYS) {
    const value = mergedDetails?.[key];
    if (typeof value === "boolean" || value === null) {
      details[key] = value;
    }
  }

  for (const key of HOSTED_ASSISTANT_PROVIDER_NUMBER_DETAIL_KEYS) {
    const value = mergedDetails?.[key];
    if (typeof value === "number" || value === null) {
      details[key] = value;
    }
  }

  for (const [sourceKey, targetKey] of Object.entries(
    HOSTED_ASSISTANT_NOTIFICATION_CODEX_STRING_DETAIL_KEYS,
  )) {
    const value = mergedDetails?.[sourceKey];
    if (typeof value === "string" || value === null) {
      details[targetKey] = value;
    }
  }

  for (const [sourceKey, targetKey] of Object.entries(
    HOSTED_ASSISTANT_NOTIFICATION_CODEX_BOOLEAN_DETAIL_KEYS,
  )) {
    const value = mergedDetails?.[sourceKey];
    if (typeof value === "boolean" || value === null) {
      details[targetKey] = value;
    }
  }

  for (const [sourceKey, targetKey] of Object.entries(
    HOSTED_ASSISTANT_NOTIFICATION_CODEX_NUMBER_DETAIL_KEYS,
  )) {
    const value = mergedDetails?.[sourceKey];
    if (typeof value === "number" || value === null) {
      details[targetKey] = value;
    }
  }

  const assistantNotificationProviderSessionIdPresent =
    readHostedExecutionDetailBoolean(mergedDetails, "codexThreadIdPresent")
    ?? readHostedExecutionDetailBoolean(mergedDetails, "providerSessionIdPresent")
    ?? readHostedExecutionDetailStringPresent(mergedDetails, "codexThreadId")
    ?? readHostedExecutionDetailStringPresent(mergedDetails, "providerSessionId");
  if (assistantNotificationProviderSessionIdPresent !== null) {
    details.assistantNotificationProviderSessionIdPresent =
      assistantNotificationProviderSessionIdPresent;
  }

  const notificationErrorDiagnostics = buildHostedExecutionPrefixedSafeErrorDiagnostics({
    error,
    prefix: "assistantNotification",
  });
  Object.assign(details, notificationErrorDiagnostics ?? {});

  const providerErrorCode = notificationErrorDiagnostics?.assistantNotificationErrorCodeDetail;
  if (typeof providerErrorCode === "string") {
    details.assistantNotificationProviderErrorCode = providerErrorCode;
  }

  if (
    mergedDetails
    && (
      "assistantNotificationLinqBaseUrlOrigin" in mergedDetails
      || "assistantNotificationLinqBaseUrlPath" in mergedDetails
    )
  ) {
    details.assistantNotificationLinqBaseUrlConfigured =
      typeof mergedDetails.assistantNotificationLinqBaseUrlOrigin === "string"
      || typeof mergedDetails.assistantNotificationLinqBaseUrlPath === "string";
  }

  if (
    mergedDetails
    && (
      "assistantNotificationProviderBaseUrlOrigin" in mergedDetails
      || "assistantNotificationProviderBaseUrlPath" in mergedDetails
    )
  ) {
    details.assistantNotificationProviderBaseUrlConfigured =
      typeof mergedDetails.assistantNotificationProviderBaseUrlOrigin === "string"
      || typeof mergedDetails.assistantNotificationProviderBaseUrlPath === "string";
  }

  return Object.keys(details).length > 0 ? details : null;
}

function shouldEmitHostedExecutionStructuredLogToStdIo(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.MURPH_HOSTED_EXECUTION_STDIO_LOGS?.trim().toLowerCase();

  if (override === "1" || override === "true" || override === "yes" || override === "on") {
    return true;
  }

  if (override === "0" || override === "false" || override === "no" || override === "off") {
    return false;
  }

  return true;
}

function readHostedExecutionDetailBoolean(
  details: HostedExecutionStructuredLogDetails | null,
  key: string,
): boolean | null {
  const value = details?.[key];
  return typeof value === "boolean" ? value : null;
}

function readHostedExecutionDetailStringPresent(
  details: HostedExecutionStructuredLogDetails | null,
  key: string,
): boolean | null {
  if (!details || !(key in details)) {
    return null;
  }

  const value = details[key];
  return typeof value === "string" ? value.length > 0 : null;
}

export function emitHostedExecutionStructuredLog(
  input: HostedExecutionStructuredLogInput,
): HostedExecutionStructuredLogRecord {
  const record = buildHostedExecutionStructuredLogRecord(input);

  if (!shouldEmitHostedExecutionStructuredLogToStdIo()) {
    return record;
  }

  const payload = JSON.stringify(record);

  switch (record.level) {
    case "error":
      console.error(payload);
      break;
    case "warn":
      console.warn(payload);
      break;
    default:
      console.info(payload);
      break;
  }

  return record;
}

function hostedExecutionMessageIncludesAny(
  message: string,
  fragments: readonly string[],
): boolean {
  return fragments.some((fragment) => message.includes(fragment));
}

function readHostedExecutionNamedErrorCode(name: string): HostedExecutionErrorCode | null {
  return hasOwn(HOSTED_EXECUTION_NAMED_ERROR_CODES, name)
    ? HOSTED_EXECUTION_NAMED_ERROR_CODES[name]
    : null;
}

function isHostedExecutionErrorCode(value: string): value is HostedExecutionErrorCode {
  return hasOwn(HOSTED_EXECUTION_ERROR_SUMMARIES, value);
}

function hasOwn<ObjectType extends object, Key extends PropertyKey>(
  object: ObjectType,
  key: Key,
): key is Extract<Key, keyof ObjectType> {
  return Object.hasOwn(object, key);
}

export function readHostedExecutionSafeErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const name = error.name.trim();
  return HOSTED_EXECUTION_SAFE_ERROR_NAMES.has(name) ? name : null;
}

function extractHostedExecutionHttpStatus(message: string): string | null {
  const match = /\bhttp\s+(\d{3})\b/iu.exec(message);
  return match?.[1] ?? null;
}

function readHostedExecutionSafeConfigurationMessage(message: string): string | null {
  const normalized = normalizeHostedExecutionOperatorMessage(message);

  return HOSTED_EXECUTION_SAFE_CONFIGURATION_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized))
    ? normalized
    : null;
}

export function sanitizeHostedExecutionStructuredLogDetails(
  value: HostedExecutionStructuredLogDetails | null | undefined,
): HostedExecutionStructuredLogDetails | null {
  return sanitizeHostedExecutionStructuredLogDetailsWithHints(
    value,
    inferHostedExecutionDetailSanitizationHints(value),
  );
}

export function sanitizeHostedExecutionStructuredLogText(
  value: string,
): string | null {
  return normalizeHostedExecutionDiagnosticMessage(value, 64_000);
}

function sanitizeHostedExecutionStructuredLogDetailsWithHints(
  value: HostedExecutionStructuredLogDetails | null | undefined,
  hints: HostedExecutionDetailSanitizationHints,
): HostedExecutionStructuredLogDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sanitized = sanitizeHostedExecutionDetailNode(value, 0, hints);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized
    : null;
}

export function buildHostedExecutionSafeErrorDetails(
  error: unknown,
): HostedExecutionStructuredLogDetails | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const hints = inferHostedExecutionErrorSanitizationHints(error);
  const nestedContext = sanitizeHostedExecutionStructuredLogDetailsWithHints(
    readHostedExecutionObjectErrorProperty(error, ["context"]),
    hints,
  );
  const nestedDetails = sanitizeHostedExecutionStructuredLogDetailsWithHints(
    readHostedExecutionObjectErrorProperty(error, ["details"]),
    hints,
  );
  const ownProperties = readHostedExecutionSafeOwnErrorProperties(error, hints);
  const details: HostedExecutionStructuredLogDetails = {
    ...(nestedContext ?? {}),
    ...(nestedDetails ?? {}),
    ...(ownProperties ? { errorProperties: ownProperties } : {}),
  };
  const errorDetail = normalizeHostedExecutionDiagnosticMessage(error.message);
  const operatorSummary = summarizeHostedExecutionError(error);
  const errorCause = readHostedExecutionSafeErrorCause(error);
  const stackPreview = readHostedExecutionSafeStackPreview(error);
  const errorStatus = readHostedExecutionNumericErrorProperty(
    error,
    HOSTED_EXECUTION_ERROR_STATUS_PROPERTY_KEYS,
    100,
    599,
  );
  const errorCode = readHostedExecutionStringErrorProperty(
    error,
    HOSTED_EXECUTION_ERROR_CODE_PROPERTY_KEYS,
  );

  if (errorDetail && errorDetail !== operatorSummary) {
    details.errorDetail = errorDetail;
  }

  if (errorCause && errorCause !== errorDetail) {
    details.errorCause = errorCause;
  }

  if (stackPreview) {
    details.stackPreview = stackPreview;
  }

  if (errorStatus !== null) {
    details.errorStatus = errorStatus;
  }

  if (errorCode) {
    details.errorCodeDetail = errorCode;
  }

  return Object.keys(details).length > 0 ? details : null;
}

function readHostedExecutionSafeOwnErrorProperties(
  error: Error,
  hints: HostedExecutionDetailSanitizationHints,
): HostedExecutionStructuredLogDetails | null {
  const entries = Object.keys(error)
    .flatMap((key): Array<readonly [string, unknown]> => {
      if (
        !/^[A-Za-z0-9_.-]{1,64}$/u.test(key)
        || !HOSTED_EXECUTION_SAFE_ERROR_OWN_DETAIL_KEYS.has(key)
      ) {
        return [];
      }

      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (!descriptor || !("value" in descriptor)) {
        return [];
      }

      return [[key, descriptor.value] as const];
    })
    .slice(0, HOSTED_EXECUTION_MAX_DETAIL_KEYS);

  if (entries.length === 0) {
    return null;
  }

  return sanitizeHostedExecutionStructuredLogDetailsWithHints(
    Object.fromEntries(entries) as HostedExecutionStructuredLogDetails,
    hints,
  );
}

function redactHostedExecutionText(value: string): string {
  return value
    .replace(/file:\/\/\/Users\/[^\s)"']+/gu, "file://<REDACTED_PATH>")
    .replace(/\/Users\/[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(/\/home\/[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(/\/root\/[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(/\/app\/[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(/\b[A-Za-z]:\\Users\\[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(
      /\b(authorization)\b\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+\b/giu,
      (_match, key: string) => `${key}=Bearer [redacted]`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu, "Bearer [redacted]")
    .replace(/\+\d{8,15}\b/gu, "[redacted-phone]")
    .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/gu, "[redacted-email]")
    .replace(
      /\b(authorization)\b\s*[:=]\s*(?!Bearer\b)(?:"[^"]+"|'[^']+'|\S+)/giu,
      (_match, key: string) => `${key}=[redacted]`,
    )
    .replace(
      /\b((?:[A-Z][A-Z0-9_]*_)?(?:token|secret|password|passcode|api[_-]?key|cookie|set-cookie))\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/giu,
      "$1=[redacted]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted-token]");
}

function mergeHostedExecutionStructuredLogDetails(
  primary: HostedExecutionStructuredLogDetails | null,
  secondary: HostedExecutionStructuredLogDetails | null,
): HostedExecutionStructuredLogDetails | null {
  if (!primary && !secondary) {
    return null;
  }

  return {
    ...(primary ?? {}),
    ...(secondary ?? {}),
  };
}

function buildHostedExecutionInlineErrorFragments(error: unknown): string[] {
  const summary = normalizeHostedExecutionOperatorMessage(summarizeHostedExecutionError(error));
  const details = buildHostedExecutionSafeErrorDetails(error);
  const fragments = [summary];
  const detail = readHostedExecutionInlineDetailFragment(
    details,
    "errorDetail",
    "Detail",
    fragments,
  );
  const cause = readHostedExecutionInlineDetailFragment(
    details,
    "errorCause",
    "Cause",
    [...fragments, ...(detail ? [detail] : [])],
  );
  const errorCode = readHostedExecutionInlineDetailFragment(
    details,
    "errorCodeDetail",
    "Code",
    [...fragments, ...(detail ? [detail] : []), ...(cause ? [cause] : [])],
  );
  const errorStatus = readHostedExecutionInlineStatusFragment(
    details,
    [...fragments, ...(detail ? [detail] : []), ...(cause ? [cause] : []), ...(errorCode ? [errorCode] : [])],
  );

  if (detail) {
    fragments.push(detail);
  }

  if (cause) {
    fragments.push(cause);
  }

  if (errorCode) {
    fragments.push(errorCode);
  }

  if (errorStatus) {
    fragments.push(errorStatus);
  }

  return fragments;
}

function readHostedExecutionInlineDetailFragment(
  details: HostedExecutionStructuredLogDetails | null,
  key: "errorCause" | "errorCodeDetail" | "errorDetail",
  label: "Cause" | "Code" | "Detail",
  existingFragments: readonly string[],
): string | null {
  const value = details?.[key];

  if (typeof value !== "string") {
    return null;
  }

  const fragment = normalizeHostedExecutionOperatorMessage(`${label}: ${value}`);
  return existingFragments.some((existing) => hostedExecutionFragmentsOverlap(existing, fragment))
    ? null
    : fragment;
}

function readHostedExecutionInlineStatusFragment(
  details: HostedExecutionStructuredLogDetails | null,
  existingFragments: readonly string[],
): string | null {
  const value = details?.errorStatus;

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }

  const fragment = `Status: ${value}.`;
  return existingFragments.some((existing) => hostedExecutionFragmentsOverlap(existing, fragment))
    ? null
    : fragment;
}

function hostedExecutionFragmentsOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();

  return normalizedLeft.length > 0
    && normalizedRight.length > 0
    && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft));
}

function sanitizeHostedExecutionDetailNode(
  value: HostedExecutionStructuredLogDetailValue,
  depth: number,
  hints: HostedExecutionDetailSanitizationHints,
): HostedExecutionStructuredLogDetailValue | null {
  if (depth > HOSTED_EXECUTION_MAX_DETAIL_DEPTH) {
    return null;
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    return normalizeHostedExecutionDiagnosticMessage(value);
  }

  if (Array.isArray(value)) {
    const sanitizedItems = value
      .slice(0, HOSTED_EXECUTION_MAX_DETAIL_ARRAY_LENGTH)
      .map((entry) => sanitizeHostedExecutionDetailNode(entry, depth + 1, hints))
      .filter((entry): entry is Exclude<typeof entry, null> => entry !== null);
    return sanitizedItems.length > 0 ? sanitizedItems : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const objectHints = mergeHostedExecutionDetailSanitizationHints(
    hints,
    inferHostedExecutionDetailSanitizationHints(value),
  );
  const sanitizedEntries = Object.entries(value)
    .slice(0, HOSTED_EXECUTION_MAX_DETAIL_KEYS)
    .flatMap(([key, entry]) => {
      if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(key)) {
        return [];
      }

      if (
        HOSTED_EXECUTION_SENSITIVE_DETAIL_KEY_PATTERN.test(key)
        && hostedExecutionDetailValuePresent(entry)
      ) {
        return [[key, "[redacted]"] as const];
      }

      const sensitiveIdPresentKey = readHostedExecutionSensitiveIdPresentDetailKey(key);
      if (sensitiveIdPresentKey) {
        return [[sensitiveIdPresentKey, hostedExecutionDetailValuePresent(entry)] as const];
      }

      const redactedTelegramEntry = sanitizeHostedExecutionTelegramDetailEntry(
        key,
        entry,
        objectHints,
      );
      if (redactedTelegramEntry !== undefined) {
        return redactedTelegramEntry === null ? [] : [[key, redactedTelegramEntry] as const];
      }

      const sanitizedEntry = sanitizeHostedExecutionDetailNode(entry, depth + 1, objectHints);
      return sanitizedEntry === null ? [] : [[key, sanitizedEntry] as const];
    });

  return sanitizedEntries.length > 0 ? Object.fromEntries(sanitizedEntries) : null;
}

function readHostedExecutionSensitiveIdPresentDetailKey(
  key: string,
): string | null {
  return Object.prototype.hasOwnProperty.call(
    HOSTED_EXECUTION_SENSITIVE_ID_PRESENT_DETAIL_KEYS,
    key,
  )
    ? HOSTED_EXECUTION_SENSITIVE_ID_PRESENT_DETAIL_KEYS[
        key as keyof typeof HOSTED_EXECUTION_SENSITIVE_ID_PRESENT_DETAIL_KEYS
      ]
    : null;
}

interface HostedExecutionDetailSanitizationHints {
  redactTelegramIdentifiers: boolean;
}

function inferHostedExecutionDetailSanitizationHints(
  value: unknown,
): HostedExecutionDetailSanitizationHints {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      redactTelegramIdentifiers: false,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    redactTelegramIdentifiers: hostedExecutionDetailIndicatesTelegram(record),
  };
}

function inferHostedExecutionErrorSanitizationHints(
  error: Error,
): HostedExecutionDetailSanitizationHints {
  const code = readHostedExecutionStringErrorProperty(
    error,
    HOSTED_EXECUTION_ERROR_CODE_PROPERTY_KEYS,
  );
  const context = readHostedExecutionObjectErrorProperty(error, ["context"]);
  const details = readHostedExecutionObjectErrorProperty(error, ["details"]);

  return mergeHostedExecutionDetailSanitizationHints(
    {
      redactTelegramIdentifiers: typeof code === "string"
        && code.toUpperCase().includes("TELEGRAM"),
    },
    mergeHostedExecutionDetailSanitizationHints(
      inferHostedExecutionDetailSanitizationHints(context),
      inferHostedExecutionDetailSanitizationHints(details),
    ),
  );
}

function mergeHostedExecutionDetailSanitizationHints(
  primary: HostedExecutionDetailSanitizationHints,
  secondary: HostedExecutionDetailSanitizationHints,
): HostedExecutionDetailSanitizationHints {
  return {
    redactTelegramIdentifiers:
      primary.redactTelegramIdentifiers || secondary.redactTelegramIdentifiers,
  };
}

function hostedExecutionDetailIndicatesTelegram(
  value: Record<string, unknown>,
): boolean {
  return [
    "assistantNotificationChannel",
    "channel",
    "deliveryChannel",
    "notificationRouteChannel",
    "provider",
    "wakeChannel",
  ].some((key) => normalizeHostedExecutionDetailString(value[key])?.toLowerCase() === "telegram");
}

function sanitizeHostedExecutionTelegramDetailEntry(
  key: string,
  value: HostedExecutionStructuredLogDetailValue,
  hints: HostedExecutionDetailSanitizationHints,
): HostedExecutionStructuredLogDetailValue | null | undefined {
  if (!hints.redactTelegramIdentifiers) {
    return undefined;
  }

  switch (key) {
    case "businessConnectionId":
    case "business_connection_id":
      return hostedExecutionDetailValuePresent(value)
        ? "[redacted-telegram-business-connection-id]"
        : null;
    case "chatId":
    case "chat_id":
    case "migrateToChatId":
    case "migrate_to_chat_id":
      return hostedExecutionDetailValuePresent(value)
        ? "[redacted-telegram-chat-id]"
        : null;
    case "directMessagesTopicId":
    case "direct_messages_topic_id":
    case "messageThreadId":
    case "message_thread_id":
      return hostedExecutionDetailValuePresent(value)
        ? "[redacted-telegram-topic-id]"
        : null;
    case "target":
    case "targetLabel":
    case "threadId":
      return summarizeRedactedHostedTelegramTarget(value);
    default:
      return undefined;
  }
}

function summarizeRedactedHostedTelegramTarget(
  value: HostedExecutionStructuredLogDetailValue,
): HostedExecutionStructuredLogDetailValue | null {
  const normalized = normalizeHostedExecutionDetailString(value);
  if (!normalized) {
    return null;
  }

  const parts = ["chat"];
  if (normalized.includes(":business:")) {
    parts.push("business");
  }
  if (normalized.includes(":topic:")) {
    parts.push("topic");
  }
  if (normalized.includes(":dm-topic:")) {
    parts.push("dm-topic");
  }

  return `[redacted-telegram-target:${parts.join("+")}]`;
}

function hostedExecutionDetailValuePresent(
  value: HostedExecutionStructuredLogDetailValue,
): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  return normalizeHostedExecutionDetailString(value) !== null;
}

function normalizeHostedExecutionDetailString(value: unknown): string | null {
  return typeof value === "string"
    ? normalizeHostedExecutionDiagnosticMessage(value, 512)
    : null;
}

function normalizeHostedExecutionDiagnosticMessage(
  value: unknown,
  maxLength: number = HOSTED_EXECUTION_MAX_DIAGNOSTIC_MESSAGE_LENGTH,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = redactHostedExecutionText(value)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function readHostedExecutionSafeErrorCause(error: Error): string | null {
  const cause = (error as Error & { cause?: unknown }).cause;

  if (cause instanceof Error) {
    return normalizeHostedExecutionDiagnosticMessage(cause.message);
  }

  return normalizeHostedExecutionDiagnosticMessage(
    typeof cause === "string" ? cause : null,
  );
}

function readHostedExecutionSafeStackPreview(error: Error): string[] | null {
  if (typeof error.stack !== "string" || error.stack.length === 0) {
    return null;
  }

  const lines = error.stack
    .split(/\r?\n/gu)
    .slice(1)
    .map((line) => normalizeHostedExecutionDiagnosticMessage(line, 180))
    .filter((line): line is string => Boolean(line))
    .slice(0, HOSTED_EXECUTION_MAX_STACK_PREVIEW_LINES);

  return lines.length > 0 ? lines : null;
}

function readHostedExecutionStringErrorProperty(
  error: unknown,
  keys: readonly string[],
): string | null {
  return readHostedExecutionNestedStringProperty(error, keys, {
    depth: 0,
    visited: new Set<object>(),
  });
}

function readHostedExecutionNestedStringProperty(
  value: unknown,
  keys: readonly string[],
  state: {
    depth: number;
    visited: Set<object>;
  },
): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (state.visited.has(value)) {
    return null;
  }
  state.visited.add(value);

  for (const key of keys) {
    const property = (value as Record<string, unknown>)[key];
    const normalized = normalizeHostedExecutionDiagnosticMessage(property);

    if (normalized) {
      return normalized;
    }
  }

  if (state.depth >= HOSTED_EXECUTION_MAX_ERROR_PROPERTY_SCAN_DEPTH) {
    return null;
  }

  for (const key of HOSTED_EXECUTION_ERROR_PROPERTY_CONTAINER_KEYS) {
    const nestedValue = (value as Record<string, unknown>)[key];
    const nested = readHostedExecutionNestedStringProperty(nestedValue, keys, {
      depth: state.depth + 1,
      visited: state.visited,
    });

    if (nested) {
      return nested;
    }
  }

  return null;
}

function readHostedExecutionNumericErrorProperty(
  error: unknown,
  keys: readonly string[],
  minimum: number,
  maximum: number,
): number | null {
  return readHostedExecutionNestedNumericProperty(error, keys, minimum, maximum, {
    depth: 0,
    visited: new Set<object>(),
  });
}

function readHostedExecutionNestedNumericProperty(
  value: unknown,
  keys: readonly string[],
  minimum: number,
  maximum: number,
  state: {
    depth: number;
    visited: Set<object>;
  },
): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (state.visited.has(value)) {
    return null;
  }
  state.visited.add(value);

  for (const key of keys) {
    const property = (value as Record<string, unknown>)[key];

    if (
      typeof property === "number"
      && Number.isInteger(property)
      && property >= minimum
      && property <= maximum
    ) {
      return property;
    }
  }

  if (state.depth >= HOSTED_EXECUTION_MAX_ERROR_PROPERTY_SCAN_DEPTH) {
    return null;
  }

  for (const key of HOSTED_EXECUTION_ERROR_PROPERTY_CONTAINER_KEYS) {
    const nestedValue = (value as Record<string, unknown>)[key];
    const nested = readHostedExecutionNestedNumericProperty(
      nestedValue,
      keys,
      minimum,
      maximum,
      {
        depth: state.depth + 1,
        visited: state.visited,
      },
    );

    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

function readHostedExecutionObjectErrorProperty(
  error: unknown,
  keys: readonly string[],
): HostedExecutionStructuredLogDetails | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = (error as Record<string, unknown>)[key];

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as HostedExecutionStructuredLogDetails;
    }
  }

  return null;
}
