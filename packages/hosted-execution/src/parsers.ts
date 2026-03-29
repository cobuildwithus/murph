import { assertContract, sharePackSchema } from "@murph/contracts";

import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionBundleRef,
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeTokenBundle,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionEvent,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedExecutionEventDispatchState,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
  HostedExecutionSharePackResponse,
  HostedExecutionShareReference,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserEnvUpdate,
  HostedExecutionUserStatus,
  HostedExecutionVaultShareAcceptedEvent,
} from "./contracts.ts";
import type {
  HostedExecutionRunContext,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
} from "./observability.ts";
import {
  isHostedExecutionRunLevel,
  isHostedExecutionRunPhase,
} from "./observability.ts";

export function parseHostedExecutionDispatchRequest(value: unknown): HostedExecutionDispatchRequest {
  const record = requireObject(value, "Hosted execution dispatch request");

  return {
    event: parseHostedExecutionEvent(record.event),
    eventId: requireString(record.eventId, "Hosted execution dispatch request eventId"),
    occurredAt: requireString(record.occurredAt, "Hosted execution dispatch request occurredAt"),
  };
}

export function parseHostedExecutionRunnerRequest(value: unknown): HostedExecutionRunnerRequest {
  const record = requireObject(value, "Hosted execution runner request");
  const bundles = requireObject(record.bundles, "Hosted execution runner request bundles");

  return {
    bundles: {
      agentState: readNullableString(
        bundles.agentState,
        "Hosted execution runner request bundles.agentState",
      ),
      vault: readNullableString(
        bundles.vault,
        "Hosted execution runner request bundles.vault",
      ),
    },
    dispatch: parseHostedExecutionDispatchRequest(record.dispatch),
    ...(record.run === undefined ? {} : {
      run: record.run === null ? null : parseHostedExecutionRunContext(record.run),
    }),
  };
}

export function parseHostedExecutionRunnerResult(value: unknown): HostedExecutionRunnerResult {
  const record = requireObject(value, "Hosted execution runner result");
  const bundles = requireObject(record.bundles, "Hosted execution runner result bundles");
  const result = requireObject(record.result, "Hosted execution runner result.result");

  return {
    bundles: {
      agentState: readNullableString(
        bundles.agentState,
        "Hosted execution runner result bundles.agentState",
      ),
      vault: readNullableString(
        bundles.vault,
        "Hosted execution runner result bundles.vault",
      ),
    },
    result: {
      eventsHandled: requireNumber(result.eventsHandled, "Hosted execution runner result eventsHandled"),
      nextWakeAt: readOptionalNullableString(
        result.nextWakeAt,
        "Hosted execution runner result nextWakeAt",
      ),
      summary: requireString(result.summary, "Hosted execution runner result summary"),
    },
  };
}

export function parseHostedExecutionDispatchResult(value: unknown): HostedExecutionDispatchResult {
  const record = requireObject(value, "Hosted execution dispatch result");
  const event = requireObject(record.event, "Hosted execution dispatch result event");

  return {
    event: {
      eventId: requireString(event.eventId, "Hosted execution dispatch result eventId"),
      lastError: readNullableString(
        event.lastError,
        "Hosted execution dispatch result lastError",
      ),
      state: parseHostedExecutionEventDispatchState(event.state),
      userId: requireString(event.userId, "Hosted execution dispatch result userId"),
    },
    status: parseHostedExecutionUserStatus(record.status),
  };
}

export function parseHostedExecutionUserStatus(value: unknown): HostedExecutionUserStatus {
  const record = requireObject(value, "Hosted execution user status");
  const bundleRefs = requireObject(record.bundleRefs, "Hosted execution user status bundleRefs");

  return {
    backpressuredEventIds: readOptionalStringArray(
      record.backpressuredEventIds,
      "Hosted execution user status backpressuredEventIds",
    ),
    bundleRefs: {
      agentState: parseHostedExecutionBundleRef(bundleRefs.agentState),
      vault: parseHostedExecutionBundleRef(bundleRefs.vault),
    },
    inFlight: requireBoolean(record.inFlight, "Hosted execution user status inFlight"),
    lastError: readNullableString(record.lastError, "Hosted execution user status lastError"),
    ...(record.lastErrorAt === undefined ? {} : {
      lastErrorAt: readNullableString(record.lastErrorAt, "Hosted execution user status lastErrorAt"),
    }),
    ...(record.lastErrorCode === undefined ? {} : {
      lastErrorCode: readNullableString(
        record.lastErrorCode,
        "Hosted execution user status lastErrorCode",
      ),
    }),
    lastEventId: readNullableString(record.lastEventId, "Hosted execution user status lastEventId"),
    lastRunAt: readNullableString(record.lastRunAt, "Hosted execution user status lastRunAt"),
    nextWakeAt: readNullableString(record.nextWakeAt, "Hosted execution user status nextWakeAt"),
    pendingEventCount: requireNumber(
      record.pendingEventCount,
      "Hosted execution user status pendingEventCount",
    ),
    poisonedEventIds: requireStringArray(
      record.poisonedEventIds,
      "Hosted execution user status poisonedEventIds",
    ),
    retryingEventId: readNullableString(
      record.retryingEventId,
      "Hosted execution user status retryingEventId",
    ),
    ...(record.run === undefined ? {} : {
      run: record.run === null ? null : parseHostedExecutionRunStatus(record.run),
    }),
    ...(record.timeline === undefined ? {} : {
      timeline: parseHostedExecutionTimelineEntries(record.timeline),
    }),
    userId: requireString(record.userId, "Hosted execution user status userId"),
  };
}

export function parseHostedExecutionRunContext(value: unknown): HostedExecutionRunContext {
  const record = requireObject(value, "Hosted execution run context");

  return {
    attempt: requireNumber(record.attempt, "Hosted execution run context attempt"),
    runId: requireString(record.runId, "Hosted execution run context runId"),
    startedAt: requireString(record.startedAt, "Hosted execution run context startedAt"),
  };
}

export function parseHostedExecutionRunStatus(value: unknown): HostedExecutionRunStatus {
  const record = requireObject(value, "Hosted execution run status");
  const phase = requireString(record.phase, "Hosted execution run status phase");

  if (!isHostedExecutionRunPhase(phase)) {
    throw new TypeError("Hosted execution run status phase is invalid.");
  }

  return {
    attempt: requireNumber(record.attempt, "Hosted execution run status attempt"),
    eventId: requireString(record.eventId, "Hosted execution run status eventId"),
    phase,
    runId: requireString(record.runId, "Hosted execution run status runId"),
    startedAt: requireString(record.startedAt, "Hosted execution run status startedAt"),
    updatedAt: requireString(record.updatedAt, "Hosted execution run status updatedAt"),
  };
}

export function parseHostedExecutionTimelineEntries(value: unknown): HostedExecutionTimelineEntry[] {
  return requireArray(value, "Hosted execution timeline entries").map((entry, index) => {
    const record = requireObject(entry, `Hosted execution timeline entries[${index}]`);
    const level = requireString(record.level, `Hosted execution timeline entries[${index}].level`);
    const phase = requireString(record.phase, `Hosted execution timeline entries[${index}].phase`);

    if (!isHostedExecutionRunLevel(level)) {
      throw new TypeError(`Hosted execution timeline entries[${index}].level is invalid.`);
    }

    if (!isHostedExecutionRunPhase(phase)) {
      throw new TypeError(`Hosted execution timeline entries[${index}].phase is invalid.`);
    }

    return {
      at: requireString(record.at, `Hosted execution timeline entries[${index}].at`),
      attempt: requireNumber(record.attempt, `Hosted execution timeline entries[${index}].attempt`),
      component: requireString(
        record.component,
        `Hosted execution timeline entries[${index}].component`,
      ),
      ...(record.errorCode === undefined ? {} : {
        errorCode: readNullableString(
          record.errorCode,
          `Hosted execution timeline entries[${index}].errorCode`,
        ),
      }),
      eventId: requireString(record.eventId, `Hosted execution timeline entries[${index}].eventId`),
      level,
      message: requireString(record.message, `Hosted execution timeline entries[${index}].message`),
      phase,
      runId: requireString(record.runId, `Hosted execution timeline entries[${index}].runId`),
    };
  });
}

export function parseHostedExecutionUserEnvStatus(value: unknown): HostedExecutionUserEnvStatus {
  const record = requireObject(value, "Hosted execution user env status");

  return {
    configuredUserEnvKeys: requireStringArray(
      record.configuredUserEnvKeys,
      "Hosted execution user env status configuredUserEnvKeys",
    ),
    userId: requireString(record.userId, "Hosted execution user env status userId"),
  };
}

export function parseHostedExecutionUserEnvUpdate(value: unknown): HostedExecutionUserEnvUpdate {
  const record = requireObject(value, "Hosted execution user env update");
  const env = requireObject(record.env, "Hosted execution user env update env");
  const mode = requireString(record.mode, "Hosted execution user env update mode");

  if (mode !== "merge" && mode !== "replace") {
    throw new TypeError('Hosted execution user env update mode must be "merge" or "replace".');
  }

  return {
    env: Object.fromEntries(
      Object.entries(env).map(([key, entry]) => [
        key,
        entry === null ? null : requireString(entry, `Hosted execution user env update env.${key}`),
      ]),
    ),
    mode,
  };
}

export function parseHostedExecutionSharePackResponse(value: unknown): HostedExecutionSharePackResponse {
  const record = requireObject(value, "Hosted execution share pack response");

  return {
    pack: assertContract(sharePackSchema, record.pack, "share pack"),
    shareId: requireString(record.shareId, "Hosted execution share pack response shareId"),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  const record = requireObject(value, "Hosted device-sync runtime snapshot response");

  return {
    connections: requireArray(
      record.connections,
      "Hosted device-sync runtime snapshot response connections",
    ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeConnectionSnapshot(entry, index)),
    generatedAt: requireString(
      record.generatedAt,
      "Hosted device-sync runtime snapshot response generatedAt",
    ),
    userId: requireString(record.userId, "Hosted device-sync runtime snapshot response userId"),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeApplyResponse(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeApplyResponse {
  const record = requireObject(value, "Hosted device-sync runtime apply response");

  return {
    appliedAt: requireString(record.appliedAt, "Hosted device-sync runtime apply response appliedAt"),
    updates: requireArray(
      record.updates,
      "Hosted device-sync runtime apply response updates",
    ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeApplyEntry(entry, index)),
    userId: requireString(record.userId, "Hosted device-sync runtime apply response userId"),
  };
}

export function parseHostedExecutionBundleRef(value: unknown): HostedExecutionBundleRef | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, "Hosted execution bundle ref");

  return {
    hash: requireString(record.hash, "Hosted execution bundle ref hash"),
    key: requireString(record.key, "Hosted execution bundle ref key"),
    size: requireNumber(record.size, "Hosted execution bundle ref size"),
    updatedAt: requireString(record.updatedAt, "Hosted execution bundle ref updatedAt"),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSnapshot(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  const record = requireObject(
    value,
    `Hosted device-sync runtime snapshot response connections[${index}]`,
  );

  return {
    connection: parseHostedExecutionDeviceSyncRuntimeConnection(
      record.connection,
      `Hosted device-sync runtime snapshot response connections[${index}].connection`,
    ),
    tokenBundle: parseHostedExecutionDeviceSyncRuntimeTokenBundle(
      record.tokenBundle,
      `Hosted device-sync runtime snapshot response connections[${index}].tokenBundle`,
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeApplyEntry(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeApplyResponse["updates"][number] {
  const record = requireObject(value, `Hosted device-sync runtime apply response updates[${index}]`);
  const status = requireString(
    record.status,
    `Hosted device-sync runtime apply response updates[${index}].status`,
  );
  const tokenUpdate = requireString(
    record.tokenUpdate,
    `Hosted device-sync runtime apply response updates[${index}].tokenUpdate`,
  );

  if (status !== "missing" && status !== "updated") {
    throw new TypeError(
      `Hosted device-sync runtime apply response updates[${index}].status must be "missing" or "updated".`,
    );
  }

  if (
    tokenUpdate !== "applied"
    && tokenUpdate !== "cleared"
    && tokenUpdate !== "missing"
    && tokenUpdate !== "skipped_version_mismatch"
    && tokenUpdate !== "unchanged"
  ) {
    throw new TypeError(
      `Hosted device-sync runtime apply response updates[${index}].tokenUpdate is invalid.`,
    );
  }

  return {
    connection: record.connection === null
      ? null
      : parseHostedExecutionDeviceSyncRuntimeConnection(
          record.connection,
          `Hosted device-sync runtime apply response updates[${index}].connection`,
        ),
    connectionId: requireString(
      record.connectionId,
      `Hosted device-sync runtime apply response updates[${index}].connectionId`,
    ),
    status,
    tokenUpdate,
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnection(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot["connection"] {
  const record = requireObject(value, label);
  const status = requireString(record.status, `${label}.status`);

  if (status !== "active" && status !== "reauthorization_required" && status !== "disconnected") {
    throw new TypeError(`${label}.status must be an active, reauthorization_required, or disconnected status.`);
  }

  return {
    accessTokenExpiresAt: readNullableString(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    connectedAt: requireString(record.connectedAt, `${label}.connectedAt`),
    createdAt: requireString(record.createdAt, `${label}.createdAt`),
    displayName: readNullableString(record.displayName, `${label}.displayName`),
    externalAccountId: requireString(record.externalAccountId, `${label}.externalAccountId`),
    id: requireString(record.id, `${label}.id`),
    lastErrorCode: readNullableString(record.lastErrorCode, `${label}.lastErrorCode`),
    lastErrorMessage: readNullableString(record.lastErrorMessage, `${label}.lastErrorMessage`),
    lastSyncCompletedAt: readNullableString(record.lastSyncCompletedAt, `${label}.lastSyncCompletedAt`),
    lastSyncErrorAt: readNullableString(record.lastSyncErrorAt, `${label}.lastSyncErrorAt`),
    lastSyncStartedAt: readNullableString(record.lastSyncStartedAt, `${label}.lastSyncStartedAt`),
    lastWebhookAt: readNullableString(record.lastWebhookAt, `${label}.lastWebhookAt`),
    metadata: requireObject(record.metadata, `${label}.metadata`),
    nextReconcileAt: readNullableString(record.nextReconcileAt, `${label}.nextReconcileAt`),
    provider: requireString(record.provider, `${label}.provider`),
    scopes: requireStringArray(record.scopes, `${label}.scopes`),
    status,
    ...(record.updatedAt === undefined
      ? {}
      : { updatedAt: readNullableString(record.updatedAt, `${label}.updatedAt`) ?? undefined }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeTokenBundle(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeTokenBundle | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);

  return {
    accessToken: requireString(record.accessToken, `${label}.accessToken`),
    accessTokenExpiresAt: readNullableString(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableString(record.refreshToken, `${label}.refreshToken`),
    tokenVersion: requireNumber(record.tokenVersion, `${label}.tokenVersion`),
  };
}

export function parseHostedExecutionEvent(value: unknown): HostedExecutionEvent {
  const record = requireObject(value, "Hosted execution event");
  const kind = requireString(record.kind, "Hosted execution event kind");
  const userId = requireString(record.userId, "Hosted execution event userId");

  switch (kind) {
    case "member.activated":
      return {
        kind,
        userId,
      };
    case "linq.message.received":
      return {
        kind,
        linqEvent: requireObject(record.linqEvent, "Hosted execution Linq message linqEvent"),
        normalizedPhoneNumber: requireString(
          record.normalizedPhoneNumber,
          "Hosted execution Linq message normalizedPhoneNumber",
        ),
        userId,
      };
    case "telegram.message.received": {
      const event: HostedExecutionTelegramMessageReceivedEvent = {
        botUserId: readNullableString(
          record.botUserId,
          "Hosted execution Telegram message botUserId",
        ),
        kind,
        telegramUpdate: requireObject(
          record.telegramUpdate,
          "Hosted execution Telegram message telegramUpdate",
        ),
        userId,
      };

      return event;
    }
    case "email.message.received":
      return {
        envelopeFrom: readNullableString(
          record.envelopeFrom,
          "Hosted execution email message envelopeFrom",
        ),
        envelopeTo: readNullableString(
          record.envelopeTo,
          "Hosted execution email message envelopeTo",
        ),
        identityId: requireString(record.identityId, "Hosted execution email message identityId"),
        kind,
        rawMessageKey: requireString(
          record.rawMessageKey,
          "Hosted execution email message rawMessageKey",
        ),
        threadTarget: readNullableString(
          record.threadTarget,
          "Hosted execution email message threadTarget",
        ),
        userId,
      } satisfies HostedExecutionEmailMessageReceivedEvent;
    case "assistant.cron.tick":
      return {
        kind,
        reason: parseCronReason(record.reason),
        userId,
      } satisfies HostedExecutionAssistantCronTickEvent;
    case "device-sync.wake":
      return {
        ...(record.connectionId === undefined
          ? {}
          : {
              connectionId: readNullableString(
                record.connectionId,
                "Hosted execution device-sync.wake connectionId",
              ),
            }),
        ...(record.hint === undefined
          ? {}
          : {
              hint: parseHostedExecutionDeviceSyncWakeHint(record.hint),
            }),
        kind,
        ...(record.provider === undefined
          ? {}
          : {
              provider: readNullableString(
                record.provider,
                "Hosted execution device-sync.wake provider",
              ),
            }),
        reason: parseDeviceSyncReason(record.reason),
        userId,
      } satisfies HostedExecutionDeviceSyncWakeEvent;
    case "vault.share.accepted":
      return {
        kind,
        share: parseHostedExecutionShareReference(record.share),
        userId,
      } satisfies HostedExecutionVaultShareAcceptedEvent;
    default:
      throw new TypeError(`Unsupported hosted execution event kind: ${kind}`);
  }
}

export function parseHostedExecutionShareReference(value: unknown): HostedExecutionShareReference {
  const record = requireObject(value, "Hosted execution share reference");

  return {
    shareCode: requireString(record.shareCode, "Hosted execution share reference shareCode"),
    shareId: requireString(record.shareId, "Hosted execution share reference shareId"),
  };
}

function parseHostedExecutionEventDispatchState(
  value: unknown,
): HostedExecutionEventDispatchState {
  const state = requireString(value, "Hosted execution dispatch result event state");

  if (
    state === "queued"
    || state === "duplicate_pending"
    || state === "duplicate_consumed"
    || state === "backpressured"
    || state === "completed"
    || state === "poisoned"
  ) {
    return state;
  }

  throw new TypeError(`Unsupported hosted execution event dispatch state: ${state}`);
}

function parseHostedExecutionDeviceSyncWakeHint(
  value: unknown,
): HostedExecutionDeviceSyncWakeEvent["hint"] {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, "Hosted execution device-sync.wake hint");
  const jobsValue = record.jobs;

  return {
    ...(record.eventType === undefined
      ? {}
      : {
          eventType: readNullableString(
            record.eventType,
            "Hosted execution device-sync.wake hint eventType",
          ),
        }),
    ...(jobsValue === undefined
      ? {}
      : {
          jobs: requireArray(
            jobsValue,
            "Hosted execution device-sync.wake hint jobs",
          ).map((entry, index) => parseHostedExecutionDeviceSyncJobHint(entry, index)),
        }),
    ...(record.nextReconcileAt === undefined
      ? {}
      : {
          nextReconcileAt: readNullableString(
            record.nextReconcileAt,
            "Hosted execution device-sync.wake hint nextReconcileAt",
          ),
        }),
    ...(record.occurredAt === undefined
      ? {}
      : {
          occurredAt: readNullableString(
            record.occurredAt,
            "Hosted execution device-sync.wake hint occurredAt",
          ),
        }),
    ...(record.reason === undefined
      ? {}
      : {
          reason: readNullableString(
            record.reason,
            "Hosted execution device-sync.wake hint reason",
          ),
        }),
    ...(record.resourceCategory === undefined
      ? {}
      : {
          resourceCategory: readNullableString(
            record.resourceCategory,
            "Hosted execution device-sync.wake hint resourceCategory",
          ),
        }),
    ...(record.revokeWarning === undefined
      ? {}
      : {
          revokeWarning: parseHostedExecutionDeviceSyncRevokeWarning(record.revokeWarning),
        }),
    ...(record.scopes === undefined
      ? {}
      : {
          scopes: requireStringArray(
            record.scopes,
            "Hosted execution device-sync.wake hint scopes",
          ),
        }),
    ...(record.traceId === undefined
      ? {}
      : {
          traceId: readNullableString(
            record.traceId,
            "Hosted execution device-sync.wake hint traceId",
          ),
        }),
  };
}

function parseHostedExecutionDeviceSyncJobHint(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncJobHint {
  const record = requireObject(
    value,
    `Hosted execution device-sync.wake hint jobs[${index}]`,
  );

  return {
    ...(record.availableAt === undefined
      ? {}
      : {
          availableAt: requireString(
            record.availableAt,
            `Hosted execution device-sync.wake hint jobs[${index}].availableAt`,
          ),
        }),
    ...(record.dedupeKey === undefined
      ? {}
      : {
          dedupeKey: readNullableString(
            record.dedupeKey,
            `Hosted execution device-sync.wake hint jobs[${index}].dedupeKey`,
          ),
        }),
    kind: requireString(
      record.kind,
      `Hosted execution device-sync.wake hint jobs[${index}].kind`,
    ),
    ...(record.maxAttempts === undefined
      ? {}
      : {
          maxAttempts: requireNumber(
            record.maxAttempts,
            `Hosted execution device-sync.wake hint jobs[${index}].maxAttempts`,
          ),
        }),
    ...(record.payload === undefined
      ? {}
      : {
          payload: requireObject(
            record.payload,
            `Hosted execution device-sync.wake hint jobs[${index}].payload`,
          ),
        }),
    ...(record.priority === undefined
      ? {}
      : {
          priority: requireNumber(
            record.priority,
            `Hosted execution device-sync.wake hint jobs[${index}].priority`,
          ),
        }),
  } satisfies HostedExecutionDeviceSyncJobHint;
}

function parseHostedExecutionDeviceSyncRevokeWarning(
  value: unknown,
): NonNullable<HostedExecutionDeviceSyncWakeEvent["hint"]>["revokeWarning"] {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, "Hosted execution device-sync.wake hint revokeWarning");

  return {
    code: requireString(
      record.code,
      "Hosted execution device-sync.wake hint revokeWarning.code",
    ),
    message: requireString(
      record.message,
      "Hosted execution device-sync.wake hint revokeWarning.message",
    ),
  };
}

function parseCronReason(value: unknown): HostedExecutionAssistantCronTickEvent["reason"] {
  const reason = requireString(value, "Hosted execution assistant.cron.tick reason");

  if (reason === "alarm" || reason === "manual" || reason === "device-sync") {
    return reason;
  }

  throw new TypeError(`Unsupported hosted execution assistant.cron.tick reason: ${reason}`);
}

function parseDeviceSyncReason(
  value: unknown,
): Extract<HostedExecutionEvent, { kind: "device-sync.wake" }>["reason"] {
  const reason = requireString(value, "Hosted execution device-sync.wake reason");

  if (
    reason === "connected"
    || reason === "webhook_hint"
    || reason === "disconnected"
    || reason === "reauthorization_required"
  ) {
    return reason;
  }

  throw new TypeError(`Unsupported hosted execution device-sync.wake reason: ${reason}`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function readOptionalNullableString(value: unknown, label: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readNullableString(value, label);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function readOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireStringArray(value, label);
}
