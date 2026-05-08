import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

import type {
  DeviceSyncRegistry,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import {
  HostedAgentSessionService,
  type HostedAgentUser,
} from "../hosted-agent-sessions";
import {
  requireHostedDeviceSyncStoredTokenBundle,
} from "./internal-runtime";
import type { HostedLocalHeartbeatPatch } from "./local-heartbeat";
import { requireHostedDeviceSyncProvider } from "./providers";
import {
  type HostedAgentSessionRecord,
  type HostedPrismaTransactionClient,
  type HostedStoredDeviceSyncAccount,
  PrismaDeviceSyncControlPlaneStore,
  sanitizeHostedDeviceSyncConnectionMetadata,
} from "./prisma-store";
import {
  buildStoredTokenBundle,
  buildTokenExport,
  type HostedStoredTokenBundle,
  type HostedTokenExport,
  shouldRefreshHostedToken,
} from "./agent-session-token-bundle";
import {
  persistProviderTokenRefreshErrorStatus,
  refreshProviderTokens,
} from "./agent-session-token-refresh";
import { parseInteger, toIsoTimestamp } from "./shared";

export type { HostedTokenExport } from "./agent-session-token-bundle";

export interface HostedTokenBundleExportResponse {
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedTokenExport;
}

export interface HostedTokenBundleRefreshResponse extends HostedTokenBundleExportResponse {
  refreshed: boolean;
  tokenVersionChanged: boolean;
}

const HOSTED_DEVICE_SYNC_AGENT_PAIR_PATH = "/api/device-sync/agents/pair";
const HOSTED_DEVICE_SYNC_AGENT_AUTH_MESSAGES = {
  required:
    "Hosted device-sync agent routes require a bearer token created by /api/device-sync/agents/pair.",
  expired: "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
  invalid: "Hosted device-sync agent bearer token is invalid or revoked.",
} as const;

type HostedTokenRefreshSuccess = {
  status: "success";
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedTokenExport;
  refreshed: boolean;
  tokenVersionChanged: boolean;
};

type HostedTokenRefreshLockResult =
  | HostedTokenRefreshSuccess
  | {
      status: "refresh_required";
      account: HostedStoredDeviceSyncAccount;
      currentTokenBundle: HostedStoredTokenBundle;
    };

export class HostedDeviceSyncAgentSessionService {
  readonly store: PrismaDeviceSyncControlPlaneStore;
  readonly registry: DeviceSyncRegistry;
  readonly agentSessions: HostedAgentSessionService;

  constructor(input: {
    request: Request;
    store: PrismaDeviceSyncControlPlaneStore;
    registry: DeviceSyncRegistry;
  }) {
    this.store = input.store;
    this.registry = input.registry;
    this.agentSessions = new HostedAgentSessionService({
      request: input.request,
      store: input.store,
      pairPath: HOSTED_DEVICE_SYNC_AGENT_PAIR_PATH,
      messages: HOSTED_DEVICE_SYNC_AGENT_AUTH_MESSAGES,
    });
  }

  async requireAgentSession() {
    return this.agentSessions.requireAgentSession();
  }

  async createAgentSession(
    user: HostedAgentUser,
    label: string | null,
  ): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    return this.agentSessions.createAgentSession(user, label);
  }

  async listSignals(agentUserId: string, url: URL) {
    const afterId = parseInteger(url.searchParams.get("after"));
    const limit = parseInteger(url.searchParams.get("limit")) ?? 100;
    const signals = await this.store.listSignalsForUser(agentUserId, {
      afterId: afterId ?? undefined,
      limit,
    });

    return {
      signals,
      nextCursor: signals.length > 0 ? signals[signals.length - 1].id : afterId,
    };
  }

  async exportTokenBundle(
    session: HostedAgentSessionRecord,
    connectionId: string,
  ): Promise<HostedTokenBundleExportResponse> {
    const now = toIsoTimestamp(new Date());
    const connection = await this.requireOwnedConnection(session.userId, connectionId);
    const storedAccount = await this.store.getStoredConnectionAccountForUser(session.userId, connectionId);
    if (!storedAccount) {
      const record = await this.store.getConnectionRecordForUser(session.userId, connectionId);
      throwIfHostedTokenBundleUnsupported(record, connectionId);
    } else {
      throwIfHostedTokenBundleUnsupported({
        credentialKind: storedAccount.credential.kind,
      }, connectionId);
    }

    const tokenBundle = buildTokenExport(
      requireHostedDeviceSyncStoredTokenBundle({
        connectionId,
        storedTokenBundle: buildStoredTokenBundle(storedAccount),
        userId: session.userId,
      }),
      now,
    );
    await this.recordTokenAudit({
      userId: session.userId,
      connectionId,
      provider: connection.provider,
      action: "token_exported",
      channel: "agent_export",
      sessionId: session.id,
      tokenVersion: tokenBundle.tokenVersion,
      keyVersion: tokenBundle.keyVersion,
      createdAt: now,
    });

    await this.assertCurrentAgentSessionStillActive();

    return {
      connection,
      tokenBundle,
    };
  }

  async refreshTokenBundle(
    session: HostedAgentSessionRecord,
    connectionId: string,
    options: { expectedTokenVersion?: number | null; force?: boolean } = {},
  ): Promise<HostedTokenBundleRefreshResponse> {
    const now = toIsoTimestamp(new Date());
    const forceRefresh = options.force === true;

    const result = await this.store.withConnectionMutationLock<HostedTokenRefreshLockResult>(connectionId, async (tx) => {
      const record = await tx.deviceConnection.findFirst({
        where: {
          id: connectionId,
          userId: session.userId,
        },
        select: {
          credentialKind: true,
          id: true,
        },
      });

      if (!record) {
        throw deviceSyncError({
          code: "CONNECTION_NOT_FOUND",
          message: "Hosted device-sync connection was not found for the current agent user.",
          retryable: false,
          httpStatus: 404,
        });
      }

      const currentAccount = await this.store.getStoredConnectionAccountForUser(session.userId, connectionId, tx);
      if (!currentAccount) {
        throwIfHostedTokenBundleUnsupported(record, connectionId);
        throw deviceSyncError({
          code: "CONNECTION_SECRET_MISSING",
          message: "Hosted device-sync connection no longer has a stored token bundle.",
          retryable: false,
          httpStatus: 409,
        });
      }
      throwIfHostedTokenBundleUnsupported({
        credentialKind: currentAccount.credential.kind,
      }, connectionId);

      const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
        connectionId,
        storedTokenBundle: buildStoredTokenBundle(currentAccount),
        userId: session.userId,
      });

      const currentConnection = currentAccount;
      const publicCurrentConnection = toPublicHostedDeviceSyncAccount(currentAccount);

      if (
        typeof options.expectedTokenVersion === "number" &&
        options.expectedTokenVersion > 0 &&
        currentTokenBundle.tokenVersion !== options.expectedTokenVersion
      ) {
        const tokenBundle = buildTokenExport(currentTokenBundle, now);
        await this.recordTokenAudit({
          userId: session.userId,
          connectionId,
          provider: currentConnection.provider,
          action: "token_exported",
          channel: "agent_refresh",
          sessionId: session.id,
          tokenVersion: tokenBundle.tokenVersion,
          keyVersion: tokenBundle.keyVersion,
          createdAt: now,
          expectedTokenVersion: options.expectedTokenVersion,
          refreshOutcome: "skipped_version_mismatch",
          tokenVersionChanged: true,
          tx,
        });

        return {
          status: "success",
          connection: publicCurrentConnection,
          tokenBundle,
          refreshed: false,
          tokenVersionChanged: true,
        };
      }

      if (!forceRefresh && !shouldRefreshHostedToken(currentTokenBundle.accessTokenExpiresAt ?? null, now)) {
        const tokenBundle = buildTokenExport(currentTokenBundle, now);
        await this.recordTokenAudit({
          userId: session.userId,
          connectionId,
          provider: currentConnection.provider,
          action: "token_exported",
          channel: "agent_refresh",
          sessionId: session.id,
          tokenVersion: tokenBundle.tokenVersion,
          keyVersion: tokenBundle.keyVersion,
          createdAt: now,
          forceRefresh,
          refreshOutcome: "skipped_fresh",
          tokenVersionChanged: false,
          tx,
        });

        return {
          status: "success",
          connection: publicCurrentConnection,
          tokenBundle,
          refreshed: false,
          tokenVersionChanged: false,
        };
      }

      return {
        status: "refresh_required",
        account: currentAccount,
        currentTokenBundle,
      };
    });

    const finalizedResult = result.status === "refresh_required"
      ? await this.refreshProviderTokensAndPersistIfCurrent({
        baseTokenBundle: result.currentTokenBundle,
        connectionId,
        forceRefresh,
        now,
        session,
      })
      : result;

    if (finalizedResult.refreshed) {
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: finalizedResult.connection.provider,
        action: "token_refreshed",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: finalizedResult.tokenBundle.tokenVersion,
        keyVersion: finalizedResult.tokenBundle.keyVersion,
        createdAt: now,
        forceRefresh,
        refreshOutcome: "performed",
      });
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: finalizedResult.connection.provider,
        action: "token_exported",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: finalizedResult.tokenBundle.tokenVersion,
        keyVersion: finalizedResult.tokenBundle.keyVersion,
        createdAt: now,
        forceRefresh,
        refreshOutcome: "performed",
        tokenVersionChanged: finalizedResult.tokenVersionChanged,
      });
    }

    await this.assertCurrentAgentSessionStillActive();

    return {
      connection: finalizedResult.connection,
      tokenBundle: finalizedResult.tokenBundle,
      refreshed: finalizedResult.refreshed,
      tokenVersionChanged: finalizedResult.tokenVersionChanged,
    };
  }

  private async resolveCurrentRefreshState(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    forceRefresh: boolean;
    now: string;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshLockResult> {
    return await this.store.withConnectionMutationLock<HostedTokenRefreshLockResult>(input.connectionId, async (tx) => {
      const currentAccount = await this.store.getStoredConnectionAccountForUser(
        input.session.userId,
        input.connectionId,
        tx,
      );
      if (!currentAccount) {
        throw deviceSyncError({
          code: "CONNECTION_SECRET_MISSING",
          message: "Hosted device-sync connection no longer has a stored token bundle.",
          retryable: false,
          httpStatus: 409,
        });
      }
      throwIfHostedTokenBundleUnsupported({
        credentialKind: currentAccount.credential.kind,
      }, input.connectionId);

      const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
        connectionId: input.connectionId,
        storedTokenBundle: buildStoredTokenBundle(currentAccount),
        userId: input.session.userId,
      });

      if (currentTokenBundle.tokenVersion !== input.baseTokenBundle.tokenVersion) {
        const tokenBundle = buildTokenExport(currentTokenBundle, input.now);
        await this.recordTokenAudit({
          userId: input.session.userId,
          connectionId: input.connectionId,
          provider: currentAccount.provider,
          action: "token_exported",
          channel: "agent_refresh",
          sessionId: input.session.id,
          tokenVersion: tokenBundle.tokenVersion,
          keyVersion: tokenBundle.keyVersion,
          createdAt: input.now,
          forceRefresh: input.forceRefresh,
          refreshOutcome: "skipped_version_mismatch",
          tokenVersionChanged: true,
          tx,
        });

        return {
          status: "success",
          connection: toPublicHostedDeviceSyncAccount(currentAccount),
          tokenBundle,
          refreshed: false,
          tokenVersionChanged: true,
        };
      }

      return {
        status: "refresh_required",
        account: currentAccount,
        currentTokenBundle,
      };
    });
  }

  private async refreshProviderTokensAndPersistIfCurrent(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    forceRefresh: boolean;
    now: string;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshSuccess> {
    return await this.store.withConnectionRefreshLock(input.connectionId, async () => {
      const currentRefreshState = await this.resolveCurrentRefreshState({
        baseTokenBundle: input.baseTokenBundle,
        connectionId: input.connectionId,
        forceRefresh: input.forceRefresh,
        now: input.now,
        session: input.session,
      });

      if (currentRefreshState.status === "success") {
        return currentRefreshState;
      }

      const provider = requireHostedDeviceSyncProvider(this.registry, currentRefreshState.account.provider);
      const refreshResult = await refreshProviderTokens({
        account: currentRefreshState.account,
        provider,
      });

      const persistedResult = await this.store.withConnectionMutationLock<
        HostedTokenRefreshSuccess | { status: "refresh_error"; error: unknown }
      >(input.connectionId, async (tx) => {
        const currentAccount = await this.store.getStoredConnectionAccountForUser(
          input.session.userId,
          input.connectionId,
          tx,
        );
        if (!currentAccount) {
          throw deviceSyncError({
            code: "CONNECTION_SECRET_MISSING",
            message: "Hosted device-sync connection no longer has a stored token bundle.",
            retryable: false,
            httpStatus: 409,
          });
        }
        throwIfHostedTokenBundleUnsupported({
          credentialKind: currentAccount.credential.kind,
        }, input.connectionId);
        const currentConnection = toPublicHostedDeviceSyncAccount(currentAccount);

        const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
          connectionId: input.connectionId,
          storedTokenBundle: buildStoredTokenBundle(currentAccount),
          userId: input.session.userId,
        });

        if (currentTokenBundle.tokenVersion !== input.baseTokenBundle.tokenVersion) {
          const tokenBundle = buildTokenExport(currentTokenBundle, input.now);
          await this.recordTokenAudit({
            userId: input.session.userId,
            connectionId: input.connectionId,
            provider: currentAccount.provider,
            action: "token_exported",
            channel: "agent_refresh",
            sessionId: input.session.id,
            tokenVersion: tokenBundle.tokenVersion,
            keyVersion: tokenBundle.keyVersion,
            createdAt: input.now,
            forceRefresh: input.forceRefresh,
            refreshOutcome: "skipped_version_mismatch",
            tokenVersionChanged: true,
            tx,
          });

          return {
            status: "success",
            connection: currentConnection,
            tokenBundle,
            refreshed: false,
            tokenVersionChanged: true,
          };
        }

        if (refreshResult.status === "error") {
          await persistProviderTokenRefreshErrorStatus({
            store: this.store,
            tx,
            account: currentAccount,
            currentTokenBundle,
            error: refreshResult.error,
            now: input.now,
            userId: input.session.userId,
          });

          return {
            status: "refresh_error",
            error: refreshResult.error,
          };
        }

        const nextTokens = refreshResult.tokens;
        const nextStoredTokenBundle = {
          accessToken: nextTokens.accessToken,
          accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ?? null,
          keyVersion: currentTokenBundle.keyVersion,
          refreshToken: nextTokens.refreshToken ?? null,
          tokenVersion: currentTokenBundle.tokenVersion + 1,
        };
        const tokenVersionChanged = nextStoredTokenBundle.tokenVersion !== currentTokenBundle.tokenVersion;
        const tokenBundle = buildTokenExport(nextStoredTokenBundle, input.now);
        const nextConnection: PublicDeviceSyncAccount = {
          ...currentConnection,
          accessTokenExpiresAt: nextStoredTokenBundle.accessTokenExpiresAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncErrorAt: null,
          status: "active",
          updatedAt: input.now,
        };
        await this.store.syncDurableConnectionState(nextConnection, tx);
        await this.store.persistStoredConnectionTokenBundle({
          connectionId: input.connectionId,
          externalAccountId: currentAccount.externalAccountId,
          provider: currentAccount.provider,
          tokenBundle: nextStoredTokenBundle,
          tx,
        });

        return {
          status: "success",
          connection: nextConnection,
          tokenBundle,
          refreshed: true,
          tokenVersionChanged,
        };
      });

      if (persistedResult.status === "refresh_error") {
        throw persistedResult.error;
      }

      return persistedResult;
    });
  }

  async revokeAgentSession(session: HostedAgentSessionRecord): Promise<{
    agentSession: {
      id: string;
      revokedAt: string;
      revokeReason: string | null;
    };
  }> {
    return this.agentSessions.revokeAgentSession(session);
  }

  async recordLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: HostedLocalHeartbeatPatch,
  ) {
    const connection = await this.store.updateConnectionFromLocalHeartbeat(userId, connectionId, patch);

    if (!connection) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current agent user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    return {
      connection,
    };
  }

  private async recordTokenAudit(input: {
    userId: string;
    connectionId: string;
    provider: string;
    action: "token_exported" | "token_refreshed";
    channel: "agent_export" | "agent_refresh";
    sessionId?: string | null;
    tokenVersion: number;
    keyVersion: string;
    createdAt: string;
    expectedTokenVersion?: number | null;
    forceRefresh?: boolean | null;
    refreshOutcome?: "performed" | "skipped_fresh" | "skipped_version_mismatch" | null;
    tokenVersionChanged?: boolean | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<void> {
    await this.store.createTokenAudit({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: input.provider,
      action: input.action,
      channel: input.channel,
      sessionId: input.sessionId ?? null,
      tokenVersion: input.tokenVersion,
      keyVersion: input.keyVersion,
      createdAt: input.createdAt,
      expectedTokenVersion: input.expectedTokenVersion ?? null,
      forceRefresh: input.forceRefresh ?? null,
      refreshOutcome: input.refreshOutcome ?? null,
      tokenVersionChanged: input.tokenVersionChanged ?? null,
      tx: input.tx,
    });
  }

  private async requireOwnedConnection(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount> {
    const connection = await this.store.getConnectionForUser(userId, connectionId);

    if (!connection) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    return connection;
  }

  private async assertCurrentAgentSessionStillActive(): Promise<void> {
    await this.agentSessions.requireAgentSession();
  }
}

function toPublicHostedDeviceSyncAccount(
  account: HostedStoredDeviceSyncAccount,
): PublicDeviceSyncAccount {
  const {
    accessToken: _accessToken,
    credential: _credential,
    disconnectGeneration: _disconnectGeneration,
    keyVersion: _keyVersion,
    metadata,
    refreshToken: _refreshToken,
    tokenVersion: _tokenVersion,
    userId: _userId,
    ...publicAccount
  } = account as HostedStoredDeviceSyncAccount & {
    accessToken?: unknown;
    disconnectGeneration?: unknown;
    refreshToken?: unknown;
    userId?: unknown;
  };

  return {
    ...publicAccount,
    metadata: sanitizeHostedDeviceSyncConnectionMetadata(metadata ?? {}),
  };
}

function throwIfHostedTokenBundleUnsupported(
  record: { credentialKind?: string | null } | null,
  connectionId: string,
): void {
  const credentialKind = record?.credentialKind;

  if (credentialKind !== "provider_config" && credentialKind !== "none") {
    return;
  }

  throw deviceSyncError({
    code: "OAUTH_TOKENS_REQUIRED",
    message: "This hosted device-sync connection does not use OAuth token credentials.",
    retryable: false,
    httpStatus: 409,
    details: {
      connectionId,
      credentialKind,
    },
  });
}
