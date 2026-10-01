import {
  isHostedAssistantReasoningEffort,
  type HostedAssistantReasoningEffort,
} from "../assistant-model.ts";
import {
  HOSTED_MAILBOX_LANES,
  HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT,
  HOSTED_RUNTIME_LOG_COMPONENTS,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_LEVELS,
  HOSTED_RUNTIME_LOG_PHASES,
  HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
  HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH,
  type HostedRuntimeLogComponent,
  type HostedRuntimeLogEntry,
  type HostedRuntimeLogEventCode,
  type HostedRuntimeLogLevel,
  type HostedRuntimeLogPhase,
  type HostedRuntimeLogRequest,
  type HostedRuntimeLogResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeRedactedObject,
  type HostedRuntimeRedactedScalar,
  type HostedRuntimeRedactedValue,
} from "../runtime-control.ts";
import {
  parseAllowedString,
  readNullableString,
  requireArray,
  requireNonNegativeBigIntString,
  requireNonNegativeInteger,
  requireObject,
  requireString,
} from "./assertions.ts";

const FORBIDDEN_RAW_REDACTED_KEY_NAMES = [
  "address",
  "authorization",
  "body",
  "cookie",
  "email",
  "header",
  "message",
  "path",
  "payload",
  "phone",
  "prompt",
  "raw",
  "secret",
  "text",
  "token",
] as const;
const SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_NAMES = new Set([
  "authorizationHeaderValue",
  "assistantContextSnapshotRefreshAttempted",
  "assistantContextSnapshotRefreshed",
  "bodyJson",
  "executionContextHosted",
  "failureAssistantProviderErrorBodyMessage",
  "failureAssistantProviderErrorMessage",
  "failureAssistantProviderErrorStatusText",
  "messageContent",
  "messageText",
  "payload",
  "payloadValue",
  "providerHttpStatusText",
  "providerRequestBodyFieldNames",
  "routePlanningActiveExperimentContextElapsedMs",
  "routePlanningAssistantContextSnapshotElapsedMs",
  "routePlanningAnyBootstrapContextPrepared",
  "routePlanningBootstrapContextPrepared",
  "routePlanningPrimarySystemPromptElapsedMs",
  "safeErrorMessage",
  "tokenPreview",
]);
const BOOLEAN_REDACTED_KEY_NAMES = new Set([
  "assistantContextSnapshotRefreshAttempted",
  "assistantContextSnapshotRefreshed",
]);
const SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.-]{0,127}(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u;
const HOSTED_RUNTIME_DIRECT_ID_TEXT_PATTERNS: readonly RegExp[] = [
  /\bhosted-user-runtime:[A-Za-z0-9._:-]+/u,
  /\b(?:member|user)_[A-Za-z0-9._:-]*\d[A-Za-z0-9._:-]*/u,
];
const ROUTE_PLANNING_ELAPSED_MS_REDACTED_KEY_NAMES = new Set([
  "routePlanningActiveExperimentContextElapsedMs",
  "routePlanningAssistantContextSnapshotElapsedMs",
  "routePlanningCliBootstrapElapsedMs",
  "routePlanningElapsedMs",
  "routePlanningFallbackInstructionsElapsedMs",
  "routePlanningMeasuredElapsedMs",
  "routePlanningMemoryOverviewElapsedMs",
  "routePlanningPrimaryInstructionsElapsedMs",
  "routePlanningPrimarySystemPromptElapsedMs",
  "routePlanningResumeBindingElapsedMs",
  "routePlanningSlowestStageElapsedMs",
  "routePlanningSupportedExperimentProtocolsElapsedMs",
  "routePlanningTargetCapabilitiesElapsedMs",
  "routePlanningUnaccountedElapsedMs",
  "routePlanningVaultOverviewElapsedMs",
]);
const ROUTE_PLANNING_STAGE_VALUES = new Set([
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
const ROUTE_PLANNING_REDACTED_KEY_NAMES = new Set([
  ...ROUTE_PLANNING_ELAPSED_MS_REDACTED_KEY_NAMES,
  "routePlanningAnyBootstrapContextPrepared",
  "routePlanningBootstrapContextPrepared",
  "routePlanningSlowestStage",
]);
const SAFE_REDACTED_METADATA_KEY_SUFFIXES = [
  "Available",
  "Bytes",
  "Code",
  "Codes",
  "Count",
  "Counts",
  "Index",
  "Indexes",
  "Kind",
  "Kinds",
  "Length",
  "Lengths",
  "Ordinal",
  "Ordinals",
  "Present",
  "Seq",
  "Seqs",
  "Size",
  "Sizes",
  "Status",
  "Statuses",
  "Type",
  "Types",
] as const;
const HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS = 96;
const HOSTED_RUNTIME_REDACTED_OBJECT_MAX_KEYS = 16;
const HOSTED_RUNTIME_DEVICE_SYNC_JOB_TIMING_MAX_KEYS = 32;
const HOSTED_RUNTIME_REDACTED_OBJECT_ARRAY_KEYS = new Set([
  "companionSyncAttempts",
  "codexActionToolSummaries",
  "deliveryErrorSummaries",
  "deviceSyncJobTimingSummaries",
]);
const HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH = 2048;
const HOSTED_RUNTIME_LOG_ENTRY_KEYS = new Set([
  "at",
  "attemptId",
  "checkpointVersion",
  "component",
  "errorCode",
  "eventCode",
  "leaseGeneration",
  "level",
  "mailboxLane",
  "mailboxSeqEnd",
  "mailboxSeqStart",
  "outboxIntentRef",
  "phase",
  "redactedJson",
  "workspaceVersion",
]);

export function parseHostedRuntimeLogEntry(
  value: unknown,
): HostedRuntimeLogEntry {
  const record = requireObject(value, "Hosted runtime log entry");
  assertNoForbiddenRuntimeLogKeys(record, "Hosted runtime log entry");

  const parsed: HostedRuntimeLogEntry = {
    at: requireString(record.at, "Hosted runtime log entry at"),
    ...(record.attemptId === undefined
      ? {}
      : {
          attemptId: readNullableHostedRuntimeLogString(
            record.attemptId,
            "Hosted runtime log entry attemptId",
          ),
        }),
    ...(record.checkpointVersion === undefined
      ? {}
      : {
          checkpointVersion:
            record.checkpointVersion === null
              ? null
              : requireNonNegativeBigIntString(
                  record.checkpointVersion,
                  "Hosted runtime log entry checkpointVersion",
                ),
        }),
    component: parseHostedRuntimeLogComponent(record.component),
    ...(record.errorCode === undefined
      ? {}
      : {
          errorCode: readNullableHostedRuntimeLogString(
            record.errorCode,
            "Hosted runtime log entry errorCode",
          ),
        }),
    eventCode: parseHostedRuntimeLogEventCode(record.eventCode),
    ...(record.leaseGeneration === undefined
      ? {}
      : {
          leaseGeneration:
            record.leaseGeneration === null
              ? null
              : requireNonNegativeBigIntString(
                  record.leaseGeneration,
                  "Hosted runtime log entry leaseGeneration",
                ),
        }),
    level: parseHostedRuntimeLogLevel(record.level),
    ...(record.mailboxLane === undefined
      ? {}
      : {
          mailboxLane:
            record.mailboxLane === null
              ? null
              : parseAllowedString(
                  record.mailboxLane,
                  "Hosted mailbox lane",
                  HOSTED_MAILBOX_LANES,
                ),
        }),
    ...(record.mailboxSeqEnd === undefined
      ? {}
      : {
          mailboxSeqEnd:
            record.mailboxSeqEnd === null
              ? null
              : requireNonNegativeBigIntString(
                  record.mailboxSeqEnd,
                  "Hosted runtime log entry mailboxSeqEnd",
                ),
        }),
    ...(record.mailboxSeqStart === undefined
      ? {}
      : {
          mailboxSeqStart:
            record.mailboxSeqStart === null
              ? null
              : requireNonNegativeBigIntString(
                  record.mailboxSeqStart,
                  "Hosted runtime log entry mailboxSeqStart",
                ),
        }),
    ...(record.outboxIntentRef === undefined
      ? {}
      : {
          outboxIntentRef: readNullableHostedRuntimeLogString(
            record.outboxIntentRef,
            "Hosted runtime log entry outboxIntentRef",
          ),
        }),
    phase: parseHostedRuntimeLogPhase(record.phase),
    ...(record.redactedJson === undefined
      ? {}
      : {
          redactedJson: parseHostedRuntimeRedactedJson(
            record.redactedJson,
            "Hosted runtime log entry redactedJson",
          ),
        }),
    ...(record.workspaceVersion === undefined
      ? {}
      : {
          workspaceVersion:
            record.workspaceVersion === null
              ? null
              : requireNonNegativeBigIntString(
                  record.workspaceVersion,
                  "Hosted runtime log entry workspaceVersion",
                ),
        }),
  };

  return normalizeHostedRuntimeFailureLogEntry(parsed);
}

export function parseHostedRuntimeLogRequest(
  value: unknown,
): HostedRuntimeLogRequest {
  const record = requireObject(value, "Hosted runtime log request");
  const entries = requireArray(
    record.entries,
    "Hosted runtime log request entries",
  );

  if (entries.length > HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES) {
    throw new TypeError(
      `Hosted runtime log request entries must contain at most ${HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES} entries.`,
    );
  }

  return {
    entries: entries.map((entry) => parseHostedRuntimeLogEntry(entry)),
  };
}

export function parseHostedRuntimeLogResponse(
  value: unknown,
): HostedRuntimeLogResponse {
  const record = requireObject(value, "Hosted runtime log response");

  return {
    loggedCount: requireNonNegativeInteger(
      record.loggedCount,
      "Hosted runtime log response loggedCount",
    ),
  };
}

function parseHostedRuntimeLogLevel(value: unknown): HostedRuntimeLogLevel {
  return parseAllowedString(
    value,
    "Hosted runtime log level",
    HOSTED_RUNTIME_LOG_LEVELS,
  );
}

function parseHostedRuntimeLogComponent(
  value: unknown,
): HostedRuntimeLogComponent {
  return parseAllowedString(
    value,
    "Hosted runtime log component",
    HOSTED_RUNTIME_LOG_COMPONENTS,
  );
}

function parseHostedRuntimeLogPhase(value: unknown): HostedRuntimeLogPhase {
  return parseAllowedString(
    value,
    "Hosted runtime log phase",
    HOSTED_RUNTIME_LOG_PHASES,
  );
}

function parseHostedRuntimeLogEventCode(
  value: unknown,
): HostedRuntimeLogEventCode {
  return parseAllowedString(
    value,
    "Hosted runtime log eventCode",
    HOSTED_RUNTIME_LOG_EVENT_CODES,
  );
}

export function parseHostedRuntimeRedactedJson(
  value: unknown,
  label: string,
  reservedKeys?: ReadonlySet<string>,
): HostedRuntimeRedactedJson | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);
  const entries = Object.entries(record);
  const parsed: HostedRuntimeRedactedJson = {};

  const ordinaryEntryCount = reservedKeys
    ? entries.filter(([key]) => !reservedKeys.has(key)).length
    : entries.length;
  if (ordinaryEntryCount > HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS} fields.`,
    );
  }

  for (const [key, entryValue] of entries) {
    assertAllowedRedactedKey(key, `${label}.${key}`);
    parsed[key] = parseHostedRuntimeRedactedValue(
      entryValue,
      `${label}.${key}`,
      key,
    );
  }

  return parsed;
}

function parseHostedRuntimeRedactedValue(
  value: unknown,
  label: string,
  key: string,
): HostedRuntimeRedactedValue {
  if (BOOLEAN_REDACTED_KEY_NAMES.has(key)) {
    return parseHostedRuntimeRedactedBoolean(value, label);
  }
  if (ROUTE_PLANNING_ELAPSED_MS_REDACTED_KEY_NAMES.has(key)) {
    return parseHostedRuntimeRedactedElapsedMs(value, label);
  }
  if (key === "routePlanningSlowestStage") {
    return parseHostedRuntimeRedactedRoutePlanningStage(value, label);
  }
  if (key === "reasoningEffort") {
    return parseHostedRuntimeRedactedReasoningEffort(value, label);
  }

  if (Array.isArray(value)) {
    const maxLength = key === "hostedMailboxSystemDeviceSyncContinuationSeqs"
      ? HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT
      : HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH;
    if (value.length > maxLength) {
      throw new TypeError(
        `${label} must contain at most ${maxLength} redacted values.`,
      );
    }

    if (value.some((entry) => entry && typeof entry === "object")) {
      if (!HOSTED_RUNTIME_REDACTED_OBJECT_ARRAY_KEYS.has(key)) {
        throw new TypeError(
          `${label} must be a shallow redacted scalar or scalar array.`,
        );
      }

      return value.map((entry, index) =>
        parseHostedRuntimeRedactedObject(
          entry,
          `${label}[${index}]`,
          key === "deviceSyncJobTimingSummaries"
            ? HOSTED_RUNTIME_DEVICE_SYNC_JOB_TIMING_MAX_KEYS
            : HOSTED_RUNTIME_REDACTED_OBJECT_MAX_KEYS,
        ),
      );
    }

    return value.map((entry, index) =>
      parseHostedRuntimeRedactedScalar(entry, `${label}[${index}]`),
    );
  }

  return parseHostedRuntimeRedactedScalar(value, label);
}

function parseHostedRuntimeRedactedBoolean(
  value: unknown,
  label: string,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new TypeError(`${label} must be a boolean.`);
}

function parseHostedRuntimeRedactedElapsedMs(
  value: unknown,
  label: string,
): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0) {
      return value;
    }
  }

  throw new TypeError(`${label} must be a nonnegative finite number or null.`);
}

function parseHostedRuntimeRedactedRoutePlanningStage(
  value: unknown,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" && ROUTE_PLANNING_STAGE_VALUES.has(value)) {
    return value;
  }

  throw new TypeError(`${label} must be a known route-planning stage or null.`);
}

function parseHostedRuntimeRedactedReasoningEffort(
  value: unknown,
  label: string,
): HostedAssistantReasoningEffort | null {
  if (value === null) {
    return null;
  }

  if (isHostedAssistantReasoningEffort(value)) {
    return value;
  }

  throw new TypeError(`${label} must be a known reasoning effort or null.`);
}

function parseHostedRuntimeRedactedObject(
  value: unknown,
  label: string,
  maxKeys = HOSTED_RUNTIME_REDACTED_OBJECT_MAX_KEYS,
): HostedRuntimeRedactedObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a redacted object.`);
  }

  const entries = Object.entries(value);
  if (entries.length > maxKeys) {
    throw new TypeError(`${label} must contain at most ${maxKeys} fields.`);
  }

  const parsed: HostedRuntimeRedactedObject = {};
  for (const [key, entryValue] of entries) {
    assertAllowedRedactedKey(key, `${label}.${key}`);
    parsed[key] = BOOLEAN_REDACTED_KEY_NAMES.has(key)
      ? parseHostedRuntimeRedactedBoolean(entryValue, `${label}.${key}`)
      : parseHostedRuntimeRedactedScalar(entryValue, `${label}.${key}`);
  }

  return parsed;
}

function parseHostedRuntimeRedactedScalar(
  value: unknown,
  label: string,
): HostedRuntimeRedactedScalar {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite redacted value.`);
    }

    return value;
  }

  if (typeof value === "string") {
    assertSafeRedactedString(value, label);
    return value;
  }

  throw new TypeError(
    `${label} must be a shallow redacted scalar or scalar array.`,
  );
}

function normalizeHostedRuntimeFailureLogEntry(
  entry: HostedRuntimeLogEntry,
): HostedRuntimeLogEntry {
  const redactedJson = entry.redactedJson ?? null;
  const redactedErrorCode = readHostedRuntimeRedactedStringValue(
    redactedJson,
    "errorCode",
  );
  const errorCode = entry.errorCode ?? redactedErrorCode;
  const normalized =
    errorCode && entry.errorCode !== errorCode
      ? { ...entry, errorCode }
      : entry;

  if (!isHostedRuntimeFailureLogEntry(normalized)) {
    return normalized;
  }

  if (!normalized.errorCode) {
    throw new TypeError(
      "Hosted runtime warn/error failure log entries must include a machine-readable errorCode.",
    );
  }
  if (!hasHostedRuntimeFailureSummary(normalized.redactedJson ?? null)) {
    throw new TypeError(
      "Hosted runtime warn/error failure log entries must include a redacted safe error message, detail, cause, or summary.",
    );
  }

  return normalized;
}

function isHostedRuntimeFailureLogEntry(entry: HostedRuntimeLogEntry): boolean {
  return (
    entry.level === "error" ||
    entry.phase === "error" ||
    entry.eventCode === "runner.error" ||
    entry.eventCode === "checkpoint.snapshot_failed" ||
    entry.eventCode === "mailbox.parser_drain_failed" ||
    entry.eventCode === "mailbox.parser_jobs_failed" ||
    entry.eventCode === "assistant.device_activity_automation_failed" ||
    entry.eventCode === "device-sync.dirty_ack_persistence_failed" ||
    entry.eventCode === "device-sync.job_failed" ||
    entry.eventCode === "device-sync.maintenance_failed" ||
    entry.eventCode === "device-sync.module_load_failed" ||
    (entry.eventCode === "assistant.device_connect" &&
      entry.level === "warn") ||
    (entry.eventCode === "assistant.automation_detail" &&
      entry.level === "warn" &&
      Boolean(entry.errorCode))
  );
}

function hasHostedRuntimeFailureSummary(
  redactedJson: HostedRuntimeRedactedJson | null,
): boolean {
  if (!redactedJson) {
    return false;
  }

  for (const [key, value] of Object.entries(redactedJson)) {
    if (
      isHostedRuntimeFailureSummaryKey(key) &&
      hasHostedRuntimeFailureSummaryValue(value)
    ) {
      return true;
    }
  }

  return false;
}

function isHostedRuntimeFailureSummaryKey(key: string): boolean {
  return (
    key === "safeErrorMessage" ||
    key === "safeErrorDetail" ||
    key === "safeErrorCause" ||
    key === "errorSummary" ||
    key === "failureSummary" ||
    key === "failureSummaries" ||
    /(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u.test(key)
  );
}

function hasHostedRuntimeFailureSummaryValue(
  value: HostedRuntimeRedactedValue,
): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    );
  }

  return false;
}

function readHostedRuntimeRedactedStringValue(
  redactedJson: HostedRuntimeRedactedJson | null,
  key: string,
): string | null {
  const value = redactedJson?.[key];
  if (typeof value !== "string") {
    return null;
  }

  assertSafeHostedRuntimeLogString(
    value,
    `Hosted runtime log entry redactedJson.${key}`,
  );
  return value;
}

function assertAllowedRedactedKey(key: string, label: string): void {
  if (isSafeDiagnosticTextRedactedKey(key)) {
    return;
  }
  if (
    key.startsWith("routePlanning") &&
    !ROUTE_PLANNING_REDACTED_KEY_NAMES.has(key)
  ) {
    throw new TypeError(
      `${label} is not an allowed route-planning diagnostic key.`,
    );
  }

  const normalized = key.toLowerCase();

  for (const forbidden of FORBIDDEN_RAW_REDACTED_KEY_NAMES) {
    if (normalized.includes(forbidden) && !isSafeRedactedMetadataKey(key)) {
      throw new TypeError(
        `${label} is not allowed in hosted runtime redacted JSON.`,
      );
    }
  }
}

function isSafeDiagnosticTextRedactedKey(key: string): boolean {
  return (
    SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_NAMES.has(key) ||
    SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_PATTERN.test(key)
  );
}

function isSafeRedactedMetadataKey(key: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(key) &&
    SAFE_REDACTED_METADATA_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix))
  );
}

function assertNoForbiddenRuntimeLogKeys(
  record: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!HOSTED_RUNTIME_LOG_ENTRY_KEYS.has(key)) {
      throw new TypeError(
        `${label}.${key} is not allowed in hosted runtime log entries.`,
      );
    }
  }
}

function assertSafeRedactedString(value: string, label: string): void {
  if (value.length > HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH) {
    throw new TypeError(
      `${label} must be at most ${HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH} characters.`,
    );
  }

  if (
    /\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s("'])\/(?:Users|home|root|tmp|var|private|mnt|app)\/[^\s)"']+/u.test(
      value,
    )
  ) {
    throw new TypeError(`${label} must not contain a local filesystem path.`);
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    throw new TypeError(`${label} must not contain an email address.`);
  }
  if (/\bhttps?:\/\//iu.test(value)) {
    throw new TypeError(`${label} must not contain a URL.`);
  }
  if (
    /(?:\+\d[\d().\s-]{7,}\d|\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/u.test(
      value,
    )
  ) {
    throw new TypeError(`${label} must not contain a phone number.`);
  }
  if (
    HOSTED_RUNTIME_DIRECT_ID_TEXT_PATTERNS.some((pattern) =>
      pattern.test(value),
    )
  ) {
    throw new TypeError(`${label} must not contain a direct identifier.`);
  }
  if (
    /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*)(?!(?:(?:Basic|Bearer)\s+)?\[redacted\](?=$|\s|[,.;:)}\]](?=$|\s)))["']?([^"',\s}]+)/iu.test(
      value,
    ) ||
    /\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/iu.test(value) ||
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/iu.test(value) ||
    /\bwhsec_[A-Z0-9]+\b/iu.test(value)
  ) {
    throw new TypeError(`${label} must not contain secret-shaped content.`);
  }
}

function readNullableHostedRuntimeLogString(
  value: unknown,
  label: string,
): string | null {
  const text = readNullableString(value, label);

  if (text === null) {
    return null;
  }

  assertSafeHostedRuntimeLogString(text, label);

  return text;
}

function assertSafeHostedRuntimeLogString(value: string, label: string): void {
  assertSafeRedactedString(value, label);

  if (value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new TypeError(
      `${label} must be a bounded opaque identifier or code.`,
    );
  }
}
