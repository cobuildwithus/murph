import { Prisma } from "@prisma/client";
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
  HostedExecutionDispatchRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncJobHint,
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
  composeHostedRuntimeDeviceSyncAccount,
  findHostedDeviceSyncRuntimeConnection,
} from "./internal-runtime";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { sha256Hex, toIsoTimestamp, toJsonRecord } from "./shared";

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

  let warning: { code: string; message: string } | undefined;
  const runtimeSnapshot = await requireHostedExecutionControlClient().getDeviceSyncRuntimeSnapshot(
    input.userId,
    {
      connectionId: input.connectionId,
      provider: existing.provider,
    },
  );
  const runtimeConnection = findHostedDeviceSyncRuntimeConnection(runtimeSnapshot, input.connectionId);

  if (existing.status === "disconnected") {
    if (runtimeConnection) {
      await clearHostedDeviceSyncRuntimeConnection({
        connectionId: input.connectionId,
        controlClient: requireHostedExecutionControlClient(),
        now: toIsoTimestamp(new Date()),
        provider: existing.provider,
        runtimeConnection,
        userId: input.userId,
      });
    }

    return {
      connection: existing,
    };
  }

  if (runtimeConnection?.tokenBundle) {
    const provider = input.registry.get(existing.provider);

    if (provider?.revokeAccess) {
      try {
        await provider.revokeAccess(composeHostedRuntimeDeviceSyncAccount({
          connection: existing,
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
  const { connection, signalId } = await input.store.prisma.$transaction(async (tx) => {
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
      payload: hint,
      createdAt: now,
      tx,
    });
    return {
      connection: disconnected,
      signalId: signal.id,
    };
  });

  if (runtimeConnection) {
    await clearHostedDeviceSyncRuntimeConnection({
      connectionId: input.connectionId,
      controlClient: requireHostedExecutionControlClient(),
      now,
      provider: existing.provider,
      runtimeConnection,
      userId: input.userId,
      warning,
    });
  }

  await publishHostedDeviceSyncWake({
    connectionId: input.connectionId,
    dispatch,
    provider: existing.provider,
    signalId,
    store: input.store,
    userId: input.userId,
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
  const signal = await input.store.prisma.$transaction(async (tx) => {
    return input.store.createSignal({
      userId: ownerId,
      connectionId: input.account.id,
      provider: input.account.provider,
      kind: "connected",
      payload: hint,
      createdAt: input.now,
      tx,
    });
  });

  await publishHostedDeviceSyncWake({
    connectionId: input.account.id,
    dispatch,
    provider: input.account.provider,
    signalId: signal.id,
    store: input.store,
    userId: ownerId,
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
  const signal = await input.store.prisma.$transaction(async (tx) => {
    return input.store.createSignal({
      userId: ownerId,
      connectionId: input.account.id,
      provider: input.account.provider,
      kind: "webhook_hint",
      payload: toJsonRecord(hint),
      createdAt: input.now,
      tx,
    });
  });

  await publishHostedDeviceSyncWake({
    connectionId: input.account.id,
    dispatch,
    provider: input.account.provider,
    signalId: signal.id,
    store: input.store,
    userId: ownerId,
  });

  if (input.webhook.traceId) {
    await input.store.completeWebhookTrace(input.account.provider, input.webhook.traceId);
  }
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

  const signal = await prisma.$transaction(async (tx) => {
    return tx.deviceSyncSignal.create({
      data: {
        connectionId: input.connectionId,
        createdAt: new Date(input.occurredAt),
        kind: mapHostedDeviceSyncSignalKind(input.source),
        payloadJson: hint,
        provider: input.provider,
        userId: input.userId,
      },
    });
  });

  await publishHostedDeviceSyncWake({
    connectionId: input.connectionId,
    dispatch,
    provider: input.provider,
    signalId: signal.id,
    store,
    userId: input.userId,
  });

  return {
    dispatched: true,
  };
}

async function publishHostedDeviceSyncWake(input: {
  connectionId: string;
  dispatch: HostedExecutionDispatchRequest;
  provider: string;
  signalId: number;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<void> {
  await enqueueHostedExecutionOutbox({
    dispatch: input.dispatch,
    sourceId: String(input.signalId),
    sourceType: "device_sync_signal",
    storage: "reference",
    tx: input.store.prisma,
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

async function clearHostedDeviceSyncRuntimeConnection(input: {
  connectionId: string;
  controlClient: ReturnType<typeof requireHostedExecutionControlClient>;
  now: string;
  provider: string;
  runtimeConnection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot;
  userId: string;
  warning?: { code: string; message: string };
}): Promise<void> {
  let currentRuntimeConnection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot | null =
    input.runtimeConnection;

  for (let attempt = 0; attempt < 2 && currentRuntimeConnection; attempt += 1) {
    const response = await input.controlClient.applyDeviceSyncRuntimeUpdates(input.userId, {
      occurredAt: input.now,
      updates: [
        {
          connection: {
            status: "disconnected",
          },
          connectionId: input.connectionId,
          localState: {
            clearError: true,
            ...(input.warning?.code ? { lastErrorCode: input.warning.code } : {}),
            ...(input.warning?.message ? { lastErrorMessage: input.warning.message } : {}),
          },
          observedTokenVersion: currentRuntimeConnection.tokenBundle?.tokenVersion ?? null,
          observedUpdatedAt:
            currentRuntimeConnection.connection.updatedAt ?? currentRuntimeConnection.connection.createdAt,
          tokenBundle: null,
        },
      ],
    });

    if (isHostedDeviceSyncRuntimeDisconnectApplied(response, input.connectionId)) {
      return;
    }

    currentRuntimeConnection = findHostedDeviceSyncRuntimeConnection(
      await input.controlClient.getDeviceSyncRuntimeSnapshot(input.userId, {
        connectionId: input.connectionId,
        provider: input.provider,
      }),
      input.connectionId,
    );

    if (
      !currentRuntimeConnection
      || (
        currentRuntimeConnection.connection.status === "disconnected"
        && currentRuntimeConnection.tokenBundle === null
      )
    ) {
      return;
    }
  }

  throw deviceSyncError({
    code: "RUNTIME_STATE_CONFLICT",
    message: `Hosted device-sync runtime could not clear escrowed state for connection ${input.connectionId}.`,
    retryable: true,
    httpStatus: 409,
  });
}

function isHostedDeviceSyncRuntimeDisconnectApplied(
  response: HostedExecutionDeviceSyncRuntimeApplyResponse,
  connectionId: string,
): boolean {
  const update = response.updates.find((entry) => entry.connectionId === connectionId);

  return update?.status === "updated"
    && update.connection?.status === "disconnected"
    && (update.tokenUpdate === "cleared" || update.tokenUpdate === "missing");
}
