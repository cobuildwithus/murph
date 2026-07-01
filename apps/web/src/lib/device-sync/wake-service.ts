import {
  buildJunctionProviderSourceInstanceKey,
  normalizeJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";
import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";
import type {
  DeviceSyncIngressWebhook,
  DeviceSyncJobInput,
  DeviceSyncRegistry,
  DeviceSyncWebhookAcceptanceMode,
  ProviderConnectionResult,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import {
  shapeHostedDeviceSyncJobHintPayload,
} from "@murphai/device-syncd/hosted-hints";
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
  type HostedExecutionDeviceSyncJobHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionWake,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import {
  appendHostedMailboxEnvelopeTx,
  type AppendHostedMailboxItemResult,
} from "../hosted-mailbox/store";
import {
  signalHostedDeviceSyncMailboxRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  buildHostedDeviceSyncWake,
} from "./wake";
import { PrismaDeviceSyncControlPlaneStore, type HostedPrismaTransactionClient } from "./prisma-store";
import type { HostedDeviceSyncDirtyResource } from "./prisma-store";
import {
  normalizeNullableString,
  sha256Hex,
  toIsoTimestamp,
} from "./shared";

const HOSTED_DEVICE_SYNC_WAKE_EVENT_SCHEMA = "v1";

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

  let providerConfigRevokeSucceeded = false;
  let warning: { code: string; message: string } | undefined;

  if (storedAccount) {
    const provider = input.registry.get(existing.provider);
    const revokeAccess = provider?.connectionHandler?.revokeAccess;

    const shouldRevoke = revokeAccess && (
      existing.status !== "disconnected"
      || storedAccount.credential.kind === "provider_config"
    );

    if (shouldRevoke) {
      try {
        await revokeAccess(storedAccount);
        providerConfigRevokeSucceeded = storedAccount.credential.kind === "provider_config";
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
  const disconnectResult = await input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const freshExisting = await input.store.getConnectionForUser(input.userId, input.connectionId, tx);

    if (!freshExisting) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    const freshStoredAccount = await input.store.getStoredConnectionAccountForUser(
      input.userId,
      input.connectionId,
      tx,
    );

    if (storedAccount && !storedAccountMatchesDisconnectTarget(storedAccount, freshStoredAccount)) {
      connectionChangedDuringDisconnectError();
    }

    if (
      freshExisting.status === "disconnected"
      && freshStoredAccount?.credential.kind === "provider_config"
      && providerConfigRevokeSucceeded
    ) {
      const credentialCleared = await input.store.clearStoredProviderConfigCredential({
        connectionId: freshExisting.id,
        externalAccountId: freshStoredAccount.externalAccountId,
        provider: freshExisting.provider,
        providerConfigKey: freshStoredAccount.credential.providerConfigKey,
        tx,
        userId: input.userId,
      });
      if (!credentialCleared) {
        throw connectionChangedDuringDisconnectError();
      }

      return {
        connection: freshExisting,
        mailboxItemId: null,
      };
    }

    if (
      freshExisting.status === "disconnected"
      && freshStoredAccount?.credential.kind !== "oauth_tokens"
    ) {
      return {
        connection: freshExisting,
        mailboxItemId: null,
      };
    }

    const disconnectedConnection: PublicDeviceSyncAccount = {
      ...freshExisting,
      accessTokenExpiresAt: null,
      lastErrorCode: warning?.code ?? null,
      lastErrorMessage: warning?.message ?? null,
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
      provider: freshExisting.provider,
      source: "disconnect",
      userId: input.userId,
    });

    await input.store.syncDurableConnectionState(disconnectedConnection, tx);
    await input.store.markConnectionSourcesDisconnected({
      connectionId: input.connectionId,
      now,
      tx,
    });
    if (freshStoredAccount?.credential.kind === "provider_config" && providerConfigRevokeSucceeded) {
      const credentialCleared = await input.store.clearStoredProviderConfigCredential({
        connectionId: input.connectionId,
        externalAccountId: freshStoredAccount.externalAccountId,
        provider: freshExisting.provider,
        providerConfigKey: freshStoredAccount.credential.providerConfigKey,
        tx,
        userId: input.userId,
      });
      if (!credentialCleared) {
        throw connectionChangedDuringDisconnectError();
      }
    } else {
      await input.store.persistStoredConnectionTokenBundle({
        connectionId: input.connectionId,
        clearRefreshLease: true,
        externalAccountId: freshStoredAccount?.externalAccountId ?? null,
        provider: freshExisting.provider,
        tokenBundle: null,
        tx,
      });
    }
    await input.store.createSignal({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: freshExisting.provider,
      kind: "disconnected",
      occurredAt: now,
      reason: normalizeNullableString(hint.reason),
      revokeWarning: warning ?? null,
      createdAt: now,
      tx,
    });
    const mailboxAppend = await appendHostedMailboxEnvelopeTx({
      envelope: wake,
      tx,
    });

    return {
      connection: disconnectedConnection,
      mailboxItemId: mailboxAppend.item.id,
    };
  });

  if (disconnectResult.mailboxItemId) {
    await startHostedDeviceSyncWakeWorkflow(disconnectResult.mailboxItemId);
  }

  return {
    connection: disconnectResult.connection,
    ...(warning ? { warning } : {}),
  };
}

export function handleHostedDeviceSyncUnknownWebhook({
  externalAccountId,
  provider,
  traceId,
  webhook,
}: {
  externalAccountId: string;
  now: string;
  provider: { provider: string };
  traceId: string;
  webhook: DeviceSyncIngressWebhook;
}): void {
  console.warn("Accepted orphan hosted device-sync webhook.", {
    provider: provider.provider,
    externalAccountIdHash: sha256Hex(externalAccountId),
    eventType: webhook.eventType,
    resourceCategory: normalizeNullableString(webhook.resourceCategory),
    traceIdPresent: normalizeNullableString(traceId) !== null,
  });
}

function storedAccountMatchesDisconnectTarget(
  expected: Awaited<ReturnType<PrismaDeviceSyncControlPlaneStore["getStoredConnectionAccountForUser"]>>,
  current: Awaited<ReturnType<PrismaDeviceSyncControlPlaneStore["getStoredConnectionAccountForUser"]>>,
): boolean {
  if (!expected || !current) {
    return expected === current;
  }

  if (
    expected.provider !== current.provider
    || expected.externalAccountId !== current.externalAccountId
    || expected.credential.kind !== current.credential.kind
  ) {
    return false;
  }

  if (expected.credential.kind === "provider_config" || current.credential.kind === "provider_config") {
    return expected.credential.kind === "provider_config"
      && current.credential.kind === "provider_config"
      && expected.credential.providerConfigKey === current.credential.providerConfigKey;
  }

  return true;
}

function connectionChangedDuringDisconnectError(): never {
  throw deviceSyncError({
    code: "CONNECTION_CHANGED_DURING_DISCONNECT",
    message: "Hosted device-sync connection changed while disconnect was in progress. Retry disconnect.",
    retryable: true,
    httpStatus: 409,
  });
}

export async function handleHostedDeviceSyncConnectionEstablished(input: {
  account: {
    id: string;
    provider: string;
    scopes: string[];
  };
  sourceProviderSlug?: string | null;
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
        sourceProviderSlug: input.sourceProviderSlug ?? null,
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
  sourceProviderSlug: string | null;
}): { sourceInstanceKey: string; sourceProviderSlug: string } | null {
  if (input.account.provider !== "junction") {
    return null;
  }

  const sourceProviderSlug = normalizeJunctionProviderSlug(input.sourceProviderSlug);
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
  claimToken: string;
  now: string;
  store: PrismaDeviceSyncControlPlaneStore;
  traceId?: string | null;
  webhook: DeviceSyncIngressWebhook;
}): Promise<void> {
  const traceId = normalizeNullableString(input.traceId);
  const ownerId = await input.store.getConnectionOwnerId(input.account.id);

  if (!ownerId) {
    console.warn("Rejecting hosted device-sync webhook without an owner mapping.", {
      connectionFingerprint: sha256Hex(input.account.id).slice(0, 16),
      provider: input.account.provider,
      traceIdPresent: traceId !== null,
    });

    throw deviceSyncError({
      code: "CONNECTION_OWNER_NOT_FOUND",
      message: "Hosted device-sync connection owner mapping is missing. Retry later.",
      retryable: true,
      httpStatus: 503,
    });
  }

  const resourceCategory = normalizeNullableString(input.webhook.resourceCategory);
  await persistHostedDeviceSyncWebhookAccepted({
    acceptedAt: input.now,
    acceptanceMode: input.webhook.acceptanceMode,
    connectionId: input.account.id,
    dirtyResources: buildHostedWebhookDirtyResources({
      jobs: input.webhook.jobs ?? [],
      provider: input.account.provider,
    }),
    eventType: input.webhook.eventType,
    occurredAt: input.webhook.occurredAt ?? input.now,
    provider: input.account.provider,
    resourceCategory,
    store: input.store,
    claimToken: input.claimToken,
    traceId,
    userId: ownerId,
  });
}

export interface HostedDeviceSyncScheduledReconcileWakeResult {
  reason?: string;
  wakeAccepted: boolean;
  wakeAppended: boolean;
  wakeDuplicate: boolean;
  wakeInserted: boolean;
}

export async function appendHostedDeviceSyncScheduledReconcileWake(input: {
  connectionId: string;
  createdAt: string;
  eventId: string;
  nextReconcileAt: string;
  provider: string;
  traceId?: string | null;
  userId: string;
}): Promise<HostedDeviceSyncScheduledReconcileWakeResult> {
  const prisma = getPrisma();
  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma,
  });
  const hint = buildHostedDeviceSyncSignalPayload({
    hint: {
      nextReconcileAt: input.nextReconcileAt,
      occurredAt: input.nextReconcileAt,
    },
    occurredAt: input.nextReconcileAt,
    traceId: input.traceId ?? null,
  });
  const wake = buildHostedDeviceSyncWake({
    connectionId: input.connectionId,
    eventId: input.eventId,
    hint,
    occurredAt: input.nextReconcileAt,
    provider: input.provider,
    source: "scheduled-reconcile",
    traceId: input.traceId ?? null,
    userId: input.userId,
  });
  const appendResult = await persistHostedDeviceSyncWake({
    signalFailureMode: "throw",
    wake,
    store,
    persist: async () => {},
    complete: async () => {
      await store.createSignal({
        userId: input.userId,
        connectionId: input.connectionId,
        provider: input.provider,
        kind: "reconcile_due",
        occurredAt: hint.occurredAt ?? null,
        traceId: normalizeNullableString(hint.traceId),
        eventType: null,
        resourceCategory: null,
        reason: null,
        nextReconcileAt: hint.nextReconcileAt ?? null,
        revokeWarning: null,
        createdAt: input.createdAt,
      });
    },
  });
  const wakeAccepted = appendResult.inserted
    || (appendResult.duplicate && !appendResult.dedupeConflict);

  return {
    ...(appendResult.dedupeConflict ? { reason: "dedupe_conflict" } : {}),
    wakeAccepted,
    wakeAppended: appendResult.inserted,
    wakeDuplicate: appendResult.duplicate && !appendResult.dedupeConflict,
    wakeInserted: appendResult.inserted,
  };
}

export function buildHostedDeviceSyncScheduledReconcileWakeEventId(input: {
  connectionId: string;
  nextReconcileAt: string;
}): string {
  return [
    "device-sync",
    "scheduled-reconcile",
    HOSTED_DEVICE_SYNC_WAKE_EVENT_SCHEMA,
    input.connectionId,
    input.nextReconcileAt,
  ].join(":");
}

async function persistHostedDeviceSyncWake(input: {
  wake: HostedExecutionWake;
  signalFailureMode?: "best_effort" | "throw";
  startWorkflowOnDuplicate?: boolean;
  store: PrismaDeviceSyncControlPlaneStore;
  persist(tx: HostedPrismaTransactionClient): Promise<void>;
  persistAfterAppend?(
    tx: HostedPrismaTransactionClient,
    mailboxAppend: AppendHostedMailboxItemResult,
  ): Promise<void>;
  complete?(): Promise<void>;
}): Promise<AppendHostedMailboxItemResult> {
  // Webhook retries rebuild fresh signal rows, so the canonical wake identity must stay
  // tied to the stable wake event id instead of the transient signal primary key.
  let mailboxItemId: string | null = null;
  const mailboxAppendState: {
    result: AppendHostedMailboxItemResult | null;
  } = {
    result: null,
  };

  await input.store.prisma.$transaction(async (tx) => {
    await input.persist(tx);
    const mailboxAppend = await appendHostedMailboxEnvelopeTx({
      envelope: input.wake,
      tx,
    });
    mailboxItemId = mailboxAppend.item.id;
    mailboxAppendState.result = mailboxAppend;
    await input.persistAfterAppend?.(tx, mailboxAppend);
  });

  const mailboxAppendResult = mailboxAppendState.result;
  if (!mailboxItemId || !mailboxAppendResult) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_SYNC_WAKE_MAILBOX_APPEND_MISSING",
      httpStatus: 503,
      message: "Hosted device-sync wake could not be queued for runner handoff.",
      retryable: true,
    });
  }

  const wakeAccepted = mailboxAppendResult.inserted
    || (mailboxAppendResult.duplicate && !mailboxAppendResult.dedupeConflict);
  if (
    mailboxAppendResult.inserted ||
    (
      mailboxAppendResult.duplicate
      && !mailboxAppendResult.dedupeConflict
      && input.startWorkflowOnDuplicate !== false
    )
  ) {
    await startHostedDeviceSyncWakeWorkflow(mailboxItemId, {
      failureMode: input.signalFailureMode ?? "best_effort",
    });
  }

  if (wakeAccepted) {
    await input.complete?.();
  }

  return mailboxAppendResult;
}

async function startHostedDeviceSyncWakeWorkflow(
  mailboxItemId: string,
  options: {
    failureMode?: "best_effort" | "throw";
  } = {},
): Promise<void> {
  try {
    await signalHostedDeviceSyncMailboxRuntime({
      mailboxItemId,
    });
  } catch (error) {
    const code = sanitizeHostedRuntimeErrorCode(
      isDeviceSyncError(error) ? error.code : "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED",
    ) ?? "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED";

    console.warn("Hosted device-sync wake Temporal signal failed after mailbox append.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, { code }),
      mailboxItemIdPresent: mailboxItemId.length > 0,
    });
    if (options.failureMode === "throw") {
      throw error;
    }
  }
}

async function persistHostedDeviceSyncWebhookAccepted(input: {
  acceptedAt: string;
  acceptanceMode: DeviceSyncWebhookAcceptanceMode;
  connectionId: string;
  dirtyResources: readonly HostedDeviceSyncDirtyResource[];
  eventType: string;
  occurredAt: string;
  provider: string;
  resourceCategory?: string | null;
  store: PrismaDeviceSyncControlPlaneStore;
  claimToken: string;
  traceId: string | null;
  userId: string;
}): Promise<void> {
  const result = await retryHostedWebhookAcceptanceOnDirtyContention(async () =>
    input.store.prisma.$transaction(async (tx) => {
      // Level webhooks may be coalesced only after committed dirty state exists.
      // Durable webhook work must be persisted or retried; dirty state alone never satisfies it.
      // Dirty state dedupes work; only the clean-to-dirty transition appends a durable runtime handoff.
      if (
        input.acceptanceMode === "level_dirty_hint"
        && await input.store.hasPendingDirtyConnection(input.connectionId, tx)
      ) {
        await completeHostedWebhookTraceTx(input, tx);
        return {
          wakeMailboxItemId: null,
        };
      }

      const dirtyUpdate = await input.store.upsertDirtyConnection({
        connectionId: input.connectionId,
        dirtyAt: input.occurredAt,
        eventType: input.eventType,
        provider: input.provider,
        resourceCategory: input.resourceCategory ?? null,
        resources: input.dirtyResources,
        traceId: input.traceId,
        tx,
        userId: input.userId,
      });
      await completeHostedWebhookTraceTx(input, tx);

      let wakeMailboxItemId: string | null = null;
      if (dirtyUpdate.shouldRequestWake) {
        const wake = buildHostedDeviceSyncWake({
          connectionId: input.connectionId,
          eventId: buildHostedDeviceSyncDirtyTransitionWakeEventId({
            connectionId: input.connectionId,
            dirtyRevision: dirtyUpdate.dirty.dirtyRevision,
            provider: input.provider,
            userId: input.userId,
          }),
          hint: buildHostedDeviceSyncSignalPayload({
            hint: {
              eventType: input.eventType,
              occurredAt: input.occurredAt,
              reason: "webhook_dirty_transition",
              resourceCategory: input.resourceCategory ?? null,
            },
            occurredAt: input.occurredAt,
            traceId: input.traceId,
          }),
          occurredAt: input.occurredAt,
          provider: input.provider,
          source: "webhook-hint",
          traceId: null,
          userId: input.userId,
        });
        const mailboxAppend = await appendHostedMailboxEnvelopeTx({
          envelope: wake,
          tx,
        });
        if (mailboxAppend.dedupeConflict) {
          throw deviceSyncError({
            code: "HOSTED_DEVICE_SYNC_DIRTY_WAKE_DEDUPE_CONFLICT",
            httpStatus: 503,
            message: "Hosted device-sync dirty wake conflicted with an existing wake identity.",
            retryable: true,
          });
        }
        wakeMailboxItemId = mailboxAppend.item.id;
      }
      await input.store.createSignal({
        userId: input.userId,
        connectionId: input.connectionId,
        provider: input.provider,
        kind: "webhook_hint",
        occurredAt: input.occurredAt,
        traceId: input.traceId,
        eventType: input.eventType,
        resourceCategory: input.resourceCategory ?? null,
        createdAt: input.acceptedAt,
        tx,
      });

      return {
        wakeMailboxItemId,
      };
    }));

  if (result.wakeMailboxItemId) {
    await startHostedDeviceSyncWakeWorkflow(result.wakeMailboxItemId, {
      failureMode: "best_effort",
    });
  }
}

function buildHostedDeviceSyncDirtyTransitionWakeEventId(input: {
  connectionId: string;
  dirtyRevision: bigint;
  provider: string;
  userId: string;
}): string {
  return [
    "device-sync",
    "dirty",
    HOSTED_DEVICE_SYNC_WAKE_EVENT_SCHEMA,
    input.userId,
    input.provider,
    input.connectionId,
    input.dirtyRevision.toString(),
  ].join(":");
}

const HOSTED_WEBHOOK_ACCEPTANCE_DIRTY_RETRY_ATTEMPTS = 12;
const HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE = "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION";

async function retryHostedWebhookAcceptanceOnDirtyContention<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < HOSTED_WEBHOOK_ACCEPTANCE_DIRTY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isHostedDirtyStateContentionError(error)
        || attempt === HOSTED_WEBHOOK_ACCEPTANCE_DIRTY_RETRY_ATTEMPTS - 1
      ) {
        throw error;
      }
      await waitForHostedWebhookAcceptanceRetry(attempt);
    }
  }

  throw new Error("Hosted device-sync webhook acceptance retry loop exhausted unexpectedly.");
}

function isHostedDirtyStateContentionError(error: unknown): boolean {
  return Boolean(
    typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE,
  );
}

async function waitForHostedWebhookAcceptanceRetry(attempt: number): Promise<void> {
  const delayMs = Math.min(25, 2 + attempt * 2 + Math.floor(Math.random() * 3));
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function completeHostedWebhookTraceTx(
  input: {
    claimToken: string;
    provider: string;
    store: PrismaDeviceSyncControlPlaneStore;
    traceId: string | null;
  },
  tx: HostedPrismaTransactionClient,
): Promise<void> {
  if (!input.traceId) {
    return;
  }

  const completed = await input.store.completeWebhookTrace(input.provider, input.traceId, input.claimToken, tx);
  if (!completed) {
    throw deviceSyncError({
      code: "WEBHOOK_TRACE_CLAIM_LOST",
      message: "Webhook trace claim was lost before durable acceptance completed.",
      retryable: true,
      httpStatus: 503,
    });
  }
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

function buildHostedWebhookDirtyResources(input: {
  jobs: readonly DeviceSyncJobInput[];
  provider: string;
}): HostedDeviceSyncDirtyResource[] {
  const resources: HostedDeviceSyncDirtyResource[] = [];

  for (const job of input.jobs) {
    const payload = shapeHostedDeviceSyncJobHintPayload(input.provider, job);
    resources.push({
      count: 1,
      jobKind: job.kind,
      payload: readHostedDirtyResourcePayload(payload),
      resource: readHostedDirtyResourceString(payload.resource),
      resourceCategory: readHostedDirtyResourceString(payload.resourceCategory),
      sourceProviderSlug: readHostedDirtyResourceString(payload.sourceProviderSlug),
      windowEnd: readHostedDirtyResourceString(payload.windowEnd),
      windowStart: readHostedDirtyResourceString(payload.windowStart),
    });
  }

  if (resources.length === 0) {
    resources.push({
      count: 1,
      jobKind: "reconcile",
      resource: null,
      resourceCategory: null,
      sourceProviderSlug: null,
      windowEnd: null,
      windowStart: null,
    });
  }

  return resources;
}

function readHostedDirtyResourceString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readHostedDirtyResourcePayload(
  value: Record<string, unknown>,
): HostedDeviceSyncDirtyResource["payload"] {
  const payload: Record<string, boolean | number | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "boolean") {
      payload[key] = entry;
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      payload[key] = entry;
    }
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}
