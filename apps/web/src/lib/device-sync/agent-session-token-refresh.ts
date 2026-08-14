import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";

import type {
  DeviceConnectionHandler,
  DeviceSyncProvider,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import type {
  HostedConnectionRecord,
  HostedPrismaTransactionClient,
  HostedStoredDeviceSyncAccount,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import type { HostedStoredTokenBundle } from "./agent-session-token-bundle";

type ProviderTokenRefresh = NonNullable<DeviceConnectionHandler["refreshTokens"]>;

export type HostedProviderTokenRefreshResult =
  | { status: "success"; tokens: Awaited<ReturnType<ProviderTokenRefresh>> }
  | { status: "error"; error: unknown };

export type HostedTokenRefreshLeaseStatus =
  | { status: "none" }
  | { status: "in_progress"; leaseExpiresAt: string }
  | { status: "stale" };

export type HostedDestructiveActionRefreshLeaseResolution =
  | { status: "missing" }
  | { status: "none" }
  | { status: "in_progress"; leaseExpiresAt: string }
  | { status: "stale_recovered" };

export function classifyHostedTokenRefreshLease(input: {
  now: string;
  record: Pick<
    HostedConnectionRecord,
    | "refreshLeaseExpiresAt"
    | "refreshLeaseOwner"
    | "refreshLeaseTokenVersion"
    | "tokenVersion"
  >;
}): HostedTokenRefreshLeaseStatus {
  const leaseOwner = input.record.refreshLeaseOwner?.trim() ?? "";
  const hasAnyLeaseField = input.record.refreshLeaseOwner !== null
    || input.record.refreshLeaseExpiresAt !== null
    || input.record.refreshLeaseTokenVersion !== null;

  if (!hasAnyLeaseField) {
    return { status: "none" };
  }

  if (
    leaseOwner.length === 0
    || input.record.refreshLeaseExpiresAt === null
    || input.record.refreshLeaseTokenVersion === null
    || input.record.refreshLeaseTokenVersion !== input.record.tokenVersion
    || input.record.refreshLeaseExpiresAt.getTime() <= Date.parse(input.now)
  ) {
    return { status: "stale" };
  }

  return {
    status: "in_progress",
    leaseExpiresAt: input.record.refreshLeaseExpiresAt.toISOString(),
  };
}

export async function resolveHostedRefreshLeaseBeforeDestructiveAction(input: {
  connectionId: string;
  now: string;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<HostedDestructiveActionRefreshLeaseResolution> {
  return input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const record = await input.store.getConnectionRecordForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    if (!record) {
      return { status: "missing" };
    }

    const leaseStatus = classifyHostedTokenRefreshLease({
      now: input.now,
      record,
    });
    if (leaseStatus.status !== "stale") {
      return leaseStatus;
    }

    const account = await input.store.getConnectionForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    if (!account) {
      return { status: "missing" };
    }

    await failClosedStaleHostedTokenRefreshLease({
      account,
      now: input.now,
      store: input.store,
      tx,
      userId: input.userId,
    });
    return { status: "stale_recovered" };
  });
}

export async function failClosedStaleHostedTokenRefreshLease(input: {
  account: PublicDeviceSyncAccount;
  now: string;
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<unknown> {
  const error = buildHostedTokenRefreshStateUnknownError();
  const nextConnection: PublicDeviceSyncAccount = {
    ...input.account,
    lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
    lastErrorMessage: "Token refresh state is unknown. Reconnect this source.",
    lastSyncErrorAt: input.now,
    nextReconcileAt: null,
    status: "reauthorization_required",
    updatedAt: input.now,
  };

  await input.store.createSignal({
    userId: input.userId,
    connectionId: input.account.id,
    provider: input.account.provider,
    kind: "reauthorization_required",
    occurredAt: input.now,
    reason: "token_refresh_state_unknown",
    revokeWarning: {
      code: "TOKEN_REFRESH_STATE_UNKNOWN",
      message: "Token refresh state is unknown. Reconnect this source.",
    },
    createdAt: input.now,
    tx: input.tx,
  });
  await input.store.syncDurableConnectionState(nextConnection, input.tx);
  const leaseCleared = await input.store.clearStaleConnectionRefreshLease({
    connectionId: input.account.id,
    tx: input.tx,
    userId: input.userId,
  });
  if (!leaseCleared) {
    throw deviceSyncError({
      code: "TOKEN_REFRESH_RETRY_REQUIRED",
      message: "Hosted device-sync token refresh state changed before stale recovery completed.",
      retryable: true,
      httpStatus: 409,
    });
  }

  return error;
}

export async function refreshProviderTokens(input: {
  account: HostedStoredDeviceSyncAccount;
  provider: DeviceSyncProvider;
}): Promise<HostedProviderTokenRefreshResult> {
  try {
    const refreshTokens = input.provider.connectionHandler?.refreshTokens;

    if (!refreshTokens) {
      throw new Error(`Device sync provider ${input.provider.provider} does not support token refresh.`);
    }

    return {
      status: "success",
      tokens: await refreshTokens(input.account),
    };
  } catch (error) {
    return {
      status: "error",
      error,
    };
  }
}

export async function persistProviderTokenRefreshErrorStatus(input: {
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
  account: HostedStoredDeviceSyncAccount;
  currentTokenBundle: HostedStoredTokenBundle;
  error: unknown;
  now: string;
  refreshLeaseOwner?: string | null;
  userId: string;
}): Promise<unknown> {
  const accountStatus = isDeviceSyncError(input.error) && input.error.accountStatus
    ? input.error.accountStatus
    : "reauthorization_required";
  const persistedError = isDeviceSyncError(input.error) && input.error.accountStatus
    ? input.error
    : deviceSyncError({
        code: "TOKEN_REFRESH_STATE_UNKNOWN",
        message: "Hosted device-sync token refresh state is unknown. Reconnect this source before syncing again.",
        retryable: false,
        httpStatus: 409,
        accountStatus: "reauthorization_required",
      });

  const sanitizedErrorCode = sanitizeHostedRuntimeErrorCode(
    isDeviceSyncError(input.error) ? input.error.code : null,
  ) ?? "TOKEN_REFRESH_STATE_UNKNOWN";
  const sanitizedErrorMessage =
    sanitizeHostedRuntimeErrorText(
      input.error instanceof Error ? input.error.message : null,
    ) ?? "Token refresh state is unknown. Reconnect this source.";
  const seedAccount: PublicDeviceSyncAccount = {
    ...input.account,
    lastErrorCode: sanitizedErrorCode,
    lastErrorMessage: sanitizedErrorMessage,
    lastSyncErrorAt: input.now,
    nextReconcileAt: accountStatus === "disconnected" ? null : input.account.nextReconcileAt,
    status: accountStatus,
  };

  await input.store.createSignal({
    userId: input.userId,
    connectionId: input.account.id,
    provider: input.account.provider,
    kind: accountStatus === "disconnected" ? "disconnected" : "reauthorization_required",
    occurredAt: input.now,
    reason: persistedError === input.error ? "token_refresh_failed" : "token_refresh_state_unknown",
    revokeWarning: {
      code: sanitizedErrorCode,
      message: sanitizedErrorMessage,
    },
    createdAt: input.now,
    tx: input.tx,
  });
  await input.store.syncDurableConnectionState(seedAccount, input.tx);
  const shouldClearTokenBundle = accountStatus === "reauthorization_required"
    || accountStatus === "disconnected";

  await input.store.persistStoredConnectionTokenBundle({
    connectionId: input.account.id,
    externalAccountId: input.account.externalAccountId,
    provider: input.account.provider,
    refreshLeaseOwner: input.refreshLeaseOwner ?? null,
    tokenBundle: shouldClearTokenBundle
      ? null
      : { ...input.currentTokenBundle },
    tx: input.tx,
  });

  return persistedError;
}

export function buildHostedTokenRefreshStateUnknownError() {
  return deviceSyncError({
    code: "TOKEN_REFRESH_STATE_UNKNOWN",
    message: "Hosted device-sync token refresh state is unknown. Reconnect this source before syncing again.",
    retryable: false,
    httpStatus: 409,
    accountStatus: "reauthorization_required",
  });
}
