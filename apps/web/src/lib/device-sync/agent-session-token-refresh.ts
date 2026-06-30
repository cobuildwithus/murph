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
  HostedPrismaTransactionClient,
  HostedStoredDeviceSyncAccount,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import type { HostedStoredTokenBundle } from "./agent-session-token-bundle";

type ProviderTokenRefresh = NonNullable<DeviceConnectionHandler["refreshTokens"]>;

export type HostedProviderTokenRefreshResult =
  | { status: "success"; tokens: Awaited<ReturnType<ProviderTokenRefresh>> }
  | { status: "error"; error: unknown };

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
