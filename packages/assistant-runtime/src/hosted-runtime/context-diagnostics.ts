import {
  HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA,
  HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_TYPE,
} from "@murphai/assistant-engine";
import type {
  HostedExecutionRedactedLogEntry,
  HostedExecutionStructuredLogDetails,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";

const HOSTED_CONTEXT_DIAGNOSTIC_CHANNELS = new Set([
  "email",
  "linq",
  "telegram",
]);

const HOSTED_CONTEXT_DIAGNOSTIC_SCOPES = new Set([
  "actor",
  "none",
  "thread",
]);

const HOSTED_CONTEXT_DIAGNOSTIC_SOURCES = new Set([
  "assistant-message",
  "assistant-notification",
]);

const HOSTED_CONTEXT_DIAGNOSTIC_SESSION_LOOKUP_SOURCES = new Set([
  "alias",
  "conversation-key",
  "created",
  "session-id",
]);

const HOSTED_CONTEXT_DIAGNOSTIC_STAGES = new Set([
  "assistant-pre-provider-ready",
  "assistant-session-resolved",
  "assistant-turn-lock-acquired",
]);

const HOSTED_CONTEXT_DIAGNOSTIC_FINGERPRINT_PATTERN =
  /^h1_[a-f0-9]{24}$/u;

type HostedContextDiagnosticDetailValue = boolean | number | string | null;
type HostedContextDiagnosticDetailReader = (
  debug: Record<string, unknown>,
  key: string,
) => HostedContextDiagnosticDetailValue | undefined;

const hostedContextDiagnosticDetailReaders = {
  actorFallbackConversationFingerprint: readHostedContextFingerprint,
  actorFallbackConversationIndexed: readHostedContextBoolean,
  actorFallbackConversationScope: readHostedContextScope,
  actorFingerprint: readHostedContextFingerprint,
  actorPresent: readHostedContextBoolean,
  channel: readHostedContextChannel,
  conversationLookupIndexedCandidateCount: readHostedContextNonnegativeNumber,
  conversationLookupKeyCount: readHostedContextNonnegativeNumber,
  conversationLookupMatchedScope: readHostedContextScope,
  fingerprintReady: readHostedContextBoolean,
  identityFingerprint: readHostedContextFingerprint,
  identityPresent: readHostedContextBoolean,
  primaryConversationFingerprint: readHostedContextFingerprint,
  primaryConversationIndexed: readHostedContextBoolean,
  primaryConversationScope: readHostedContextScope,
  preProviderAdmissionCount: readHostedContextNonnegativeNumber,
  preProviderSetupMs: readHostedContextNonnegativeNumber,
  providerRequestOrdinal: readHostedContextNonnegativeNumber,
  sessionFingerprint: readHostedContextFingerprint,
  sessionPresent: readHostedContextBoolean,
  sessionResolutionCreated: readHostedContextBoolean,
  sessionResolutionLookupSource: readHostedContextSessionLookupSource,
  sessionTurnCount: readHostedContextNonnegativeNumber,
  source: readHostedContextSource,
  stage: readHostedContextStage,
  threadFingerprint: readHostedContextFingerprint,
  threadIsDirect: readHostedContextBoolean,
  threadPresent: readHostedContextBoolean,
  turnLockWaitMs: readHostedContextNonnegativeNumber,
} as const satisfies Record<string, HostedContextDiagnosticDetailReader>;

export function emitHostedAssistantContextTraceLog(input: {
  event: unknown;
  wake: HostedRuntimeEvent;
}): HostedExecutionRedactedLogEntry | null {
  const diagnostic = readHostedAssistantContextDiagnosticTrace(input.event);
  if (!diagnostic) {
    return null;
  }

  const redactedDetails = sanitizeHostedExecutionStructuredLogDetails(diagnostic);

  const message = diagnostic.stage === "assistant-session-resolved"
    ? "Hosted assistant context fingerprints captured."
    : "Hosted assistant context timing captured.";

  emitHostedExecutionStructuredLog({
    component: "runtime.context",
    details: redactedDetails,
    message,
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime.context",
    eventId: input.wake.eventId,
    level: "info",
    message,
    phase: "wake.running",
    redacted: redactedDetails,
  };
}

function readHostedAssistantContextDiagnosticTrace(
  event: unknown,
): HostedExecutionStructuredLogDetails | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  const rawEvent = (event as { rawEvent?: unknown }).rawEvent;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const record = rawEvent as Record<string, unknown>;
  const schema = readHostedContextDiagnosticString(record, "schema");
  const type = readHostedContextDiagnosticString(record, "type");
  if (
    schema !== HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA ||
    type !== HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_TYPE
  ) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    schema: HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA,
  };
  for (const [key, reader] of Object.entries(hostedContextDiagnosticDetailReaders)) {
    const value = reader(record, key);
    if (value !== undefined) {
      details[key] = value;
    }
  }

  return details;
}

function readHostedContextStage(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedContextAllowedString(
    debug,
    key,
    HOSTED_CONTEXT_DIAGNOSTIC_STAGES,
  );
}

function readHostedContextSource(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedContextAllowedString(
    debug,
    key,
    HOSTED_CONTEXT_DIAGNOSTIC_SOURCES,
  );
}

function readHostedContextSessionLookupSource(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedContextAllowedString(
    debug,
    key,
    HOSTED_CONTEXT_DIAGNOSTIC_SESSION_LOOKUP_SOURCES,
  );
}

function readHostedContextChannel(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedContextAllowedString(
    debug,
    key,
    HOSTED_CONTEXT_DIAGNOSTIC_CHANNELS,
  );
}

function readHostedContextScope(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedContextAllowedString(
    debug,
    key,
    HOSTED_CONTEXT_DIAGNOSTIC_SCOPES,
  );
}

function readHostedContextAllowedString(
  debug: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
): string | null | undefined {
  const value = debug[key];
  if (value === null) {
    return null;
  }
  const stringValue = readHostedContextDiagnosticString(debug, key);
  return stringValue && allowedValues.has(stringValue) ? stringValue : undefined;
}

function readHostedContextFingerprint(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = debug[key];
  if (value === null) {
    return null;
  }
  const stringValue = readHostedContextDiagnosticString(debug, key);
  return stringValue && HOSTED_CONTEXT_DIAGNOSTIC_FINGERPRINT_PATTERN.test(stringValue)
    ? stringValue
    : undefined;
}

function readHostedContextBoolean(
  debug: Record<string, unknown>,
  key: string,
): boolean | null | undefined {
  const value = debug[key];
  if (value === null || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function readHostedContextNonnegativeNumber(
  debug: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const value = debug[key];
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readHostedContextDiagnosticString(
  debug: Record<string, unknown>,
  key: string,
): string | null {
  const value = debug[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
