import {
  deviceSyncError,
  isDeviceSyncError,
  type DeviceSyncJobInput,
  type DeviceSyncRegistry,
  type ProviderConnectionResult,
  type PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import { shapeHostedDeviceSyncJobHintPayload } from "@murphai/device-syncd/hosted-hints";
import type {
  HostedExecutionDeviceSyncJobHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDeviceSyncWakeEvent,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import { requireHostedExecutionControlClient } from "../hosted-execution/control";
import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
import {
  buildHostedDeviceSyncWakeDispatch,
  type HostedDeviceSyncWakeSource,
} from "./hosted-dispatch";
import {
  buildHostedDeviceSyncRuntimeSeedFromPublicAccount,
  composeHostedRuntimeDeviceSyncAccount,
  findHostedDeviceSyncRuntimeConnection,
} from "./internal-runtime";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { normalizeNullableString, sha256Hex, toIsoTimestamp } from "./shared";

export async function disconnectHostedDeviceSyncConnection(input: {
  connectionId: string;
  registry: DeviceSyncRegistry;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<{
  connection: PublicDeviceSyncAccount;
  warning?: { code: string; message: string };
}> {
  const existing = await input.store.getRuntimeConnectionForUser(input.userId, input.connectionId);

  if (!existing) {
    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
      httpStatus: 404,
    });
  }

  const controlClient = requireHostedExecutionControlClient();
  const runtimeSnapshot = await controlClient.getDeviceSyncRuntimeSnapshot(input.userId, {
    connectionId: input.connectionId,
    provider: existing.provider,
  });
  const runtimeConnection = findHostedDeviceSyncRuntimeConnection(runtimeSnapshot, input.connectionId);

  if (existing.status === "disconnected" && !runtimeConnection?.tokenBundle) {
    return {
      connection: existing,
    };
  }

  let warning: { code: string; message: string } | undefined;

  if (runtimeConnection?.tokenBundle) {
    const provider = input.registry.get(existing.provider);

    if (provider?.revokeAccess) {
      try {
        await provider.revokeAccess(composeHostedRuntimeDeviceSyncAccount({
          connection: existing,
          externalAccountId: runtimeConnection.connection.externalAccountId,
          tokenBundle: runtimeConnection.tokenBundle,
        }));
      } catch (error) {
        warning = {
          code: isDeviceSyncError(error) ? error.code : "PROVIDER_REVOKE_FAILED",
          message: error instanceof Error ? error.message : "Provider revoke request failed during disconnect.",
        };
      }
    }
  }

  const now = toIsoTimestamp(new Date());
  const disconnectLocalState = {
    lastErrorCode: warning?.code ?? null,
    lastErrorMessage: warning?.message ?? null,
    lastSyncCompletedAt: runtimeConnection?.localState.lastSyncCompletedAt ?? existing.lastSyncCompletedAt,
    lastSyncErrorAt: runtimeConnection?.localState.lastSyncErrorAt ?? existing.lastSyncErrorAt,
    lastSyncStartedAt: runtimeConnection?.localState.lastSyncStartedAt ?? existing.lastSyncStartedAt,
    lastWebhookAt: runtimeConnection?.localState.lastWebhookAt ?? existing.lastWebhookAt,
    nextReconcileAt: null,
  } as const;
  const seedExternalAccountId = runtimeConnection?.connection.externalAccountId ?? null;

  if (!seedExternalAccountId) {
    throw deviceSyncError({
      code: "RUNTIME_STATE_CONFLICT",
      message: `Hosted device-sync runtime is missing provider identity for connection ${input.connectionId}.`,
      retryable: true,
      httpStatus: 409,
    });
  }

  const applyResponse = await controlClient.applyDeviceSyncRuntimeUpdates(input.userId, {
    occurredAt: now,
    updates: [
      {
        connection: {
          status: "disconnected",
        },
        connectionId: input.connectionId,
        localState: {
          clearError: true,
          lastErrorCode: disconnectLocalState.lastErrorCode,
          lastErrorMessage: disconnectLocalState.lastErrorMessage,
          nextReconcileAt: null,
        },
        seed: buildHostedDeviceSyncRuntimeSeedFromPublicAccount({
          account: {
            ...existing,
            accessTokenExpiresAt: null,
            connectedAt: runtimeConnection?.connection.connectedAt ?? existing.connectedAt,
            createdAt: runtimeConnection?.connection.createdAt ?? existing.createdAt,
            displayName: runtimeConnection?.connection.displayName ?? existing.displayName,
            lastErrorCode: disconnectLocalState.lastErrorCode,
            lastErrorMessage: disconnectLocalState.lastErrorMessage,
            metadata: runtimeConnection?.connection.metadata ?? existing.metadata,
            nextReconcileAt: null,
            scopes: runtimeConnection?.connection.scopes ?? existing.scopes,
            status: "disconnected",
            updatedAt: now,
          },
          externalAccountId: seedExternalAccountId,
          localState: disconnectLocalState,
          tokenBundle: runtimeConnection?.tokenBundle ?? null,
        }),
        tokenBundle: null,
      },
    ],
  });
  const appliedUpdate = applyResponse.updates.find((entry) => entry.connectionId === input.connectionId) ?? null;

  if (!appliedUpdate || appliedUpdate.status === "missing" || appliedUpdate.connection?.status !== "disconnected") {
    throw deviceSyncError({
      code: "RUNTIME_STATE_CONFLICT",
      message: `Hosted device-sync runtime did not persist the disconnected state for connection ${input.connectionId}.`,
      retryable: true,
      httpStatus: 409,
    });
  }

  const connection = await input.store.getRuntimeConnectionForUser(input.userId, input.connectionId);

  if (!connection || connection.status !== "disconnected") {
    throw deviceSyncError({
      code: "RUNTIME_STATE_CONFLICT",
      message: `Hosted device-sync runtime did not return a disconnected connection snapshot for ${input.connectionId}.`,
      retryable: true,
      httpStatus: 409,
    });
  }

  await input.store.syncDurableConnectionState(connection);

  const hint = {
    reason: "user_disconnect",
    ...(warning ? { revokeWarning: warning } : {}),
  } satisfies HostedExecutionDeviceSyncWakeEvent["hint"];
  const dispatch = buildHostedDeviceSyncWakeDispatch({
    connectionId: input.connectionId,
    hint,
    occurredAt: now,
    provider: existing.provider,
    source: "disconnect",
    userId: input.userId,
  });
  await input.store.prisma.$transaction(async (tx) => {
    return input.store.createSignal({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: existing.provider,
      kind: "disconnected",
      occurredAt: now,
      reason: normalizeNullableString(hint.reason),
      revokeWarning: warning ?? null,
      createdAt: now,
      tx,
    });
  });

  await publishHostedDeviceSyncWake({
    dispatch,
    store: input.store,
  });

  return {
    connection,
    ...(warning ? { warning } : {}),
  };
}
export async function handleHostedDeviceSyncConnectionEstablished(input: {
  account: {
    id: string;
    provider: string;
    scopes: string[];
  };
  connection: Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt">;
  now: string;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<void> {
  const ownerId = await input.store.getConnectionOwnerId(input.account.id);

  if (!ownerId) {
    return;
  }

  const hint = {
    jobs: normalizeHostedDeviceSyncJobHints({
      connectionId: input.account.id,
      jobs: input.connection.initialJobs ?? [],
      occurredAt: input.now,
      provider: input.account.provider,
      reason: "connected",
    }),
    nextReconcileAt: input.connection.nextReconcileAt ?? null,
    occurredAt: input.now,
    scopes: input.account.scopes,
  } satisfies HostedExecutionDeviceSyncWakeEvent["hint"];
  const dispatch = buildHostedDeviceSyncWakeDispatch({
    connectionId: input.account.id,
    hint,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "connection-established",
    userId: ownerId,
  });
  await input.store.prisma.$transaction(async (tx) => {
    return input.store.createSignal({
      userId: ownerId,
      connectionId: input.account.id,
      provider: input.account.provider,
      kind: "connected",
      occurredAt: input.now,
      nextReconcileAt: input.connection.nextReconcileAt ?? null,
      createdAt: input.now,
      tx,
    });
  });

  await publishHostedDeviceSyncWake({
    dispatch,
    store: input.store,
  });
}

export async function handleHostedDeviceSyncWebhookAccepted(input: {
  account: {
    id: string;
    provider: string;
  };
  now: string;
  store: PrismaDeviceSyncControlPlaneStore;
  webhook: {
    eventType: string;
    jobs?: readonly DeviceSyncJobInput[];
    occurredAt?: string | null;
    payload?: Record<string, unknown>;
    traceId?: string | null;
  };
}): Promise<void> {
  const ownerId = await input.store.getConnectionOwnerId(input.account.id);

  if (!ownerId) {
    if (input.webhook.traceId) {
      console.warn("Closing hosted device-sync webhook trace without an owner mapping.", {
        connectionId: input.account.id,
        provider: input.account.provider,
        traceId: input.webhook.traceId,
      });
      await input.store.prisma.$transaction(async (tx) => {
        await input.store.completeWebhookTrace(input.account.provider, input.webhook.traceId!, tx);
      });
    }

    return;
  }

  const hint = buildHostedWebhookHintSignal({
    connectionId: input.account.id,
    eventType: input.webhook.eventType,
    jobs: input.webhook.jobs,
    occurredAt: input.webhook.occurredAt ?? null,
    payload: input.webhook.payload,
    provider: input.account.provider,
    traceId: input.webhook.traceId ?? null,
  });
  const dispatch = buildHostedDeviceSyncWakeDispatch({
    connectionId: input.account.id,
    hint,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "webhook-accepted",
    traceId: input.webhook.traceId ?? null,
    userId: ownerId,
  });
  await publishHostedDeviceSyncWake({
    dispatch,
    store: input.store,
  });

  await input.store.prisma.$transaction(async (tx) => {
    await input.store.createSignal({
      userId: ownerId,
      connectionId: input.account.id,
      provider: input.account.provider,
      kind: "webhook_hint",
      occurredAt: input.webhook.occurredAt ?? input.now,
      traceId: input.webhook.traceId ?? null,
      eventType: input.webhook.eventType,
      resourceCategory: hint.resourceCategory ?? null,
      createdAt: input.now,
      tx,
    });

    if (input.webhook.traceId) {
      await input.store.completeWebhookTrace(input.account.provider, input.webhook.traceId, tx);
    }
  });
}

export async function dispatchHostedDeviceSyncWake(input: {
  connectionId: string;
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  provider: string;
  source: HostedDeviceSyncWakeSource;
  traceId?: string | null;
  userId: string;
}): Promise<{ dispatched: boolean; reason?: string }> {
  const prisma = getPrisma();
  const hint = buildHostedDeviceSyncSignalPayload(input);
  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma,
  });
  const dispatch = buildHostedDeviceSyncWakeDispatch({
    ...input,
    hint,
  });

  await prisma.$transaction(async (tx) => {
    return store.createSignal({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: input.provider,
      kind: mapHostedDeviceSyncSignalKind(input.source),
      occurredAt: hint.occurredAt ?? null,
      traceId: normalizeNullableString(hint.traceId),
      eventType: normalizeNullableString(hint.eventType),
      resourceCategory: normalizeNullableString(hint.resourceCategory),
      reason: normalizeNullableString(hint.reason),
      nextReconcileAt: hint.nextReconcileAt ?? null,
      revokeWarning: hint.revokeWarning ?? null,
      createdAt: input.occurredAt,
      tx,
    });
  });

  await publishHostedDeviceSyncWake({
    dispatch,
    store,
  });

  return {
    dispatched: true,
  };
}

async function publishHostedDeviceSyncWake(input: {
  dispatch: HostedExecutionDispatchRequest;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<void> {
  // Webhook retries rebuild fresh signal rows, so the outbox identity must stay tied to
  // the stable wake event id instead of the transient signal primary key.
  await enqueueHostedExecutionOutbox({
    dispatch: input.dispatch,
    sourceId: input.dispatch.eventId,
    sourceType: "device_sync_signal",
    storage: "reference",
    tx: input.store.prisma,
  });
}

function buildHostedDeviceSyncSignalPayload(input: {
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  traceId?: string | null;
}): NonNullable<HostedExecutionDeviceSyncWakeEvent["hint"]> {
  return {
    ...(input.hint ?? {}),
    ...(input.hint?.occurredAt === undefined ? { occurredAt: input.occurredAt } : {}),
    ...(input.traceId && input.hint?.traceId === undefined ? { traceId: input.traceId } : {}),
  };
}

function mapHostedDeviceSyncSignalKind(source: HostedDeviceSyncWakeSource): string {
  switch (source) {
    case "connection-established":
      return "connected";
    case "disconnect":
      return "disconnected";
    case "webhook-accepted":
      return "webhook_hint";
    default:
      throw new Error(`Unsupported hosted device-sync wake source: ${String(source)}`);
  }
}

function buildHostedWebhookHintSignal(input: {
  connectionId: string;
  eventType: string;
  jobs?: readonly DeviceSyncJobInput[];
  traceId?: string | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown>;
  provider: string;
}): NonNullable<HostedExecutionDeviceSyncWakeEvent["hint"]> {
  const resourceCategory =
    typeof input.payload?.dataType === "string"
      ? input.payload.dataType
      : typeof input.payload?.resourceType === "string"
        ? input.payload.resourceType
        : null;

  return {
    eventType: input.eventType,
    jobs: normalizeHostedDeviceSyncJobHints({
      connectionId: input.connectionId,
      jobs: input.jobs ?? [],
      occurredAt: input.occurredAt,
      provider: input.provider,
      reason: "webhook_hint",
      traceId: input.traceId,
    }),
    occurredAt: input.occurredAt ?? null,
    resourceCategory,
    traceId: input.traceId ?? null,
  } satisfies HostedExecutionDeviceSyncWakeEvent["hint"];
}

function normalizeHostedDeviceSyncJobHints(input: {
  connectionId: string;
  jobs: readonly DeviceSyncJobInput[];
  occurredAt?: string | null;
  provider: string;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  traceId?: string | null;
}): HostedExecutionDeviceSyncJobHint[] {
  return input.jobs.map((job, index) => {
    const payload = shapeHostedDeviceSyncJobHintPayload(input.provider, job);
    const stableSeed = JSON.stringify({
      connectionId: input.connectionId,
      index,
      kind: job.kind,
      payload,
      reason: input.reason,
      traceId: input.traceId ?? null,
    });

    return {
      kind: job.kind,
      ...(job.availableAt ? { availableAt: job.availableAt } : {}),
      dedupeKey: job.dedupeKey ?? `hosted-device-sync:${sha256Hex(stableSeed)}`,
      ...(typeof job.maxAttempts === "number" ? { maxAttempts: job.maxAttempts } : {}),
      payload,
      ...(typeof job.priority === "number" ? { priority: job.priority } : {}),
    } satisfies HostedExecutionDeviceSyncJobHint;
  });
}
