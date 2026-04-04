import { Prisma } from "@prisma/client";
import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/public-ingress";

import type {
  DeviceSyncProvider,
  DeviceSyncRegistry,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import type { AuthenticatedHostedUser } from "./auth";
import {
  buildHostedConnectionTokenCipherOptions,
  type HostedSecretCodec,
} from "./crypto";
import { requireHostedDeviceSyncProvider } from "./providers";
import {
  generateHostedAgentBearerToken,
  hostedConnectionWithSecretArgs,
  type HostedAgentSessionRecord,
  type HostedConnectionSecretBundle,
  type HostedPrismaTransactionClient,
  type UpdateLocalHeartbeatInput,
  mapHostedPublicAccountRecord,
  PrismaDeviceSyncControlPlaneStore,
  requireHostedConnectionBundleRecord,
} from "./prisma-store";
import { parseInteger, sha256Hex, toIsoTimestamp, toJsonRecord } from "./shared";

const TOKEN_REFRESH_LEEWAY_MS = 5 * 60_000;
const HOSTED_AGENT_SESSION_TTL_MS = 24 * 60 * 60_000;

export interface HostedAgentSessionBearer {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  bearerToken: string;
}

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
  readonly request: Request;
  readonly store: PrismaDeviceSyncControlPlaneStore;
  readonly registry: DeviceSyncRegistry;
  readonly codec: HostedSecretCodec;

  constructor(input: {
    request: Request;
    store: PrismaDeviceSyncControlPlaneStore;
    registry: DeviceSyncRegistry;
    codec: HostedSecretCodec;
  }) {
    this.request = input.request;
    this.store = input.store;
    this.registry = input.registry;
    this.codec = input.codec;
  }

  async requireAgentSession() {
    const header = this.request.headers.get("authorization") ?? "";
    const [scheme, rawToken] = header.split(/\s+/u);

    if (scheme?.toLowerCase() !== "bearer" || !rawToken) {
      throw deviceSyncError({
        code: "AGENT_AUTH_REQUIRED",
        message: "Hosted device-sync agent routes require a bearer token created by /api/device-sync/agents/pair.",
        retryable: false,
        httpStatus: 401,
      });
    }

    const auth = await this.store.authenticateAgentSessionByTokenHash(sha256Hex(rawToken), toIsoTimestamp(new Date()));

    if (auth.status === "active" && auth.session) {
      return auth.session;
    }

    if (auth.status === "expired") {
      throw deviceSyncError({
        code: "AGENT_AUTH_EXPIRED",
        message:
          "Hosted device-sync agent bearer token expired. Pair again or keep using the latest bearer returned by export-token-bundle or refresh-token-bundle.",
        retryable: false,
        httpStatus: 401,
      });
    }

    if (auth.status === "revoked" || auth.status === "missing") {
      throw deviceSyncError({
        code: "AGENT_AUTH_INVALID",
        message: "Hosted device-sync agent bearer token is invalid or revoked.",
        retryable: false,
        httpStatus: 401,
      });
    }

    throw deviceSyncError({
      code: "AGENT_AUTH_INVALID",
      message: "Hosted device-sync agent bearer token is invalid or revoked.",
      retryable: false,
      httpStatus: 401,
    });
  }

  async createAgentSession(
    user: AuthenticatedHostedUser,
    label: string | null,
  ): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    const token = generateHostedAgentBearerToken();
    const now = toIsoTimestamp(new Date());
    const session = await this.store.createAgentSession({
      user,
      label,
      tokenHash: token.tokenHash,
      now,
      expiresAt: resolveHostedAgentSessionExpiry(now),
    });

    return {
      agent: {
        id: session.id,
        label: session.label,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
      token: token.token,
    };
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
    const bundle = await this.store.getConnectionBundleForUser(session.userId, connectionId);

    if (!bundle) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current agent user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    const now = toIsoTimestamp(new Date());
    const connection = await this.requireOwnedConnection(session.userId, connectionId);
    const tokenBundle = buildTokenExport(bundle, now);
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
        ...hostedConnectionWithSecretArgs,
      });

      if (!record) {
        throw deviceSyncError({
          code: "CONNECTION_NOT_FOUND",
          message: "Hosted device-sync connection was not found for the current agent user.",
          retryable: false,
          httpStatus: 404,
        });
      }

      const bundle = requireHostedConnectionBundleRecord(record, this.codec);
      const currentConnection = mapHostedPublicAccountRecord(record);

      if (
        typeof options.expectedTokenVersion === "number" &&
        options.expectedTokenVersion > 0 &&
        bundle.tokenVersion !== options.expectedTokenVersion
      ) {
        const tokenBundle = buildTokenExport(bundle, now);
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

      if (!forceRefresh && !shouldRefreshHostedToken(bundle.account.accessTokenExpiresAt ?? null, now)) {
        const tokenBundle = buildTokenExport(bundle, now);
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

      const provider = requireHostedDeviceSyncProvider(this.registry, bundle.account.provider);
      const refreshResult = await this.refreshProviderTokensWithStatusHandling({
        tx,
        provider,
        bundle,
        now,
      });

      if (refreshResult.status === "error") {
        return refreshResult;
      }

      const nextTokens = refreshResult.tokens;
      const nextRefreshToken = nextTokens.refreshToken ?? bundle.account.refreshToken;
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
      const updatedSecret = await tx.deviceConnectionSecret.update({
        where: {
          connectionId,
        },
        data: {
          accessTokenEncrypted: this.codec.encrypt(
            nextTokens.accessToken,
            buildHostedConnectionTokenCipherOptions({
              connectionId,
              provider: bundle.account.provider,
              purpose: "device-sync-access-token",
            }),
          ),
          refreshTokenEncrypted: nextRefreshToken
            ? this.codec.encrypt(
                nextRefreshToken,
                buildHostedConnectionTokenCipherOptions({
                  connectionId,
                  provider: bundle.account.provider,
                  purpose: "device-sync-refresh-token",
                }),
              )
            : null,
          tokenVersion: {
            increment: 1,
          },
          keyVersion: this.codec.keyVersion,
        },
      });
      const tokenBundle = {
        accessToken: nextTokens.accessToken,
        refreshToken: nextRefreshToken ?? null,
        accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ?? null,
        tokenVersion: updatedSecret.tokenVersion,
        keyVersion: updatedSecret.keyVersion,
        exportedAt: now,
      } satisfies HostedTokenExport;
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: updatedConnection.provider,
        action: "token_refreshed",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: tokenBundle.tokenVersion,
        keyVersion: tokenBundle.keyVersion,
        createdAt: now,
        metadata: {
          exportedAt: now,
          force: forceRefresh,
        },
        tx,
      });
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: updatedConnection.provider,
        action: "token_exported",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: tokenBundle.tokenVersion,
        keyVersion: tokenBundle.keyVersion,
        createdAt: now,
        metadata: {
          exportedAt: now,
          force: forceRefresh,
          refreshed: true,
          tokenVersionChanged: false,
        },
        tx,
      });

      return {
        status: "success",
        connection: mapHostedPublicAccountRecord(updatedConnection),
        tokenBundle,
        refreshed: true,
        tokenVersionChanged: false,
      };
    });

    if (result.status === "error") {
      throw result.error;
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
    const now = toIsoTimestamp(new Date());
    const revoked = await this.store.revokeAgentSession({
      sessionId: session.id,
      now,
      reason: "agent_request",
    });

    if (!revoked?.revokedAt) {
      throw deviceSyncError({
        code: "AGENT_AUTH_INVALID",
        message: "Hosted device-sync agent bearer token is invalid or revoked.",
        retryable: false,
        httpStatus: 401,
      });
    }

    return {
      agentSession: {
        id: revoked.id,
        revokedAt: revoked.revokedAt,
        revokeReason: revoked.revokeReason,
      },
    };
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
    const token = generateHostedAgentBearerToken();
    const rotated = await this.store.rotateAgentSession({
      sessionId: session.id,
      tokenHash: token.tokenHash,
      now,
      expiresAt: resolveHostedAgentSessionExpiry(now),
    });

    return {
      id: rotated.id,
      label: rotated.label,
      createdAt: rotated.createdAt,
      expiresAt: rotated.expiresAt,
      bearerToken: token.token,
    };
  }

  private async refreshProviderTokensWithStatusHandling(input: {
    tx: HostedPrismaTransactionClient;
    provider: DeviceSyncProvider;
    bundle: HostedConnectionSecretBundle;
    now: string;
  }): Promise<HostedProviderTokenRefreshResult> {
    try {
      return {
        status: "success",
        tokens: await input.provider.refreshTokens(input.bundle.account),
      };
    } catch (error) {
      if (isDeviceSyncError(error) && error.accountStatus) {
        await input.tx.deviceConnection.update({
          where: {
            id: input.bundle.account.id,
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
            userId: input.bundle.userId,
            connectionId: input.bundle.account.id,
            provider: input.bundle.account.provider,
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
  bundle: HostedConnectionSecretBundle,
  exportedAt: string,
): HostedTokenExport {
  return {
    accessToken: bundle.account.accessToken,
    refreshToken: bundle.account.refreshToken ?? null,
    accessTokenExpiresAt: bundle.account.accessTokenExpiresAt ?? null,
    tokenVersion: bundle.tokenVersion,
    keyVersion: bundle.keyVersion,
    exportedAt,
  };
}

function resolveHostedAgentSessionExpiry(now: string): string {
  return new Date(Date.parse(now) + HOSTED_AGENT_SESSION_TTL_MS).toISOString();
}

function shouldRefreshHostedToken(accessTokenExpiresAt: string | null, now: string): boolean {
  if (!accessTokenExpiresAt) {
    return false;
  }

  return Date.parse(accessTokenExpiresAt) <= Date.parse(now) + TOKEN_REFRESH_LEEWAY_MS;
}
