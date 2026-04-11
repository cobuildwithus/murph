import {
  deviceSyncError,
  isDeviceSyncError,
  type DeviceSyncIngressWebhook,
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
import {
  drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox,
} from "../hosted-execution/outbox";
import {
  buildHostedDeviceSyncWakeDispatch,
  type HostedDeviceSyncWakeSource,
} from "./hosted-dispatch";
import {
  buildHostedDeviceSyncRuntimeSeedFromPublicAccount,
  composeHostedRuntimeDeviceSyncAccount,
  findHostedDeviceSyncRuntimeConnection,
} from "./internal-runtime";
import { PrismaDeviceSyncControlPlaneStore, type HostedPrismaTransactionClient } from "./prisma-store";
import { requireHostedDeviceSyncRuntimeClient } from "./runtime-client";
import {
  normalizeNullableString,
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
  sha256Hex,
  toIsoTimestamp,
} from "./shared";

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

  const runtimeClient = requireHostedDeviceSyncRuntimeClient();
  const runtimeSnapshot = await runtimeClient.getDeviceSyncRuntimeSnapshot(input.userId, {
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
          tokenBundle: runtimeConnection.tokenBundle,
        }));
      } catch (error) {
        const code = sanitizeHostedRuntimeErrorCode(
          isDeviceSyncError(error) ? error.code : "PROVIDER_REVOKE_FAILED",
        ) ?? "PROVIDER_REVOKE_FAILED";
        const message = sanitizeHostedRuntimeErrorText(
          error instanceof Error ? error.message : "Provider revoke request failed during disconnect.",
        ) ?? "Provider revoke request failed during disconnect.";

        warning = {
          code,
          message,
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

  const applyResponse = await runtimeClient.applyDeviceSyncRuntimeUpdates(input.userId, {
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
  await persistHostedDeviceSyncWake({
    dispatch,
    store: input.store,
    persist: async (tx) => {
      await input.store.createSignal({
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
    },
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
  await persistHostedDeviceSyncWake({
    dispatch,
    store: input.store,
    persist: async (tx) => {
      await input.store.createSignal({
        userId: ownerId,
        connectionId: input.account.id,
        provider: input.account.provider,
        kind: "connected",
        occurredAt: input.now,
        nextReconcileAt: input.connection.nextReconcileAt ?? null,
        createdAt: input.now,
        tx,
      });
    },
  });
}

export async function handleHostedDeviceSyncWebhookAccepted(input: {
  account: {
    id: string;
    provider: string;
  };
  now: string;
  store: PrismaDeviceSyncControlPlaneStore;
  traceId?: string | null;
  webhook: DeviceSyncIngressWebhook;
}): Promise<void> {
  const traceId = normalizeNullableString(input.traceId);
  const ownerId = await input.store.getConnectionOwnerId(input.account.id);

  if (!ownerId) {
    console.warn("Rejecting hosted device-sync webhook without an owner mapping.", {
      connectionId: input.account.id,
      provider: input.account.provider,
      traceId,
    });

    throw deviceSyncError({
      code: "CONNECTION_OWNER_NOT_FOUND",
      message: "Hosted device-sync connection owner mapping is missing. Retry later.",
      retryable: true,
      httpStatus: 503,
    });
  }

  const hint = buildHostedWebhookHintSignal({
    connectionId: input.account.id,
    eventType: input.webhook.eventType,
    jobs: input.webhook.jobs,
    occurredAt: input.webhook.occurredAt ?? null,
    provider: input.account.provider,
    resourceCategory: input.webhook.resourceCategory ?? null,
    traceId,
  });
  const dispatch = buildHostedDeviceSyncWakeDispatch({
    connectionId: input.account.id,
    hint,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "webhook-accepted",
    traceId,
    userId: ownerId,
  });

  await persistHostedDeviceSyncWake({
    dispatch,
    store: input.store,
    persist: async (tx) => {
      await input.store.createSignal({
        userId: ownerId,
        connectionId: input.account.id,
        provider: input.account.provider,
        kind: "webhook_hint",
        occurredAt: input.webhook.occurredAt ?? input.now,
        traceId,
        eventType: input.webhook.eventType,
        resourceCategory: hint.resourceCategory ?? null,
        createdAt: input.now,
        tx,
      });
    },
    complete: traceId
      ? async (tx) => {
          await input.store.completeWebhookTrace(input.account.provider, traceId, tx);
        }
      : undefined,
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

  await persistHostedDeviceSyncWake({
    dispatch,
    store,
    persist: async (tx) => {
      await store.createSignal({
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
    },
  });

  return {
    dispatched: true,
  };
}

async function persistHostedDeviceSyncWake(input: {
  dispatch: HostedExecutionDispatchRequest;
  store: PrismaDeviceSyncControlPlaneStore;
  persist(tx: HostedPrismaTransactionClient): Promise<void>;
  complete?(tx: HostedPrismaTransactionClient): Promise<void>;
}): Promise<void> {
  // Webhook retries rebuild fresh signal rows, so the outbox identity must stay tied to
  // the stable wake event id instead of the transient signal primary key.
  await input.store.prisma.$transaction(async (tx) => {
    await input.persist(tx);
    await enqueueHostedExecutionOutbox({
      dispatch: input.dispatch,
      sourceId: input.dispatch.eventId,
      sourceType: "device_sync_signal",
      storage: "reference",
      tx,
    });
    await input.complete?.(tx);
  });

  void drainHostedExecutionOutboxBestEffort({
    eventIds: [
      input.dispatch.eventId,
    ],
    limit: 1,
    prisma: input.store.prisma,
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
  provider: string;
  resourceCategory?: string | null;
}): NonNullable<HostedExecutionDeviceSyncWakeEvent["hint"]> {
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
    resourceCategory: input.resourceCategory ?? null,
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
