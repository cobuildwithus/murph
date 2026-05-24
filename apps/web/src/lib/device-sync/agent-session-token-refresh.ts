import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";

import type {
  DeviceConnectionHandler,
  DeviceSyncProvider,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
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
}): Promise<void> {
  if (!isDeviceSyncError(input.error) || !input.error.accountStatus) {
    return;
  }

  const sanitizedErrorCode = sanitizeHostedRuntimeErrorCode(input.error.code) ?? "TOKEN_REFRESH_FAILED";
  const sanitizedErrorMessage =
    sanitizeHostedRuntimeErrorText(input.error.message) ?? "Token refresh failed.";
  const seedAccount: PublicDeviceSyncAccount = {
    ...input.account,
    lastErrorCode: sanitizedErrorCode,
    lastErrorMessage: sanitizedErrorMessage,
    lastSyncErrorAt: input.now,
    nextReconcileAt: input.error.accountStatus === "disconnected" ? null : input.account.nextReconcileAt,
    status: input.error.accountStatus,
  };

  await input.store.createSignal({
    userId: input.userId,
    connectionId: input.account.id,
    provider: input.account.provider,
    kind: input.error.accountStatus === "disconnected" ? "disconnected" : "reauthorization_required",
    occurredAt: input.now,
    reason: "token_refresh_failed",
    revokeWarning: {
      code: sanitizedErrorCode,
      message: sanitizedErrorMessage,
    },
    createdAt: input.now,
    tx: input.tx,
  });
  await input.store.syncDurableConnectionState(seedAccount, input.tx);
  const shouldClearTokenBundle = input.error.accountStatus === "reauthorization_required"
    || input.error.accountStatus === "disconnected";

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
}
