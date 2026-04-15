import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/public-ingress";
import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";

import type {
  DeviceSyncAccount,
  DeviceSyncProvider,
  DeviceSyncRegistry,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import {
  HostedAgentSessionService,
  type HostedAgentSessionBearer,
  type HostedAgentUser,
} from "../hosted-agent-sessions";
import {
  buildHostedDeviceSyncRuntimeSeedFromPublicAccount,
  requireHostedDeviceSyncStoredTokenBundle,
} from "./internal-runtime";
import type { HostedLocalHeartbeatPatch } from "./local-heartbeat";
import { requireHostedDeviceSyncProvider } from "./providers";
import {
  type HostedAgentSessionRecord,
  type HostedPrismaTransactionClient,
  type HostedStoredDeviceSyncAccount,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import { readHostedDeviceSyncRuntimeClientIfConfigured } from "./runtime-client";
import { parseInteger, toIsoTimestamp } from "./shared";

const HOSTED_DEVICE_SYNC_AGENT_PAIR_PATH = "/api/device-sync/agents/pair";
const TOKEN_REFRESH_LEEWAY_MS = 5 * 60_000;
const HOSTED_DEVICE_SYNC_AGENT_AUTH_MESSAGES = {
  required:
    "Hosted device-sync agent routes require a bearer token created by /api/device-sync/agents/pair.",
  expired:
    "Hosted device-sync agent bearer token expired. Pair again or keep using the latest bearer returned by export-token-bundle or refresh-token-bundle.",
  invalid: "Hosted device-sync agent bearer token is invalid or revoked.",
} as const;

export interface HostedTokenExport {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  tokenVersion: number;
  keyVersion: string;
  exportedAt: string;
}

type HostedProviderTokenRefreshResult =
  | { status: "success"; tokens: ProviderAuthTokens }
  | { status: "error"; error: unknown };

type HostedTokenRefreshLockResult =
  | {
      status: "success";
      connection: PublicDeviceSyncAccount;
      tokenBundle: HostedTokenExport;
      refreshed: boolean;
      tokenVersionChanged: boolean;
    }
  | {
      status: "error";
      error: unknown;
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

  async exportTokenBundle(session: HostedAgentSessionRecord, connectionId: string): Promise<{
    connection: PublicDeviceSyncAccount;
    tokenBundle: HostedTokenExport;
    agentSession: HostedAgentSessionBearer;
  }> {
    const now = toIsoTimestamp(new Date());
    const connection = await this.requireOwnedConnection(session.userId, connectionId);
    const storedAccount = await this.store.getStoredConnectionAccountForUser(session.userId, connectionId);
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

    return {
      connection,
      tokenBundle,
      agentSession: await this.rotateAgentSession(session, now),
    };
  }

  async refreshTokenBundle(
    session: HostedAgentSessionRecord,
    connectionId: string,
    options: { expectedTokenVersion?: number | null; force?: boolean } = {},
  ): Promise<{
    connection: PublicDeviceSyncAccount;
    tokenBundle: HostedTokenExport;
    refreshed: boolean;
    tokenVersionChanged: boolean;
    agentSession: HostedAgentSessionBearer;
  }> {
    const now = toIsoTimestamp(new Date());
    const forceRefresh = options.force === true;

    const result = await this.store.withConnectionRefreshLock<HostedTokenRefreshLockResult>(connectionId, async (tx) => {
      const record = await tx.deviceConnection.findFirst({
        where: {
          id: connectionId,
          userId: session.userId,
        },
        select: {
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
      const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
        connectionId,
        storedTokenBundle: buildStoredTokenBundle(currentAccount),
        userId: session.userId,
      });

      if (!currentAccount) {
        throw deviceSyncError({
          code: "CONNECTION_SECRET_MISSING",
          message: "Hosted device-sync connection no longer has a stored token bundle.",
          retryable: false,
          httpStatus: 409,
        });
      }

      const currentConnection = currentAccount;

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
          connection: currentConnection,
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
          connection: currentConnection,
          tokenBundle,
          refreshed: false,
          tokenVersionChanged: false,
        };
      }

      const provider = requireHostedDeviceSyncProvider(this.registry, currentConnection.provider);
      const refreshResult = await this.refreshProviderTokensWithStatusHandling({
        tx,
        account: currentAccount,
        currentTokenBundle,
        provider,
        now,
        userId: session.userId,
      });

      if (refreshResult.status === "error") {
        return refreshResult;
      }

      const nextTokens = refreshResult.tokens;
      const nextRefreshToken = nextTokens.refreshToken ?? currentTokenBundle.refreshToken;
      const nextStoredTokenBundle = {
        accessToken: nextTokens.accessToken,
        accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ?? null,
        keyVersion: currentTokenBundle.keyVersion,
        refreshToken: nextRefreshToken ?? null,
        tokenVersion: currentTokenBundle.tokenVersion + 1,
      };
      const tokenVersionChanged = nextStoredTokenBundle.tokenVersion !== currentTokenBundle.tokenVersion;
      const tokenBundle = buildTokenExport(nextStoredTokenBundle, now);
      const nextConnection: PublicDeviceSyncAccount = {
        ...currentConnection,
        accessTokenExpiresAt: nextStoredTokenBundle.accessTokenExpiresAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncErrorAt: null,
        status: "active",
        updatedAt: now,
      };
      await this.store.syncDurableConnectionState(nextConnection, tx);
      await this.store.persistStoredConnectionTokenBundle({
        connectionId,
        externalAccountId: currentConnection.externalAccountId,
        provider: currentConnection.provider,
        tokenBundle: nextStoredTokenBundle,
        tx,
      });

      const runtimeClient = readHostedDeviceSyncRuntimeClientIfConfigured();

      if (runtimeClient) {
        try {
          await runtimeClient.applyDeviceSyncRuntimeUpdates(session.userId, {
            occurredAt: now,
            updates: [
              {
                connection: {
                  status: "active",
                },
                connectionId,
                localState: {
                  clearError: true,
                },
                observedTokenVersion: currentTokenBundle.tokenVersion,
                seed: buildHostedDeviceSyncRuntimeSeedFromPublicAccount({
                  account: nextConnection,
                  externalAccountId: currentConnection.externalAccountId,
                  localState: {
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    lastSyncErrorAt: null,
                  },
                  tokenBundle: nextStoredTokenBundle,
                }),
                tokenBundle: nextStoredTokenBundle,
              },
            ],
          });
        } catch (error) {
          console.warn(`Hosted device-sync runtime projection write failed for token refresh ${connectionId}.`, error);
        }
      }

      return {
        status: "success",
        connection: nextConnection,
        tokenBundle,
        refreshed: true,
        tokenVersionChanged,
      };
    });

    if (result.status === "error") {
      throw result.error;
    }

    if (result.refreshed) {
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: result.connection.provider,
        action: "token_refreshed",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: result.tokenBundle.tokenVersion,
        keyVersion: result.tokenBundle.keyVersion,
        createdAt: now,
        forceRefresh,
        refreshOutcome: "performed",
      });
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: result.connection.provider,
        action: "token_exported",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: result.tokenBundle.tokenVersion,
        keyVersion: result.tokenBundle.keyVersion,
        createdAt: now,
        forceRefresh,
        refreshOutcome: "performed",
        tokenVersionChanged: result.tokenVersionChanged,
      });
    }

    return {
      connection: result.connection,
      tokenBundle: result.tokenBundle,
      refreshed: result.refreshed,
      tokenVersionChanged: result.tokenVersionChanged,
      agentSession: await this.rotateAgentSession(session, now),
    };
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

  private async rotateAgentSession(session: HostedAgentSessionRecord, now: string): Promise<HostedAgentSessionBearer> {
    return this.agentSessions.rotateAgentSession(session, now);
  }

  private async refreshProviderTokensWithStatusHandling(input: {
    tx: HostedPrismaTransactionClient;
    account: HostedStoredDeviceSyncAccount;
    currentTokenBundle: {
      accessToken: string;
      accessTokenExpiresAt: string | null;
      keyVersion: string;
      refreshToken: string | null;
      tokenVersion: number;
    };
    provider: DeviceSyncProvider;
    now: string;
    userId: string;
  }): Promise<HostedProviderTokenRefreshResult> {
    try {
      return {
        status: "success",
        tokens: await input.provider.refreshTokens(input.account),
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

        await this.store.createSignal({
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
        await this.store.syncDurableConnectionState(seedAccount, input.tx);
        await this.store.persistStoredConnectionTokenBundle({
          connectionId: input.account.id,
          externalAccountId: input.account.externalAccountId,
          provider: input.account.provider,
          tokenBundle: error.accountStatus === "disconnected"
            ? null
            : { ...input.currentTokenBundle },
          tx: input.tx,
        });

        const runtimeClient = readHostedDeviceSyncRuntimeClientIfConfigured();

        if (runtimeClient) {
          try {
            await runtimeClient.applyDeviceSyncRuntimeUpdates(input.userId, {
              occurredAt: input.now,
              updates: [
                {
                  connection: {
                    status: error.accountStatus,
                  },
                  connectionId: input.account.id,
                  localState: {
                    lastErrorCode: sanitizedErrorCode,
                    lastErrorMessage: sanitizedErrorMessage,
                    lastSyncErrorAt: input.now,
                    ...(error.accountStatus === "disconnected" ? { nextReconcileAt: null } : {}),
                  },
                  observedTokenVersion: input.currentTokenBundle.tokenVersion,
                  seed: buildHostedDeviceSyncRuntimeSeedFromPublicAccount({
                    account: seedAccount,
                    externalAccountId: input.account.externalAccountId,
                    localState: {
                      lastErrorCode: sanitizedErrorCode,
                      lastErrorMessage: sanitizedErrorMessage,
                      lastSyncErrorAt: input.now,
                      ...(error.accountStatus === "disconnected" ? { nextReconcileAt: null } : {}),
                    },
                    tokenBundle: error.accountStatus === "disconnected"
                      ? null
                      : { ...input.currentTokenBundle },
                  }),
                  ...(error.accountStatus === "disconnected" ? { tokenBundle: null } : {}),
                },
              ],
            });
          } catch (runtimeError) {
            console.warn(`Hosted device-sync runtime projection write failed for ${input.account.id}.`, runtimeError);
          }
        }
      }

      return {
        status: "error",
        error,
      };
    }
  }
}

function buildTokenExport(
  tokenBundle: {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    keyVersion: string;
    refreshToken: string | null;
    tokenVersion: number;
  },
  exportedAt: string,
): HostedTokenExport {
  return {
    accessToken: tokenBundle.accessToken,
    refreshToken: tokenBundle.refreshToken ?? null,
    accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt ?? null,
    tokenVersion: tokenBundle.tokenVersion,
    keyVersion: tokenBundle.keyVersion,
    exportedAt,
  };
}

function buildStoredTokenBundle(
  account: HostedStoredDeviceSyncAccount | null,
): {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
} | null {
  if (!account) {
    return null;
  }

  return {
    accessToken: account.accessToken,
    accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
    keyVersion: account.keyVersion,
    refreshToken: account.refreshToken,
    tokenVersion: account.tokenVersion,
  };
}


function shouldRefreshHostedToken(accessTokenExpiresAt: string | null, now: string): boolean {
  if (!accessTokenExpiresAt) {
    return false;
  }

  return Date.parse(accessTokenExpiresAt) <= Date.parse(now) + TOKEN_REFRESH_LEEWAY_MS;
}
