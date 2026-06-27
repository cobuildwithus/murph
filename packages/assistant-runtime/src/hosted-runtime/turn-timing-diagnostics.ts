import {
  HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
  HOSTED_ASSISTANT_TURN_TIMING_TYPE,
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

const HOSTED_ASSISTANT_TURN_TIMING_STAGES = new Set([
  "provider-result-returned",
  "usage-recorded",
  "turn-artifacts-finalized",
  "reply-dispatched",
  "scan-state-persisted",
  "automation-pass-finished",
  "foreground-delivery-phase-started",
  "foreground-delivery-phase-finished",
]);

const HOSTED_ASSISTANT_TURN_TIMING_PROVIDER_OUTCOME_KINDS = new Set([
  "failed_terminal",
  "succeeded",
]);

const HOSTED_ASSISTANT_TURN_TIMING_DELIVERY_OUTCOME_KINDS = new Set([
  "failed",
  "not-requested",
  "queued",
  "sent",
]);

type HostedTurnTimingDetailValue = boolean | number | string | null;
type HostedTurnTimingDetailReader = (
  debug: Record<string, unknown>,
  key: string,
) => HostedTurnTimingDetailValue | undefined;

const hostedTurnTimingDetailReaders = {
  currentTurnDeliveryIntentCount: readHostedTurnTimingNonnegativeNumber,
  deliveryAttempted: readHostedTurnTimingBoolean,
  deliveryIntentPresent: readHostedTurnTimingBoolean,
  deliveryOutcomeKind: readHostedTurnTimingDeliveryOutcomeKind,
  finalReplySelected: readHostedTurnTimingBoolean,
  foregroundAssistantPass: readHostedTurnTimingBoolean,
  providerOutcomeKind: readHostedTurnTimingProviderOutcomeKind,
  providerRequestOrdinal: readHostedTurnTimingNonnegativeNumber,
  scanStateChanged: readHostedTurnTimingBoolean,
  turnTimingElapsedMs: readHostedTurnTimingNonnegativeNumber,
  turnTimingProviderRequestElapsedMs: readHostedTurnTimingNonnegativeNumber,
  turnTimingSinceProviderResultMs: readHostedTurnTimingNonnegativeNumber,
  turnTimingStage: readHostedTurnTimingStage,
  turnTimingStepElapsedMs: readHostedTurnTimingNonnegativeNumber,
} as const satisfies Record<string, HostedTurnTimingDetailReader>;

export function emitHostedAssistantTurnTimingTraceLog(input: {
  event: unknown;
  wake: HostedRuntimeEvent;
}): HostedExecutionRedactedLogEntry | null {
  const diagnostic = readHostedAssistantTurnTimingTrace(input.event);
  if (!diagnostic) {
    return null;
  }

  const redactedDetails = sanitizeHostedExecutionStructuredLogDetails(diagnostic);
  const message = "Hosted assistant turn timing milestone captured.";

  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: redactedDetails,
    message,
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime",
    eventId: input.wake.eventId,
    level: "info",
    message,
    phase: "wake.running",
    redacted: redactedDetails,
  };
}

export function readHostedAssistantTurnTimingTrace(
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
  const schema = readHostedTurnTimingString(record, "schema");
  const type = readHostedTurnTimingString(record, "type");
  if (
    schema !== HOSTED_ASSISTANT_TURN_TIMING_SCHEMA
    || type !== HOSTED_ASSISTANT_TURN_TIMING_TYPE
  ) {
    return null;
  }

  const details: HostedExecutionStructuredLogDetails = {
    schema: HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
    type: HOSTED_ASSISTANT_TURN_TIMING_TYPE,
  };
  for (const [key, reader] of Object.entries(hostedTurnTimingDetailReaders)) {
    const value = reader(record, key);
    if (value !== undefined) {
      details[key] = value;
    }
  }

  return details;
}

function readHostedTurnTimingStage(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedTurnTimingAllowedString(
    debug,
    key,
    HOSTED_ASSISTANT_TURN_TIMING_STAGES,
  );
}

function readHostedTurnTimingProviderOutcomeKind(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedTurnTimingAllowedString(
    debug,
    key,
    HOSTED_ASSISTANT_TURN_TIMING_PROVIDER_OUTCOME_KINDS,
  );
}

function readHostedTurnTimingDeliveryOutcomeKind(
  debug: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readHostedTurnTimingAllowedString(
    debug,
    key,
    HOSTED_ASSISTANT_TURN_TIMING_DELIVERY_OUTCOME_KINDS,
  );
}

function readHostedTurnTimingAllowedString(
  debug: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
): string | null | undefined {
  const value = debug[key];
  if (value === null) {
    return null;
  }
  const stringValue = readHostedTurnTimingString(debug, key);
  return stringValue && allowedValues.has(stringValue) ? stringValue : undefined;
}

function readHostedTurnTimingBoolean(
  debug: Record<string, unknown>,
  key: string,
): boolean | null | undefined {
  const value = debug[key];
  if (value === null || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function readHostedTurnTimingNonnegativeNumber(
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

function readHostedTurnTimingString(
  debug: Record<string, unknown>,
  key: string,
): string | null {
  const value = debug[key];
  return typeof value === "string" ? value : null;
}
