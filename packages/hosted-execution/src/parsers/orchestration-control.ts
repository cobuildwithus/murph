import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
  type HostedMailboxLaneLag,
  type HostedWorkspaceInvocationReason,
} from "../runtime-control.ts";
import {
  HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS,
  HOSTED_RUNTIME_PREWARM_ACCEPTED_ACTIONS,
  HOSTED_RUNTIME_PREWARM_RESPONSE_KINDS,
  HOSTED_RUNTIME_PREWARM_SOURCES,
  HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS,
  HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS,
  HOSTED_RUNTIME_SIGNAL_KINDS,
  type HostedRuntimeEnsureProcessingRequest,
  type HostedRuntimeEnsureProcessingResponse,
  type HostedRuntimePrewarmRequest,
  type HostedRuntimePrewarmResponse,
  type HostedRuntimePrewarmSource,
  type HostedRuntimeReconciliationFacts,
  type HostedRuntimeReconciliationFactsBlocked,
  type HostedRuntimeReconciliationFactsRequest,
  type HostedRuntimeReconciliationFactsWorkspace,
  type HostedRuntimeSignal,
} from "../orchestration-control.ts";
import {
  requireArray,
  requireObject,
  requireString,
  readNullableString,
} from "./assertions.ts";
import {
  parseHostedMailboxLane,
} from "./runtime-control.ts";

export function parseHostedRuntimeSignal(value: unknown): HostedRuntimeSignal {
  const record = requireObject(value, "Hosted runtime signal");
  const kind = parseAllowedString(
    record.kind,
    "Hosted runtime signal kind",
    HOSTED_RUNTIME_SIGNAL_KINDS,
  );

  switch (kind) {
    case "mailbox_appended": {
      assertExactKeys(record, "Hosted runtime mailbox signal", [
        "kind",
        "lane",
        "laneSeq",
        "mailboxItemId",
      ]);

      return {
        kind,
        lane: parseHostedMailboxLane(record.lane),
        laneSeq: requireNonNegativeBigIntString(
          record.laneSeq,
          "Hosted runtime mailbox signal laneSeq",
        ),
        mailboxItemId: requireOpaqueIdentifier(
          record.mailboxItemId,
          "Hosted runtime mailbox signal mailboxItemId",
        ),
      };
    }
    case "runtime_recheck_requested": {
      assertExactKeys(record, "Hosted runtime recheck signal", [
        "kind",
      ]);

      return {
        kind,
      };
    }
    case "runtime_prewarm_requested": {
      assertExactKeys(record, "Hosted runtime prewarm signal", [
        "eventId",
        "kind",
        "occurredAt",
        "source",
      ]);

      return {
        eventId: requireOpaqueIdentifier(
          record.eventId,
          "Hosted runtime prewarm signal eventId",
        ),
        kind,
        occurredAt: readRequiredIsoTimestamp(
          record.occurredAt,
          "Hosted runtime prewarm signal occurredAt",
        ),
        source: parseHostedRuntimePrewarmSource(
          record.source,
          "Hosted runtime prewarm signal source",
        ),
      };
    }
    default: {
      const exhaustive: never = kind;
      throw new TypeError(`Unsupported hosted runtime signal kind: ${String(exhaustive)}.`);
    }
  }
}

export function parseHostedRuntimeReconciliationFactsRequest(
  value: unknown,
): HostedRuntimeReconciliationFactsRequest {
  const record = requireObject(value, "Hosted runtime reconciliation facts request");
  assertExactKeys(record, "Hosted runtime reconciliation facts request", [
    "userId",
  ]);

  return {
    userId: requireOpaqueIdentifier(
      record.userId,
      "Hosted runtime reconciliation facts request userId",
    ),
  };
}

export function parseHostedRuntimeReconciliationFacts(
  value: unknown,
): HostedRuntimeReconciliationFacts {
  const record = requireObject(value, "Hosted runtime reconciliation facts");
  assertExactKeys(record, "Hosted runtime reconciliation facts", [
    "blocked",
    "mailboxLag",
    "workspace",
  ]);

  return {
    blocked: record.blocked === null
      ? null
      : parseHostedRuntimeReconciliationFactsBlocked(record.blocked),
    mailboxLag: parseHostedRuntimeMailboxLaneLagArray(
      record.mailboxLag,
      "Hosted runtime reconciliation facts mailboxLag",
    ),
    workspace: record.workspace === null
      ? null
      : parseHostedRuntimeReconciliationFactsWorkspace(record.workspace),
  };
}

export function parseHostedRuntimeReconciliationFactsBlocked(
  value: unknown,
): HostedRuntimeReconciliationFactsBlocked {
  const record = requireObject(value, "Hosted runtime reconciliation facts blocked");
  assertExactKeys(record, "Hosted runtime reconciliation facts blocked", [
    "reason",
    "retryAt",
  ]);

  return {
    reason: parseAllowedString(
      record.reason,
      "Hosted runtime reconciliation facts blocked reason",
      HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS,
    ),
    retryAt: readRequiredNullableIsoTimestamp(
      record.retryAt,
      "Hosted runtime reconciliation facts blocked retryAt",
    ),
  };
}

export function parseHostedRuntimeReconciliationFactsWorkspace(
  value: unknown,
): HostedRuntimeReconciliationFactsWorkspace {
  const record = requireObject(value, "Hosted runtime reconciliation facts workspace");
  assertExactKeys(record, "Hosted runtime reconciliation facts workspace", [
    "nextWakeAt",
    "nextWakeReason",
    "version",
  ]);

  return {
    nextWakeAt: readRequiredNullableIsoTimestamp(
      record.nextWakeAt,
      "Hosted runtime reconciliation facts workspace nextWakeAt",
    ),
    nextWakeReason: readRequiredNullableBoundedString(
      record.nextWakeReason,
      "Hosted runtime reconciliation facts workspace nextWakeReason",
    ),
    version: readRequiredNullableBoundedString(
      record.version,
      "Hosted runtime reconciliation facts workspace version",
    ),
  };
}

export function parseHostedRuntimeEnsureProcessingRequest(
  value: unknown,
): HostedRuntimeEnsureProcessingRequest {
  const record = requireObject(value, "Hosted runtime ensure-processing request");
  assertExactKeys(record, "Hosted runtime ensure-processing request", [
    "orchestrationAttemptId",
    "reason",
  ]);

  return {
    orchestrationAttemptId: requireOpaqueIdentifier(
      record.orchestrationAttemptId,
      "Hosted runtime ensure-processing request orchestrationAttemptId",
    ),
    reason: parseHostedWorkspaceInvocationReason(
      record.reason,
      "Hosted runtime ensure-processing request reason",
    ),
  };
}

export function parseHostedRuntimeEnsureProcessingResponse(
  value: unknown,
): HostedRuntimeEnsureProcessingResponse {
  const record = requireObject(value, "Hosted runtime ensure-processing response");
  const kind = parseAllowedString(
    record.kind,
    "Hosted runtime ensure-processing response kind",
    HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS,
  );

  switch (kind) {
    case "runtime_processing_accepted": {
      assertExactKeys(record, "Hosted runtime processing-accepted response", [
        "action",
        "kind",
        "recommendedRecheckAt",
        "runtimeAttemptId",
      ]);

      return {
        action: parseAllowedString(
          record.action,
          "Hosted runtime processing-accepted response action",
          HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS,
        ),
        kind,
        recommendedRecheckAt: readRequiredIsoTimestamp(
          record.recommendedRecheckAt,
          "Hosted runtime processing-accepted response recommendedRecheckAt",
        ),
        runtimeAttemptId: requireOpaqueIdentifier(
          record.runtimeAttemptId,
          "Hosted runtime processing-accepted response runtimeAttemptId",
        ),
      };
    }
    case "retry_later": {
      assertExactKeys(record, "Hosted runtime processing retry-later response", [
        "kind",
        "retryAt",
      ]);

      return {
        kind,
        retryAt: readRequiredIsoTimestamp(
          record.retryAt,
          "Hosted runtime processing retry-later response retryAt",
        ),
      };
    }
    default: {
      const exhaustive: never = kind;
      throw new TypeError(
        `Unsupported hosted runtime ensure-processing response kind: ${String(exhaustive)}.`,
      );
    }
  }
}

export function parseHostedRuntimePrewarmRequest(
  value: unknown,
): HostedRuntimePrewarmRequest {
  const record = requireObject(value, "Hosted runtime prewarm request");
  assertExactKeys(record, "Hosted runtime prewarm request", [
    "prewarmAttemptId",
    "source",
  ]);

  return {
    prewarmAttemptId: requireOpaqueIdentifier(
      record.prewarmAttemptId,
      "Hosted runtime prewarm request prewarmAttemptId",
    ),
    source: parseHostedRuntimePrewarmSource(
      record.source,
      "Hosted runtime prewarm request source",
    ),
  };
}

export function parseHostedRuntimePrewarmResponse(
  value: unknown,
): HostedRuntimePrewarmResponse {
  const record = requireObject(value, "Hosted runtime prewarm response");
  const kind = parseAllowedString(
    record.kind,
    "Hosted runtime prewarm response kind",
    HOSTED_RUNTIME_PREWARM_RESPONSE_KINDS,
  );

  switch (kind) {
    case "runtime_prewarm_accepted": {
      assertExactKeys(record, "Hosted runtime prewarm-accepted response", [
        "action",
        "kind",
      ]);

      return {
        action: parseAllowedString(
          record.action,
          "Hosted runtime prewarm-accepted response action",
          HOSTED_RUNTIME_PREWARM_ACCEPTED_ACTIONS,
        ),
        kind,
      };
    }
    case "retry_later": {
      assertExactKeys(record, "Hosted runtime prewarm retry-later response", [
        "kind",
        "retryAt",
      ]);

      return {
        kind,
        retryAt: readRequiredIsoTimestamp(
          record.retryAt,
          "Hosted runtime prewarm retry-later response retryAt",
        ),
      };
    }
    default: {
      const exhaustive: never = kind;
      throw new TypeError(
        `Unsupported hosted runtime prewarm response kind: ${String(exhaustive)}.`,
      );
    }
  }
}

function parseHostedRuntimeMailboxLaneLagArray(
  value: unknown,
  label: string,
): HostedMailboxLaneLag[] {
  return requireArray(value, label)
    .map((entry, index) => parseHostedRuntimeMailboxLaneLag(entry, `${label}[${index}]`));
}

function parseHostedRuntimeMailboxLaneLag(
  value: unknown,
  label: string,
): HostedMailboxLaneLag {
  const record = requireObject(value, label);
  assertExactKeys(record, label, [
    "importedSeq",
    "lag",
    "lane",
    "maxSeq",
    "maxUpdatedAt",
  ]);

  return {
    importedSeq: requireNonNegativeBigIntString(record.importedSeq, `${label}.importedSeq`),
    lag: requireNonNegativeBigIntString(record.lag, `${label}.lag`),
    lane: parseHostedMailboxLane(record.lane),
    maxSeq: requireNonNegativeBigIntString(record.maxSeq, `${label}.maxSeq`),
    ...(record.maxUpdatedAt === undefined
      ? {}
      : {
          maxUpdatedAt: readNullableIsoTimestamp(record.maxUpdatedAt, `${label}.maxUpdatedAt`),
        }),
  };
}

function parseHostedWorkspaceInvocationReason(
  value: unknown,
  label: string,
): HostedWorkspaceInvocationReason {
  return parseAllowedString(value, label, HOSTED_WORKSPACE_INVOCATION_REASONS);
}

function parseHostedRuntimePrewarmSource(
  value: unknown,
  label: string,
): HostedRuntimePrewarmSource {
  return parseAllowedString(value, label, HOSTED_RUNTIME_PREWARM_SOURCES);
}

function requireOpaqueIdentifier(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (text.length > 192 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text)) {
    throw new TypeError(`${label} must be a bounded opaque identifier.`);
  }

  return text;
}

function requireNonNegativeBigIntString(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (!/^[0-9]+$/u.test(text)) {
    throw new TypeError(`${label} must be a non-negative base-10 integer string.`);
  }

  return text;
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  const text = readNullableString(value, label);

  if (text === null) {
    return null;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text)
    || Number.isNaN(Date.parse(text))
  ) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return text;
}

function readRequiredNullableIsoTimestamp(value: unknown, label: string): string | null {
  if (value === undefined) {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return readNullableIsoTimestamp(value, label);
}

function readRequiredIsoTimestamp(value: unknown, label: string): string {
  const timestamp = readRequiredNullableIsoTimestamp(value, label);
  if (timestamp === null) {
    throw new TypeError(`${label} must be a string.`);
  }
  return timestamp;
}

function readRequiredNullableBoundedString(value: unknown, label: string): string | null {
  if (value === undefined) {
    throw new TypeError(`${label} must be a string or null.`);
  }
  const text = readNullableString(value, label);
  if (text === null) {
    return null;
  }
  if (text.length > 256 || text.trim() !== text || /[\u0000-\u001F\u007F]/u.test(text)) {
    throw new TypeError(`${label} must be a bounded string or null.`);
  }
  return text;
}

function parseAllowedString<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  const text = requireString(value, label);

  if (allowed.includes(text as T)) {
    return text as T;
  }

  throw new TypeError(`${label} is not supported.`);
}

function assertExactKeys(
  record: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} must not include ${key}.`);
    }
  }
}
