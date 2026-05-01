import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";

import type {
  DeviceSyncProvider,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import type {
  HostedPrismaTransactionClient,
  HostedStoredDeviceSyncAccount,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import type { HostedStoredTokenBundle } from "./agent-session-token-bundle";

type ProviderTokenRefresh = NonNullable<DeviceSyncProvider["refreshTokens"]>;

export type HostedProviderTokenRefreshResult =
  | { status: "success"; tokens: Awaited<ReturnType<ProviderTokenRefresh>> }
  | { status: "error"; error: unknown };

export async function refreshProviderTokensWithStatusHandling(input: {
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
  account: HostedStoredDeviceSyncAccount;
  currentTokenBundle: HostedStoredTokenBundle;
  provider: DeviceSyncProvider;
  now: string;
  userId: string;
}): Promise<HostedProviderTokenRefreshResult> {
  try {
    const refreshTokens = input.provider.connectionHandler?.refreshTokens ?? input.provider.refreshTokens;

    if (!refreshTokens) {
      throw new Error(`Device sync provider ${input.provider.provider} does not support token refresh.`);
    }

    return {
      status: "success",
      tokens: await refreshTokens(input.account),
    };
  } catch (error) {
    if (isDeviceSyncError(error) && error.accountStatus) {
      const sanitizedErrorCode = sanitizeHostedRuntimeErrorCode(error.code) ?? "TOKEN_REFRESH_FAILED";
      const sanitizedErrorMessage =
        sanitizeHostedRuntimeErrorText(error.message) ?? "Token refresh failed.";
      const seedAccount: PublicDeviceSyncAccount = {
        ...input.account,
        lastErrorCode: sanitizedErrorCode,
        lastErrorMessage: sanitizedErrorMessage,
        lastSyncErrorAt: input.now,
        nextReconcileAt: error.accountStatus === "disconnected" ? null : input.account.nextReconcileAt,
        status: error.accountStatus,
      };

      await input.store.createSignal({
        userId: input.userId,
        connectionId: input.account.id,
        provider: input.account.provider,
        kind: error.accountStatus === "disconnected" ? "disconnected" : "reauthorization_required",
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
      await input.store.persistStoredConnectionTokenBundle({
        connectionId: input.account.id,
        externalAccountId: input.account.externalAccountId,
        provider: input.account.provider,
        tokenBundle: error.accountStatus === "disconnected"
          ? null
          : { ...input.currentTokenBundle },
        tx: input.tx,
      });
    }

    return {
      status: "error",
      error,
    };
  }
}
