import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
  type HostedMailboxLaneLag,
  type HostedWorkspaceInvocationReason,
} from "../runtime-control.ts";
import {
  HOSTED_RUNTIME_DEMAND_BLOCKED_REASONS,
  HOSTED_RUNTIME_DEMAND_KINDS,
  HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS,
  HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS,
  HOSTED_RUNTIME_SIGNAL_KINDS,
  type HostedRuntimeDemand,
  type HostedRuntimeDemandRequest,
  type HostedRuntimeDemandWorkspaceProjection,
  type HostedRuntimeEnsureProcessingRequest,
  type HostedRuntimeEnsureProcessingResponse,
  type HostedRuntimeSignal,
} from "../orchestration-control.ts";
import {
  requireArray,
  requireBoolean,
  requireObject,
  requireString,
  readNullableString,
} from "./assertions.ts";
import {
  parseHostedRuntimeDemandRunSource,
} from "./demand-source.ts";
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
        "source",
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
        source: requireSafeRuntimeSignalSource(
          record.source,
          "Hosted runtime mailbox signal source",
        ),
      };
    }
    case "manual_run_requested": {
      assertExactKeys(record, "Hosted runtime manual-run signal", [
        "kind",
      ]);

      return {
        kind,
      };
    }
    case "browser_vault_refresh_requested": {
      assertExactKeys(record, "Hosted runtime browser-vault refresh signal", [
        "kind",
      ]);

      return {
        kind,
      };
    }
    case "device_sync_recovery_requested": {
      assertExactKeys(record, "Hosted runtime device-sync recovery signal", [
        "kind",
      ]);

      return {
        kind,
      };
    }
    case "mailbox_lag_observed": {
      assertExactKeys(record, "Hosted runtime mailbox-lag signal", [
        "kind",
      ]);

      return {
        kind,
      };
    }
    default: {
      const exhaustive: never = kind;
      throw new TypeError(`Unsupported hosted runtime signal kind: ${String(exhaustive)}.`);
    }
  }
}

export function parseHostedRuntimeDemandRequest(
  value: unknown,
): HostedRuntimeDemandRequest {
  const record = requireObject(value, "Hosted runtime demand request");
  assertExactKeys(record, "Hosted runtime demand request", [
    "browserVaultRefreshRequested",
    "deviceSyncRecoveryRequested",
    "lagRecoveryObserved",
    "manualRunRequested",
    "userId",
  ]);

  return {
    ...(record.browserVaultRefreshRequested === undefined
      ? {}
      : {
          browserVaultRefreshRequested: requireBoolean(
            record.browserVaultRefreshRequested,
            "Hosted runtime demand request browserVaultRefreshRequested",
          ),
        }),
    ...(record.deviceSyncRecoveryRequested === undefined
      ? {}
      : {
          deviceSyncRecoveryRequested: requireBoolean(
            record.deviceSyncRecoveryRequested,
            "Hosted runtime demand request deviceSyncRecoveryRequested",
          ),
        }),
    ...(record.lagRecoveryObserved === undefined
      ? {}
      : {
          lagRecoveryObserved: requireBoolean(
            record.lagRecoveryObserved,
            "Hosted runtime demand request lagRecoveryObserved",
          ),
        }),
    ...(record.manualRunRequested === undefined
      ? {}
      : {
          manualRunRequested: requireBoolean(
            record.manualRunRequested,
            "Hosted runtime demand request manualRunRequested",
          ),
        }),
    userId: requireOpaqueIdentifier(record.userId, "Hosted runtime demand request userId"),
  };
}

export function parseHostedRuntimeDemand(value: unknown): HostedRuntimeDemand {
  const record = requireObject(value, "Hosted runtime demand");
  const kind = parseAllowedString(
    record.kind,
    "Hosted runtime demand kind",
    HOSTED_RUNTIME_DEMAND_KINDS,
  );

  switch (kind) {
    case "run": {
      assertExactKeys(record, "Hosted runtime run demand", [
        "kind",
        "mailboxLag",
        "reason",
        "source",
        "workspace",
      ]);

      return {
        kind,
        mailboxLag: parseHostedRuntimeMailboxLaneLagArray(
          record.mailboxLag,
          "Hosted runtime run demand mailboxLag",
        ),
        reason: parseHostedWorkspaceInvocationReason(
          record.reason,
          "Hosted runtime run demand reason",
        ),
        source: parseHostedRuntimeDemandRunSource(
          record.source,
          "Hosted runtime run demand source",
        ),
        workspace: record.workspace === null
          ? null
          : parseHostedRuntimeDemandWorkspaceProjection(record.workspace),
      };
    }
    case "idle": {
      assertExactKeys(record, "Hosted runtime idle demand", [
        "kind",
        "mailboxLag",
        "nextWakeAt",
        "workspace",
      ]);

      return {
        kind,
        mailboxLag: parseHostedRuntimeMailboxLaneLagArray(
          record.mailboxLag,
          "Hosted runtime idle demand mailboxLag",
        ),
        nextWakeAt: readRequiredNullableIsoTimestamp(
          record.nextWakeAt,
          "Hosted runtime idle demand nextWakeAt",
        ),
        workspace: record.workspace === null
          ? null
          : parseHostedRuntimeDemandWorkspaceProjection(record.workspace),
      };
    }
    case "blocked": {
      assertExactKeys(record, "Hosted runtime blocked demand", [
        "kind",
        "mailboxLag",
        "reason",
        "retryAt",
        "workspace",
      ]);

      return {
        kind,
        mailboxLag: parseHostedRuntimeMailboxLaneLagArray(
          record.mailboxLag,
          "Hosted runtime blocked demand mailboxLag",
        ),
        reason: parseAllowedString(
          record.reason,
          "Hosted runtime blocked demand reason",
          HOSTED_RUNTIME_DEMAND_BLOCKED_REASONS,
        ),
        retryAt: readRequiredNullableIsoTimestamp(
          record.retryAt,
          "Hosted runtime blocked demand retryAt",
        ),
        workspace: record.workspace === null
          ? null
          : parseHostedRuntimeDemandWorkspaceProjection(record.workspace),
      };
    }
    default: {
      const exhaustive: never = kind;
      throw new TypeError(`Unsupported hosted runtime demand kind: ${String(exhaustive)}.`);
    }
  }
}

export function parseHostedRuntimeEnsureProcessingRequest(
  value: unknown,
): HostedRuntimeEnsureProcessingRequest {
  const record = requireObject(value, "Hosted runtime ensure-processing request");
  assertExactKeys(record, "Hosted runtime ensure-processing request", [
    "orchestrationAttemptId",
    "reason",
    "source",
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
    ...(record.source === undefined || record.source === null
      ? {}
      : {
          source: parseHostedRuntimeDemandRunSource(
            record.source,
            "Hosted runtime ensure-processing request source",
          ),
        }),
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

function parseHostedRuntimeMailboxLaneLagArray(
  value: unknown,
  label: string,
): HostedMailboxLaneLag[] {
  return requireArray(value, label)
    .map((entry, index) => parseHostedRuntimeMailboxLaneLag(entry, `${label}[${index}]`));
}

function parseHostedRuntimeDemandWorkspaceProjection(
  value: unknown,
): HostedRuntimeDemandWorkspaceProjection {
  const record = requireObject(value, "Hosted runtime demand workspace projection");
  assertExactKeys(record, "Hosted runtime demand workspace projection", [
    "nextWakeAt",
    "nextWakeReason",
    "version",
  ]);

  return {
    nextWakeAt: readRequiredNullableIsoTimestamp(
      record.nextWakeAt,
      "Hosted runtime demand workspace projection nextWakeAt",
    ),
    nextWakeReason: readRequiredNullableBoundedString(
      record.nextWakeReason,
      "Hosted runtime demand workspace projection nextWakeReason",
    ),
    version: readRequiredNullableBoundedString(
      record.version,
      "Hosted runtime demand workspace projection version",
    ),
  };
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

function requireOpaqueIdentifier(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (text.length > 192 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text)) {
    throw new TypeError(`${label} must be a bounded opaque identifier.`);
  }

  return text;
}

function requireSafeRuntimeSignalSource(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (
    text.length > 64
    || text.trim() !== text
    || !/^[a-z0-9._:-]+$/u.test(text)
  ) {
    throw new TypeError(
      `${label} must be a non-empty trimmed safe source string with at most 64 characters.`,
    );
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
