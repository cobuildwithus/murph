import { Prisma } from "@prisma/client";
import {
  deviceSyncError,
  isDeviceSyncError,
  type DeviceSyncJobInput,
  type DeviceSyncRegistry,
  type ProviderConnectionResult,
  type PublicDeviceSyncAccount,
} from "@murph/device-syncd";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncWakeEvent,
} from "@murph/hosted-execution";

import { getPrisma } from "../prisma";
import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
import {
  buildHostedDeviceSyncWakeDispatch,
  type HostedDeviceSyncWakeSource,
} from "./hosted-dispatch";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { sha256Hex, toIsoTimestamp, toJsonRecord } from "./shared";

const HOSTED_DEVICE_SYNC_REDACTED_PAYLOAD_KEYS = new Set([
  "access_token",
  "accessToken",
  "api_key",
  "apiKey",
  "authorization",
  "bearer_token",
  "bearerToken",
  "cookie",
  "id_token",
  "idToken",
  "oauth_access_token",
  "oauth_refresh_token",
  "oauthAccessToken",
  "oauthRefreshToken",
  "refresh_token",
  "refreshToken",
  "webhookPayload",
]);

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
  const connection = await input.store.prisma.$transaction(async (tx) => {
    const disconnected = await input.store.markConnectionDisconnected({
      connectionId: input.connectionId,
      userId: input.userId,
      now,
      errorCode: null,
      errorMessage: null,
      tx,
    });
    await createHostedDeviceSyncSignalAndEnqueueWake({
      dispatch,
      tx,
      createSignal: () =>
        input.store.createSignal({
          userId: input.userId,
          connectionId: input.connectionId,
          provider: disconnected.provider,
          kind: "disconnected",
          payload: hint,
          createdAt: now,
          tx,
        }),
    });
    return disconnected;
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
    await createHostedDeviceSyncSignalAndEnqueueWake({
      dispatch,
      tx,
      createSignal: () =>
        input.store.createSignal({
          userId: ownerId,
          connectionId: input.account.id,
          provider: input.account.provider,
          kind: "connected",
          payload: hint,
          createdAt: input.now,
          tx,
        }),
    });
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
    return;
  }

  const hint = buildHostedWebhookHintSignal({
    connectionId: input.account.id,
    eventType: input.webhook.eventType,
    jobs: input.webhook.jobs,
    occurredAt: input.webhook.occurredAt ?? null,
    payload: input.webhook.payload,
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
  await input.store.prisma.$transaction(async (tx) => {
    await createHostedDeviceSyncSignalAndEnqueueWake({
      dispatch,
      tx,
      createSignal: () =>
        input.store.createSignal({
          userId: ownerId,
          connectionId: input.account.id,
          provider: input.account.provider,
          kind: "webhook_hint",
          payload: toJsonRecord(hint),
          createdAt: input.now,
          tx,
        }),
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
  const dispatch = buildHostedDeviceSyncWakeDispatch({
    ...input,
    hint,
  });

  await prisma.$transaction(async (tx) => {
    await createHostedDeviceSyncSignalAndEnqueueWake({
      dispatch,
      tx,
      createSignal: () =>
        tx.deviceSyncSignal.create({
          data: {
            connectionId: input.connectionId,
            createdAt: new Date(input.occurredAt),
            kind: mapHostedDeviceSyncSignalKind(input.source),
            payloadJson: hint,
            provider: input.provider,
            userId: input.userId,
          },
        }),
    });
  });

  return {
    dispatched: true,
  };
}

async function createHostedDeviceSyncSignalAndEnqueueWake(input: {
  createSignal: () => Promise<{ id: number }>;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const signal = await input.createSignal();
  await enqueueHostedExecutionOutbox({
    dispatch: input.dispatch,
    sourceId: String(signal.id),
    sourceType: "device_sync_signal",
    tx: input.tx,
  });
}

function buildHostedDeviceSyncSignalPayload(input: {
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  traceId?: string | null;
}): Prisma.InputJsonObject {
  const hint = input.hint ? toJsonRecord(input.hint) : {};

  return {
    ...hint,
    ...(hint.occurredAt === undefined ? { occurredAt: input.occurredAt } : {}),
    ...(input.traceId && hint.traceId === undefined ? { traceId: input.traceId } : {}),
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
  connectionId: string;
  eventType: string;
  jobs?: readonly DeviceSyncJobInput[];
  traceId?: string | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown>;
}): HostedExecutionDeviceSyncWakeEvent["hint"] {
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
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  traceId?: string | null;
}): HostedExecutionDeviceSyncJobHint[] {
  return input.jobs.map((job, index) => {
    const payload = sanitizeHostedSignalPayloadValue(job.payload ?? {}) as Record<string, unknown>;
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

function sanitizeHostedSignalPayloadValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeHostedSignalPayloadValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (HOSTED_DEVICE_SYNC_REDACTED_PAYLOAD_KEYS.has(key)) {
      continue;
    }

    sanitized[key] = sanitizeHostedSignalPayloadValue(entry);
  }

  return sanitized;
}
