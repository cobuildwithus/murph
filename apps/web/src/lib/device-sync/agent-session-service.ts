import { Prisma } from "@prisma/client";
import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/public-ingress";

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
import { requireHostedExecutionControlClient } from "../hosted-execution/control";
import {
  composeHostedRuntimeDeviceSyncAccount,
  findHostedDeviceSyncRuntimeConnection,
  requireHostedDeviceSyncRuntimeTokenBundle,
} from "./internal-runtime";
import { requireHostedDeviceSyncProvider } from "./providers";
import {
  type HostedAgentSessionRecord,
  type HostedPrismaTransactionClient,
  type UpdateLocalHeartbeatInput,
  mapHostedPublicAccountRecord,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import { parseInteger, toIsoTimestamp, toJsonRecord } from "./shared";

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
    const tokenBundle = buildTokenExport(
      requireHostedDeviceSyncRuntimeTokenBundle({
        connectionId,
        runtimeConnection: findHostedDeviceSyncRuntimeConnection(
          await requireHostedExecutionControlClient().getDeviceSyncRuntimeSnapshot(session.userId, {
            connectionId,
            provider: connection.provider,
          }),
          connectionId,
        ),
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
      metadata: {
        exportedAt: now,
      },
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
      });

      if (!record) {
        throw deviceSyncError({
          code: "CONNECTION_NOT_FOUND",
          message: "Hosted device-sync connection was not found for the current agent user.",
          retryable: false,
          httpStatus: 404,
        });
      }

      const currentConnection = mapHostedPublicAccountRecord(record);
      const runtimeSnapshot = await requireHostedExecutionControlClient().getDeviceSyncRuntimeSnapshot(
        session.userId,
        {
          connectionId,
          provider: currentConnection.provider,
        },
      );
      const runtimeConnection = findHostedDeviceSyncRuntimeConnection(runtimeSnapshot, connectionId);
      const currentTokenBundle = requireHostedDeviceSyncRuntimeTokenBundle({
        connectionId,
        runtimeConnection,
        userId: session.userId,
      });

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
          metadata: {
            expectedTokenVersion: options.expectedTokenVersion,
            exportedAt: now,
            refreshed: false,
            tokenVersionChanged: true,
          },
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
          metadata: {
            exportedAt: now,
            refreshed: false,
            tokenVersionChanged: false,
            force: forceRefresh,
          },
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
        account: composeHostedRuntimeDeviceSyncAccount({
          connection: currentConnection,
          tokenBundle: currentTokenBundle,
        }),
        provider,
        now,
        userId: session.userId,
      });

      if (refreshResult.status === "error") {
        return refreshResult;
      }

      const nextTokens = refreshResult.tokens;
      const nextRefreshToken = nextTokens.refreshToken ?? currentTokenBundle.refreshToken;
      const updatedConnection = await tx.deviceConnection.update({
        where: {
          id: connectionId,
        },
        data: {
          status: "active",
          accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ? new Date(nextTokens.accessTokenExpiresAt) : null,
          lastSyncErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      await requireHostedExecutionControlClient().applyDeviceSyncRuntimeUpdates(session.userId, {
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
            observedUpdatedAt: runtimeConnection?.connection.updatedAt ?? runtimeConnection?.connection.createdAt ?? null,
            tokenBundle: {
              accessToken: nextTokens.accessToken,
              accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ?? null,
              keyVersion: currentTokenBundle.keyVersion,
              refreshToken: nextRefreshToken ?? null,
              tokenVersion: currentTokenBundle.tokenVersion,
            },
          },
        ],
      });
      const refreshedSnapshot = await requireHostedExecutionControlClient().getDeviceSyncRuntimeSnapshot(
        session.userId,
        {
          connectionId,
          provider: updatedConnection.provider,
        },
      );
      const refreshedRuntimeConnection = findHostedDeviceSyncRuntimeConnection(refreshedSnapshot, connectionId);
      const refreshedTokenBundle = requireHostedDeviceSyncRuntimeTokenBundle({
        connectionId,
        runtimeConnection: refreshedRuntimeConnection,
        userId: session.userId,
      });
      assertHostedDeviceSyncRuntimeRefreshApplied({
        connectionId,
        expectedTokenBundle: {
          accessToken: nextTokens.accessToken,
          accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ?? null,
          keyVersion: currentTokenBundle.keyVersion,
          refreshToken: nextRefreshToken ?? null,
        },
        refreshedTokenBundle,
      });
      const tokenVersionChanged = refreshedTokenBundle.tokenVersion !== currentTokenBundle.tokenVersion;
      const tokenBundle = buildTokenExport(refreshedTokenBundle, now);

      return {
        status: "success",
        connection: mapHostedPublicAccountRecord(updatedConnection),
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
        metadata: {
          exportedAt: now,
          force: forceRefresh,
        },
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
        metadata: {
          exportedAt: now,
          force: forceRefresh,
          refreshed: true,
          tokenVersionChanged: result.tokenVersionChanged,
        },
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
    patch: UpdateLocalHeartbeatInput,
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
    metadata?: Record<string, unknown> | null;
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
      metadata: input.metadata ?? null,
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
    account: DeviceSyncAccount;
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
        await input.tx.deviceConnection.update({
          where: {
            id: input.account.id,
          },
          data: {
            status: error.accountStatus,
            lastSyncErrorAt: new Date(input.now),
            lastErrorCode: error.code,
            lastErrorMessage: error.message,
          },
        });
        await input.tx.deviceSyncSignal.create({
          data: {
            userId: input.userId,
            connectionId: input.account.id,
            provider: input.account.provider,
            kind: error.accountStatus === "disconnected" ? "disconnected" : "reauthorization_required",
            payloadJson: toJsonRecord({
              reason: "token_refresh_failed",
              code: error.code,
              message: error.message,
            }) as Prisma.InputJsonObject,
            createdAt: new Date(input.now),
          },
        });
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

function assertHostedDeviceSyncRuntimeRefreshApplied(input: {
  connectionId: string;
  expectedTokenBundle: {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    keyVersion: string;
    refreshToken: string | null;
  };
  refreshedTokenBundle: {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    keyVersion: string;
    refreshToken: string | null;
  };
}): void {
  if (
    input.refreshedTokenBundle.accessToken === input.expectedTokenBundle.accessToken
    && input.refreshedTokenBundle.accessTokenExpiresAt === input.expectedTokenBundle.accessTokenExpiresAt
    && input.refreshedTokenBundle.keyVersion === input.expectedTokenBundle.keyVersion
    && input.refreshedTokenBundle.refreshToken === input.expectedTokenBundle.refreshToken
  ) {
    return;
  }

  throw deviceSyncError({
    code: "RUNTIME_STATE_CONFLICT",
    message: `Hosted device-sync runtime did not persist the refreshed token bundle for connection ${input.connectionId}.`,
    retryable: true,
    httpStatus: 409,
  });
}


function shouldRefreshHostedToken(accessTokenExpiresAt: string | null, now: string): boolean {
  if (!accessTokenExpiresAt) {
    return false;
  }

  return Date.parse(accessTokenExpiresAt) <= Date.parse(now) + TOKEN_REFRESH_LEEWAY_MS;
}
