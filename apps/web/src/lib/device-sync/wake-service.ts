import {
  buildJunctionProviderSourceInstanceKey,
  normalizeJunctionProviderSlug,
} from "@murphai/device-syncd/config";
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
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
  type HostedExecutionDeviceSyncJobHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionWake,
  HostedExecutionDeviceSyncWakeEvent,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { startHostedWebhookNudgeWorkflow } from "../hosted-onboarding/webhook-workflow-start";
import {
  buildHostedDeviceSyncWake,
  type HostedDeviceSyncWakeSource,
} from "./wake";
import {
  composeHostedRuntimeOAuthDeviceSyncAccount,
} from "./internal-runtime";
import { buildStoredTokenBundle } from "./agent-session-token-bundle";
import { PrismaDeviceSyncControlPlaneStore, type HostedPrismaTransactionClient } from "./prisma-store";
import {
  normalizeNullableString,
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
  const existing = await input.store.getConnectionForUser(input.userId, input.connectionId);

  if (!existing) {
    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
      httpStatus: 404,
    });
  }

  const storedAccount = await input.store.getStoredConnectionAccountForUser(input.userId, input.connectionId);

  if (existing.status === "disconnected" && !storedAccount) {
    return {
      connection: existing,
    };
  }

  let warning: { code: string; message: string } | undefined;

  if (storedAccount) {
    const provider = input.registry.get(existing.provider);
    const revokeAccess = provider?.connectionHandler?.revokeAccess;
    const storedTokenBundle = revokeAccess ? buildStoredTokenBundle(storedAccount) : null;

    if (revokeAccess && storedTokenBundle) {
      try {
        await revokeAccess(composeHostedRuntimeOAuthDeviceSyncAccount({
          connection: storedAccount,
          tokenBundle: storedTokenBundle,
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
    lastSyncCompletedAt: existing.lastSyncCompletedAt,
    lastSyncErrorAt: existing.lastSyncErrorAt,
    lastSyncStartedAt: existing.lastSyncStartedAt,
    lastWebhookAt: existing.lastWebhookAt,
    nextReconcileAt: null,
  } as const;
  const connection: PublicDeviceSyncAccount = {
    ...existing,
    accessTokenExpiresAt: null,
    lastErrorCode: disconnectLocalState.lastErrorCode,
    lastErrorMessage: disconnectLocalState.lastErrorMessage,
    nextReconcileAt: null,
    setupExpiresAt: null,
    setupPhase: null,
    status: "disconnected",
    updatedAt: now,
  };

  const hint = {
    reason: "user_disconnect",
    ...(warning ? { revokeWarning: warning } : {}),
  } satisfies HostedExecutionDeviceSyncWakeEvent["hint"];
  const wake = buildHostedDeviceSyncWake({
    connectionId: input.connectionId,
    hint,
    occurredAt: now,
    provider: existing.provider,
    source: "disconnect",
    userId: input.userId,
  });
  await persistHostedDeviceSyncWake({
    wake,
    store: input.store,
    persist: async (tx) => {
      await input.store.syncDurableConnectionState(connection, tx);
      await input.store.persistStoredConnectionTokenBundle({
        connectionId: input.connectionId,
        externalAccountId: storedAccount?.externalAccountId ?? null,
        provider: existing.provider,
        tokenBundle: null,
        tx,
      });
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
  connectSourceId?: string | null;
  connectTarget?: string | null;
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
  const wake = buildHostedDeviceSyncWake({
    connectionId: input.account.id,
    hint,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "connection-established",
    userId: ownerId,
  });
  await persistHostedDeviceSyncWake({
    wake,
    store: input.store,
    persist: async (tx) => {
      const linkedSource = resolveHostedJunctionLinkedSource({
        account: input.account,
        connectTarget: input.connectTarget ?? null,
      });
      if (linkedSource) {
        await input.store.upsertConnectionSource({
          connectionId: input.account.id,
          sourceInstanceKey: linkedSource.sourceInstanceKey,
          sourceProviderSlug: linkedSource.sourceProviderSlug,
          status: "connected",
          firstSeenAt: input.now,
          lastSeenAt: input.now,
          tx,
        });
      }

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

function resolveHostedJunctionLinkedSource(input: {
  account: {
    id: string;
    provider: string;
  };
  connectTarget: string | null;
}): { sourceInstanceKey: string; sourceProviderSlug: string } | null {
  if (input.account.provider !== "junction") {
    return null;
  }

  const sourceProviderSlug = normalizeJunctionProviderSlug(input.connectTarget);
  if (!sourceProviderSlug) {
    return null;
  }

  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: input.account.id,
    sourceProviderSlug,
  });

  return sourceInstanceKey
    ? {
      sourceInstanceKey,
      sourceProviderSlug,
    }
    : null;
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
  const wake = buildHostedDeviceSyncWake({
    connectionId: input.account.id,
    hint,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "webhook-accepted",
    traceId,
    userId: ownerId,
  });

  await persistHostedDeviceSyncWake({
    wake,
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
      ? async () => {
          await input.store.completeWebhookTrace(input.account.provider, traceId);
        }
      : undefined,
  });
}

export async function appendHostedDeviceSyncWake(input: {
  connectionId: string;
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  provider: string;
  source: HostedDeviceSyncWakeSource;
  traceId?: string | null;
  userId: string;
}): Promise<{ wakeAppended: boolean; reason?: string }> {
  const prisma = getPrisma();
  const hint = buildHostedDeviceSyncSignalPayload(input);
  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma,
  });
  const wake = buildHostedDeviceSyncWake({
    ...input,
    hint,
  });

  await persistHostedDeviceSyncWake({
    wake,
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
    wakeAppended: true,
  };
}

async function persistHostedDeviceSyncWake(input: {
  wake: HostedExecutionWake;
  store: PrismaDeviceSyncControlPlaneStore;
  persist(tx: HostedPrismaTransactionClient): Promise<void>;
  complete?(): Promise<void>;
}): Promise<void> {
  // Webhook retries rebuild fresh signal rows, so the canonical wake identity must stay
  // tied to the stable wake event id instead of the transient signal primary key.
  let mailboxItemId: string | null = null;

  await input.store.prisma.$transaction(async (tx) => {
    await input.persist(tx);
    const mailboxAppend = await appendHostedMailboxEnvelopeTx({
      envelope: input.wake,
      tx,
    });
    mailboxItemId = mailboxAppend.item.id;
  });

  if (!mailboxItemId) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_SYNC_WAKE_MAILBOX_APPEND_MISSING",
      httpStatus: 503,
      message: "Hosted device-sync wake could not be queued for runner handoff.",
      retryable: true,
    });
  }

  try {
    await startHostedWebhookNudgeWorkflow({
      mailboxItemId,
      source: "device-sync",
    });
  } catch (error) {
    throw deviceSyncError({
      cause: error,
      code: "HOSTED_DEVICE_SYNC_NUDGE_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Hosted device-sync wake is temporarily unavailable.",
      retryable: true,
    });
  }

  await input.complete?.();
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
