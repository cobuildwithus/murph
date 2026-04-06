import { assertContract, sharePackSchema } from "@murphai/contracts";
import { parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionBundleRef,
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncRuntimeConnectionUpdate,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeConnectionSeed,
  HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeLocalStateSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeTokenBundle,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionEvent,
  HostedExecutionGatewayMessageSendEvent,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedExecutionEventDispatchState,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
  HostedExecutionShareReference,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserEnvUpdate,
  HostedExecutionUserStatus,
  HostedExecutionVaultShareAcceptedEvent,
} from "./contracts.ts";
import {
  type HostedExecutionBundlePayload,
  type HostedExecutionBundleRefState,
} from "./bundles.ts";
import {
  readHostedExecutionOutboxPayload,
  type HostedExecutionOutboxPayload,
} from "./outbox-payload.ts";
import type {
  HostedExecutionRunContext,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
} from "./observability.ts";
import {
  isHostedExecutionRunLevel,
  isHostedExecutionRunPhase,
} from "./observability.ts";

export function parseHostedExecutionSharePack(value: unknown) {
  return assertContract(sharePackSchema, value, "hosted execution share pack");
}

export function parseHostedExecutionDispatchRequest(value: unknown): HostedExecutionDispatchRequest {
  const record = requireObject(value, "Hosted execution dispatch request");

  return {
    event: parseHostedExecutionEvent(record.event),
    eventId: requireString(record.eventId, "Hosted execution dispatch request eventId"),
    occurredAt: requireString(record.occurredAt, "Hosted execution dispatch request occurredAt"),
  };
}

export function parseHostedExecutionOutboxPayload(value: unknown): HostedExecutionOutboxPayload {
  const payload = readHostedExecutionOutboxPayload(value);

  if (!payload) {
    throw new TypeError("Hosted execution outbox payload is invalid.");
  }

  return payload;
}

export function parseHostedExecutionRunnerRequest(value: unknown): HostedExecutionRunnerRequest {
  const record = requireObject(value, "Hosted execution runner request");

  return {
    bundle: parseHostedExecutionBundlePayload(
      record.bundle,
      "Hosted execution runner request bundle",
    ),
    dispatch: parseHostedExecutionDispatchRequest(record.dispatch),
    ...(record.run === undefined ? {} : {
      run: record.run === null ? null : parseHostedExecutionRunContext(record.run),
    }),
  };
}

export function parseHostedExecutionRunnerResult(value: unknown): HostedExecutionRunnerResult {
  const record = requireObject(value, "Hosted execution runner result");
  const result = requireObject(record.result, "Hosted execution runner result.result");

  return {
    bundle: parseHostedExecutionBundlePayload(
      record.bundle,
      "Hosted execution runner result bundle",
    ),
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

  return {
    backpressuredEventIds: readOptionalStringArray(
      record.backpressuredEventIds,
      "Hosted execution user status backpressuredEventIds",
    ),
    bundleRef: parseHostedExecutionBundleRef(
      record.bundleRef,
      "Hosted execution user status bundleRef",
    ),
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

export function parseHostedExecutionBundlePayload(
  value: unknown,
  label = "Hosted execution bundle",
): HostedExecutionBundlePayload {
  return readNullableStringValue(value, label);
}

export function parseHostedExecutionBundleRef(
  value: unknown,
  label = "Hosted execution bundle ref",
): HostedExecutionBundleRefState {
  return parseRuntimeHostedExecutionBundleRef(value, label);
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
        readNullableStringValue(entry, `Hosted execution user env update env.${key}`),
      ]),
    ),
    mode,
  };
}

export function parseHostedExecutionDeviceSyncConnectLinkResponse(
  value: unknown,
): HostedExecutionDeviceSyncConnectLinkResponse {
  const record = requireObject(value, "Hosted device-sync connect link response");

  return {
    authorizationUrl: requireString(
      record.authorizationUrl,
      "Hosted device-sync connect link response authorizationUrl",
    ),
    expiresAt: requireString(
      record.expiresAt,
      "Hosted device-sync connect link response expiresAt",
    ),
    provider: requireString(record.provider, "Hosted device-sync connect link response provider"),
    providerLabel: requireString(
      record.providerLabel,
      "Hosted device-sync connect link response providerLabel",
    ),
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

export function parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncRuntimeSnapshotRequest {
  const record = requireObject(value, "Hosted device-sync runtime snapshot request");

  return {
    ...(record.connectionId === undefined
      ? {}
      : { connectionId: readNullableStringValue(record.connectionId, "Hosted device-sync runtime snapshot request connectionId") }),
    ...(record.provider === undefined
      ? {}
      : { provider: readNullableStringValue(record.provider, "Hosted device-sync runtime snapshot request provider") }),
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeApplyRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncRuntimeApplyRequest {
  const record = requireObject(value, "Hosted device-sync runtime apply request");
  const updates = requireArray(
    record.updates,
    "Hosted device-sync runtime apply request updates",
  ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeConnectionUpdate(entry, index));

  assertUniqueHostedExecutionDeviceSyncRuntimeApplyConnectionIds(updates);

  return {
    ...(record.occurredAt === undefined
      ? {}
      : {
          occurredAt: readNullableIsoTimestamp(
            record.occurredAt,
            "Hosted device-sync runtime apply request occurredAt",
          ),
        }),
    updates,
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
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
    localState: parseHostedExecutionDeviceSyncRuntimeLocalState(
      record.localState,
      `Hosted device-sync runtime snapshot response connections[${index}].localState`,
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

  if (status !== "created" && status !== "missing" && status !== "updated") {
    throw new TypeError(
      `Hosted device-sync runtime apply response updates[${index}].status must be "created", "missing", or "updated".`,
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

function parseHostedExecutionDeviceSyncRuntimeConnectionUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionUpdate {
  const record = requireObject(
    value,
    `Hosted device-sync runtime apply request updates[${index}]`,
  );

  return {
    connectionId: requireString(
      record.connectionId,
      `Hosted device-sync runtime apply request updates[${index}].connectionId`,
    ),
    ...(record.connection === undefined
      ? {}
      : {
          connection: parseHostedExecutionDeviceSyncRuntimeConnectionStateUpdate(
            record.connection,
            index,
          ),
        }),
    ...(record.localState === undefined
      ? {}
      : {
          localState: parseHostedExecutionDeviceSyncRuntimeLocalStateUpdate(
            record.localState,
            index,
          ),
        }),
    ...(record.observedUpdatedAt === undefined
      ? {}
      : {
          observedUpdatedAt: readNullableIsoTimestamp(
            record.observedUpdatedAt,
            `Hosted device-sync runtime apply request updates[${index}].observedUpdatedAt`,
          ),
        }),
    ...(record.observedTokenVersion === undefined
      ? {}
      : {
          observedTokenVersion: readNullablePositiveInteger(
            record.observedTokenVersion,
            `Hosted device-sync runtime apply request updates[${index}].observedTokenVersion`,
          ),
        }),
    ...(record.seed === undefined
      ? {}
      : {
          seed: parseHostedExecutionDeviceSyncRuntimeConnectionSeed(
            record.seed,
            `Hosted device-sync runtime apply request updates[${index}].seed`,
          ),
        }),
    ...(record.tokenBundle === undefined
      ? {}
      : {
          tokenBundle: parseHostedExecutionDeviceSyncRuntimeTokenBundle(
            record.tokenBundle,
            `Hosted device-sync runtime apply request updates[${index}].tokenBundle`,
          ),
        }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSeed(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionSeed {
  const record = requireObject(value, label);

  return {
    connection: parseHostedExecutionDeviceSyncRuntimeConnection(
      record.connection,
      `${label}.connection`,
    ),
    localState: parseHostedExecutionDeviceSyncRuntimeLocalState(
      record.localState,
      `${label}.localState`,
    ),
    tokenBundle: parseHostedExecutionDeviceSyncRuntimeTokenBundle(
      record.tokenBundle,
      `${label}.tokenBundle`,
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionStateUpdate(
  value: unknown,
  index: number,
): NonNullable<HostedExecutionDeviceSyncRuntimeConnectionUpdate["connection"]> {
  const record = requireObject(
    value,
    `Hosted device-sync runtime apply request updates[${index}].connection`,
  );

  return {
    ...(record.displayName === undefined
      ? {}
      : {
          displayName: readNullableStringValue(
            record.displayName,
            `Hosted device-sync runtime apply request updates[${index}].connection.displayName`,
          ),
        }),
    ...(record.metadata === undefined
      ? {}
      : {
          metadata: sanitizeHostedExecutionDeviceSyncMetadata(
            requireObject(
              record.metadata,
              `Hosted device-sync runtime apply request updates[${index}].connection.metadata`,
            ),
          ),
        }),
    ...(record.scopes === undefined
      ? {}
      : {
          scopes: requireStringArray(
            record.scopes,
            `Hosted device-sync runtime apply request updates[${index}].connection.scopes`,
          ),
        }),
    ...(record.status === undefined
      ? {}
      : {
          status: parseHostedExecutionDeviceSyncConnectionStatus(
            record.status,
            `Hosted device-sync runtime apply request updates[${index}].connection.status`,
          ),
        }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeLocalStateUpdate(
  value: unknown,
  index: number,
): NonNullable<HostedExecutionDeviceSyncRuntimeConnectionUpdate["localState"]> {
  const record = requireObject(
    value,
    `Hosted device-sync runtime apply request updates[${index}].localState`,
  );

  return {
    ...(record.clearError === undefined
      ? {}
      : {
          clearError: requireBoolean(
            record.clearError,
            `Hosted device-sync runtime apply request updates[${index}].localState.clearError`,
          ),
        }),
    ...(record.lastErrorCode === undefined
      ? {}
      : {
          lastErrorCode: readNullableStringValue(
            record.lastErrorCode,
            `Hosted device-sync runtime apply request updates[${index}].localState.lastErrorCode`,
          ),
        }),
    ...(record.lastErrorMessage === undefined
      ? {}
      : {
          lastErrorMessage: readNullableStringValue(
            record.lastErrorMessage,
            `Hosted device-sync runtime apply request updates[${index}].localState.lastErrorMessage`,
          ),
        }),
    ...(record.lastSyncCompletedAt === undefined
      ? {}
      : {
          lastSyncCompletedAt: readNullableIsoTimestamp(
            record.lastSyncCompletedAt,
            `Hosted device-sync runtime apply request updates[${index}].localState.lastSyncCompletedAt`,
          ),
        }),
    ...(record.lastSyncErrorAt === undefined
      ? {}
      : {
          lastSyncErrorAt: readNullableIsoTimestamp(
            record.lastSyncErrorAt,
            `Hosted device-sync runtime apply request updates[${index}].localState.lastSyncErrorAt`,
          ),
        }),
    ...(record.lastSyncStartedAt === undefined
      ? {}
      : {
          lastSyncStartedAt: readNullableIsoTimestamp(
            record.lastSyncStartedAt,
            `Hosted device-sync runtime apply request updates[${index}].localState.lastSyncStartedAt`,
          ),
        }),
    ...(record.lastWebhookAt === undefined
      ? {}
      : {
          lastWebhookAt: readNullableIsoTimestamp(
            record.lastWebhookAt,
            `Hosted device-sync runtime apply request updates[${index}].localState.lastWebhookAt`,
          ),
        }),
    ...(record.nextReconcileAt === undefined
      ? {}
      : {
          nextReconcileAt: readNullableIsoTimestamp(
            record.nextReconcileAt,
            `Hosted device-sync runtime apply request updates[${index}].localState.nextReconcileAt`,
          ),
        }),
  };
}

function assertUniqueHostedExecutionDeviceSyncRuntimeApplyConnectionIds(
  updates: readonly HostedExecutionDeviceSyncRuntimeConnectionUpdate[],
): void {
  const seen = new Set<string>();

  for (const [index, update] of updates.entries()) {
    if (seen.has(update.connectionId)) {
      throw new TypeError(
        `Hosted device-sync runtime apply request updates[${index}].connectionId must be unique within one request.`,
      );
    }

    seen.add(update.connectionId);
  }
}

function parseHostedExecutionDeviceSyncRuntimeConnection(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot {
  const record = requireObject(value, label);
  const status = requireString(record.status, `${label}.status`);

  if (status !== "active" && status !== "reauthorization_required" && status !== "disconnected") {
    throw new TypeError(`${label}.status must be an active, reauthorization_required, or disconnected status.`);
  }

  return {
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    connectedAt: requireIsoTimestamp(record.connectedAt, `${label}.connectedAt`),
    createdAt: requireIsoTimestamp(record.createdAt, `${label}.createdAt`),
    displayName: readNullableString(record.displayName, `${label}.displayName`),
    externalAccountId: requireString(record.externalAccountId, `${label}.externalAccountId`),
    id: requireString(record.id, `${label}.id`),
    metadata: sanitizeHostedExecutionDeviceSyncMetadata(
      requireObject(record.metadata, `${label}.metadata`),
    ),
    provider: requireString(record.provider, `${label}.provider`),
    scopes: requireStringArray(record.scopes, `${label}.scopes`),
    status,
    ...(record.updatedAt === undefined
      ? {}
      : { updatedAt: readNullableIsoTimestamp(record.updatedAt, `${label}.updatedAt`) ?? undefined }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeLocalState(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeLocalStateSnapshot {
  const record = requireObject(value, label);

  return {
    lastErrorCode: readNullableString(record.lastErrorCode, `${label}.lastErrorCode`),
    lastErrorMessage: readNullableString(record.lastErrorMessage, `${label}.lastErrorMessage`),
    lastSyncCompletedAt: readNullableIsoTimestamp(record.lastSyncCompletedAt, `${label}.lastSyncCompletedAt`),
    lastSyncErrorAt: readNullableIsoTimestamp(record.lastSyncErrorAt, `${label}.lastSyncErrorAt`),
    lastSyncStartedAt: readNullableIsoTimestamp(record.lastSyncStartedAt, `${label}.lastSyncStartedAt`),
    lastWebhookAt: readNullableIsoTimestamp(record.lastWebhookAt, `${label}.lastWebhookAt`),
    nextReconcileAt: readNullableIsoTimestamp(record.nextReconcileAt, `${label}.nextReconcileAt`),
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
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableString(record.refreshToken, `${label}.refreshToken`),
    tokenVersion: requirePositiveInteger(record.tokenVersion, `${label}.tokenVersion`),
  };
}

function resolveHostedDeviceSyncRuntimeRequestUserId(
  value: unknown,
  trustedUserId: string | null,
): string {
  if (typeof trustedUserId === "string" && trustedUserId.trim().length > 0) {
    if (value !== undefined && value !== trustedUserId) {
      throw new TypeError("Hosted device-sync runtime request userId must match the route user.");
    }

    return trustedUserId;
  }

  return requireString(value, "Hosted device-sync runtime request userId");
}

function parseHostedExecutionDeviceSyncConnectionStatus(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot["status"] {
  const status = requireString(value, label);

  if (status === "active" || status === "reauthorization_required" || status === "disconnected") {
    return status;
  }

  throw new TypeError(`${label} must be an active, reauthorization_required, or disconnected status.`);
}

export function parseHostedExecutionEvent(value: unknown): HostedExecutionEvent {
  const record = requireObject(value, "Hosted execution event");
  const kind = requireString(record.kind, "Hosted execution event kind");
  const userId = requireString(record.userId, "Hosted execution event userId");

  switch (kind) {
    case "member.activated":
      return {
        ...(record.firstContact === undefined
          ? {}
          : {
              firstContact: record.firstContact === null
                ? null
                : parseHostedExecutionFirstContactTarget(record.firstContact),
            }),
        kind,
        userId,
      };
    case "linq.message.received":
      return {
        kind,
        linqEvent: requireObject(record.linqEvent, "Hosted execution Linq message linqEvent"),
        phoneLookupKey: requireString(
          record.phoneLookupKey,
          "Hosted execution Linq message phoneLookupKey",
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
        identityId: requireString(record.identityId, "Hosted execution email message identityId"),
        kind,
        rawMessageKey: requireString(
          record.rawMessageKey,
          "Hosted execution email message rawMessageKey",
        ),
        ...(record.selfAddress === undefined
          ? {}
          : {
              selfAddress: readNullableString(
                record.selfAddress,
                "Hosted execution email message selfAddress",
              ),
            }),
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
        ...(record.runtimeSnapshot === undefined
          ? {}
          : {
              runtimeSnapshot: record.runtimeSnapshot === null
                ? null
                : parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(record.runtimeSnapshot),
            }),
        userId,
      } satisfies HostedExecutionDeviceSyncWakeEvent;
    case "vault.share.accepted":
      return {
        kind,
        share: parseHostedExecutionShareReference(record.share),
        userId,
      } satisfies HostedExecutionVaultShareAcceptedEvent;
    case "gateway.message.send":
      return {
        kind,
        clientRequestId: readNullableString(
          record.clientRequestId,
          "Hosted execution gateway.message.send clientRequestId",
        ),
        replyToMessageId: readNullableString(
          record.replyToMessageId,
          "Hosted execution gateway.message.send replyToMessageId",
        ),
        sessionKey: requireString(
          record.sessionKey,
          "Hosted execution gateway.message.send sessionKey",
        ),
        text: requireString(record.text, "Hosted execution gateway.message.send text"),
        userId,
      } satisfies HostedExecutionGatewayMessageSendEvent;
    default:
      throw new TypeError(`Unsupported hosted execution event kind: ${kind}`);
  }
}

function parseHostedExecutionFirstContactTarget(
  value: unknown,
): HostedExecutionMemberActivatedEvent["firstContact"] {
  const record = requireObject(value, "Hosted execution member.activated firstContact");
  const channel = requireString(
    record.channel,
    "Hosted execution member.activated firstContact channel",
  );

  if (channel !== "email" && channel !== "linq" && channel !== "telegram") {
    throw new TypeError("Hosted execution member.activated firstContact channel is invalid.");
  }

  return {
    channel,
    identityId: requireString(
      record.identityId,
      "Hosted execution member.activated firstContact identityId",
    ),
    threadId: requireString(
      record.threadId,
      "Hosted execution member.activated firstContact threadId",
    ),
    threadIsDirect: requireBoolean(
      record.threadIsDirect,
      "Hosted execution member.activated firstContact threadIsDirect",
    ),
  };
}

export function parseHostedExecutionShareReference(value: unknown): HostedExecutionShareReference {
  const record = requireObject(value, "Hosted execution share reference");

  return {
    pack: assertContract(sharePackSchema, record.pack, "share pack"),
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

const HOSTED_EXECUTION_DEVICE_SYNC_METADATA_MAX_ENTRIES = 16;
const HOSTED_EXECUTION_DEVICE_SYNC_METADATA_MAX_KEY_LENGTH = 64;
const HOSTED_EXECUTION_DEVICE_SYNC_METADATA_MAX_STRING_LENGTH = 256;
const HOSTED_EXECUTION_DEVICE_SYNC_METADATA_BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ISO_8601_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

type HostedExecutionDeviceSyncMetadataScalar = string | number | boolean | null;

function sanitizeHostedExecutionDeviceSyncMetadataValue(
  value: unknown,
): HostedExecutionDeviceSyncMetadataScalar | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length <= HOSTED_EXECUTION_DEVICE_SYNC_METADATA_MAX_STRING_LENGTH
      ? value
      : undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function sanitizeHostedExecutionDeviceSyncMetadata(
  value: Record<string, unknown>,
): Record<string, HostedExecutionDeviceSyncMetadataScalar> {
  const sanitized: Record<string, HostedExecutionDeviceSyncMetadataScalar> = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(sanitized).length >= HOSTED_EXECUTION_DEVICE_SYNC_METADATA_MAX_ENTRIES) {
      break;
    }

    const key = rawKey.trim();

    if (
      !key
      || key.length > HOSTED_EXECUTION_DEVICE_SYNC_METADATA_MAX_KEY_LENGTH
      || HOSTED_EXECUTION_DEVICE_SYNC_METADATA_BLOCKED_KEYS.has(key)
    ) {
      continue;
    }

    const normalizedValue = sanitizeHostedExecutionDeviceSyncMetadataValue(rawValue);

    if (normalizedValue === undefined) {
      continue;
    }

    sanitized[key] = normalizedValue;
  }

  return sanitized;
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

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return parsed;
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

function readNullableStringValue(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireIsoTimestamp(value, label);
}

function readNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requirePositiveInteger(value, label);
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

function requireIsoTimestamp(value: unknown, label: string): string {
  const candidate = requireString(value, label);

  if (!ISO_8601_TIMESTAMP_PATTERN.test(candidate)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  const parsed = Date.parse(candidate);

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return new Date(parsed).toISOString();
}
