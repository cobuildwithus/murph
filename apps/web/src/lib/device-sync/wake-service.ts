import { Prisma } from "@prisma/client";
import { deviceSyncError, isDeviceSyncError } from "@murph/device-syncd";

import type {
  DeviceSyncRegistry,
  ProviderConnectionResult,
  PublicDeviceSyncAccount,
} from "@murph/device-syncd";
import { getPrisma } from "../prisma";
import {
  drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox,
} from "../hosted-execution/outbox";
import {
  buildHostedDeviceSyncWakeDispatch,
  type HostedDeviceSyncWakeSource,
} from "./hosted-dispatch";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { toIsoTimestamp } from "./shared";


export async function disconnectHostedDeviceSyncConnection(input: {
  connectionId: string;
  registry: DeviceSyncRegistry;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<{
  connection: PublicDeviceSyncAccount;
  warning?: { code: string; message: string };
}> {
  const existing = await input.store.getConnectionForUser(input.userId, input.connectionId);

  if (!existing) {
    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
      httpStatus: 404,
    });
  }

  const bundle = await input.store.getConnectionBundleForUser(input.userId, input.connectionId);
  let warning: { code: string; message: string } | undefined;

  if (bundle) {
    const provider = input.registry.get(bundle.account.provider);

    if (provider?.revokeAccess) {
      try {
        await provider.revokeAccess(bundle.account);
      } catch (error) {
        warning = {
          code: isDeviceSyncError(error) ? error.code : "PROVIDER_REVOKE_FAILED",
          message: error instanceof Error ? error.message : "Provider revoke request failed during disconnect.",
        };
      }
    }
  }

  const now = toIsoTimestamp(new Date());
  const dispatch = buildHostedDeviceSyncWakeDispatch({
    connectionId: input.connectionId,
    occurredAt: now,
    provider: existing.provider,
    source: "disconnect",
    userId: input.userId,
  });
  const connection = await input.store.prisma.$transaction(async (tx) => {
    const disconnected = await input.store.markConnectionDisconnected({
      connectionId: input.connectionId,
      userId: input.userId,
      now,
      errorCode: null,
      errorMessage: null,
      tx,
    });
    const signal = await input.store.createSignal({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: disconnected.provider,
      kind: "disconnected",
      payload: warning
        ? {
            reason: "user_disconnect",
            revokeWarning: warning,
          }
        : {
            reason: "user_disconnect",
          },
      createdAt: now,
      tx,
    });
    await enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: String(signal.id),
      sourceType: "device_sync_signal",
      tx,
    });
    return disconnected;
  });
  await drainHostedExecutionOutboxBestEffort({
    context: `device-sync disconnect user=${input.userId} provider=${connection.provider} connection=${input.connectionId}`,
    eventIds: [dispatch.eventId],
    prisma: input.store.prisma,
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

  const dispatch = buildHostedDeviceSyncWakeDispatch({
    connectionId: input.account.id,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "connection-established",
    userId: ownerId,
  });
  await input.store.prisma.$transaction(async (tx) => {
    const signal = await input.store.createSignal({
      userId: ownerId,
      connectionId: input.account.id,
      provider: input.account.provider,
      kind: "connected",
      payload: {
        initialJobs: input.connection.initialJobs ?? [],
        nextReconcileAt: input.connection.nextReconcileAt ?? null,
        scopes: input.account.scopes,
      },
      createdAt: input.now,
      tx,
    });
    await enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: String(signal.id),
      sourceType: "device_sync_signal",
      tx,
    });
  });
  await drainHostedExecutionOutboxBestEffort({
    context: `device-sync connection-established user=${ownerId} provider=${input.account.provider} connection=${input.account.id}`,
    eventIds: [dispatch.eventId],
    prisma: input.store.prisma,
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
    occurredAt?: string | null;
    payload?: Record<string, unknown>;
    traceId?: string | null;
  };
}): Promise<void> {
  const ownerId = await input.store.getConnectionOwnerId(input.account.id);

  if (!ownerId) {
    return;
  }

  const dispatch = buildHostedDeviceSyncWakeDispatch({
    connectionId: input.account.id,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "webhook-accepted",
    traceId: input.webhook.traceId ?? null,
    userId: ownerId,
  });
  await input.store.prisma.$transaction(async (tx) => {
    const signal = await input.store.createSignal({
      userId: ownerId,
      connectionId: input.account.id,
      provider: input.account.provider,
      kind: "webhook_hint",
      payload: buildHostedWebhookHintSignal(input.webhook),
      createdAt: input.now,
      tx,
    });
    await enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: String(signal.id),
      sourceType: "device_sync_signal",
      tx,
    });
    if (input.webhook.traceId) {
      await input.store.completeWebhookTrace(input.account.provider, input.webhook.traceId, tx);
    }
  });
  await drainHostedExecutionOutboxBestEffort({
    context: `device-sync webhook-accepted user=${ownerId} provider=${input.account.provider} connection=${input.account.id}`,
    eventIds: [dispatch.eventId],
    prisma: input.store.prisma,
  });
}

export async function dispatchHostedDeviceSyncWake(input: {
  connectionId: string;
  occurredAt: string;
  provider: string;
  source: HostedDeviceSyncWakeSource;
  traceId?: string | null;
  userId: string;
}): Promise<{ dispatched: boolean; reason?: string }> {
  const prisma = getPrisma();
  const dispatch = buildHostedDeviceSyncWakeDispatch(input);

  await prisma.$transaction(async (tx) => {
    const signal = await tx.deviceSyncSignal.create({
      data: {
        connectionId: input.connectionId,
        createdAt: new Date(input.occurredAt),
        kind: mapHostedDeviceSyncSignalKind(input.source),
        payloadJson: buildHostedDeviceSyncSignalPayload(input),
        provider: input.provider,
        userId: input.userId,
      },
    });
    await enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: String(signal.id),
      sourceType: "device_sync_signal",
      tx,
    });
  });
  await drainHostedExecutionOutboxBestEffort({
    context: `device-sync ${input.source} user=${input.userId} provider=${input.provider} connection=${input.connectionId}`,
    eventIds: [dispatch.eventId],
    prisma,
  });

  return {
    dispatched: true,
  };
}

function buildHostedDeviceSyncSignalPayload(input: {
  occurredAt: string;
  traceId?: string | null;
}): Prisma.InputJsonObject {
  return {
    occurredAt: input.occurredAt,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  } satisfies Prisma.InputJsonObject;
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
      return source satisfies never;
  }
}

function buildHostedWebhookHintSignal(input: {
  eventType: string;
  traceId?: string | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown>;
}): Record<string, unknown> {
  const signal: Record<string, unknown> = {
    eventType: input.eventType,
    traceId: input.traceId ?? null,
    occurredAt: input.occurredAt ?? null,
  };
  const resourceCategory =
    typeof input.payload?.dataType === "string"
      ? input.payload.dataType
      : typeof input.payload?.resourceType === "string"
        ? input.payload.resourceType
        : null;

  if (resourceCategory) {
    signal.resourceCategory = resourceCategory;
  }

  return signal;
}
