import {
  createDeviceSyncPublicIngress,
  deviceSyncError,
  isDeviceSyncError,
  resolveOuraWebhookVerificationChallenge,
} from "@healthybob/device-syncd";

import type {
  BeginConnectionResult,
  CompleteConnectionResult,
  DeviceSyncProvider,
  HandleWebhookResult,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  ProviderAuthTokens,
} from "@healthybob/device-syncd";
import { getPrisma } from "../prisma";
import { assertBrowserMutationOrigin, requireAuthenticatedHostedUser } from "./auth";
import { createHostedSecretCodec } from "./crypto";
import { readHostedDeviceSyncEnvironment } from "./env";
import { createHostedDeviceSyncRegistry, requireHostedDeviceSyncProvider } from "./providers";
import {
  generateHostedAgentBearerToken,
  type HostedAgentSessionRecord,
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

export class HostedDeviceSyncControlPlane {
  readonly request: Request;
  readonly env = readHostedDeviceSyncEnvironment();
  readonly registry = createHostedDeviceSyncRegistry(this.env);
  readonly codec = createHostedSecretCodec({
    key: this.env.encryptionKey,
    keyVersion: this.env.encryptionKeyVersion,
  });
  readonly store = new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
    codec: this.codec,
  });
  readonly publicBaseUrl: string;
  readonly allowedReturnOrigins: string[];

  constructor(request: Request) {
    this.request = request;
    this.publicBaseUrl = resolveHostedPublicBaseUrl(request, this.env.publicBaseUrl);
    this.allowedReturnOrigins = resolveAllowedReturnOrigins(request, this.publicBaseUrl, this.env.allowedReturnOrigins);
  }

  requireAuthenticatedUser() {
    return requireAuthenticatedHostedUser(this.request, this.env);
  }

  assertBrowserMutationOrigin(): void {
    assertBrowserMutationOrigin(this.request, {
      ...this.env,
      allowedReturnOrigins: this.allowedReturnOrigins,
    });
  }

  describeProviders(): PublicProviderDescriptor[] {
    return this.createIngress().describeProviders();
  }

  async listConnections(userId: string) {
    return {
      providers: this.describeProviders(),
      connections: await this.store.listConnectionsForUser(userId),
    };
  }

  async getConnectionStatus(userId: string, connectionId: string) {
    const connection = await this.store.getConnectionForUser(userId, connectionId);

    if (!connection) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    return {
      connection,
    };
  }

  async startConnection(userId: string, provider: string, returnTo: string | null): Promise<BeginConnectionResult> {
    return this.createIngress().startConnection({
      provider,
      returnTo,
      ownerId: userId,
    });
  }

  async handleOAuthCallback(provider: string): Promise<CompleteConnectionResult> {
    const url = new URL(this.request.url);
    return this.createIngress().handleOAuthCallback({
      provider,
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      scope: url.searchParams.get("scope"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description"),
    });
  }

  resolveWebhookVerificationChallenge(provider: string): string | null {
    if (provider !== "oura") {
      return null;
    }

    return resolveOuraWebhookVerificationChallenge({
      url: new URL(this.request.url),
      verificationToken: this.env.ouraWebhookVerificationToken,
    });
  }

  async handleWebhook(provider: string): Promise<HandleWebhookResult> {
    const rawBody = Buffer.from(await this.request.arrayBuffer());
    return this.createIngress().handleWebhook(provider, this.request.headers, rawBody);
  }

  async disconnectConnection(userId: string, connectionId: string): Promise<{
    connection: PublicDeviceSyncAccount;
    warning?: { code: string; message: string };
  }> {
    const existing = await this.store.getConnectionForUser(userId, connectionId);

    if (!existing) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    const bundle = await this.store.getConnectionBundleForUser(userId, connectionId);
    let warning: { code: string; message: string } | undefined;

    if (bundle) {
      const provider = this.registry.get(bundle.account.provider);

      if (provider?.revokeAccess) {
        try {
          await provider.revokeAccess(bundle.account);
        } catch (error) {
          warning = {
            code: isDeviceSyncError(error) ? error.code : "PROVIDER_REVOKE_FAILED",
            message: error instanceof Error ? error.message : "Provider revoke request failed during disconnect.",
          };
        }
      }
    }

    const now = toIsoTimestamp(new Date());
    const connection = await this.store.markConnectionDisconnected({
      connectionId,
      userId,
      now,
      errorCode: null,
      errorMessage: null,
    });
    await this.store.createSignal({
      userId,
      connectionId,
      provider: connection.provider,
      kind: "disconnected",
      payload: warning
        ? {
            reason: "user_disconnect",
            revokeWarning: warning,
          }
        : {
            reason: "user_disconnect",
          },
      createdAt: now,
    });

    return {
      connection,
      ...(warning ? { warning } : {}),
    };
  }

  async pairAgent(userId: string, label: string | null): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    const user = this.requireAuthenticatedUser();

    if (user.id !== userId) {
      throw deviceSyncError({
        code: "AUTH_USER_MISMATCH",
        message: "Authenticated hosted user did not match the requested agent owner.",
        retryable: false,
        httpStatus: 403,
      });
    }

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

    return {
      connection: await this.requireOwnedConnection(session.userId, connectionId),
      tokenBundle: buildTokenExport(bundle, now),
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

    const result = await this.store.withConnectionRefreshLock(connectionId, async (tx) => {
      const record = await tx.deviceConnection.findFirst({
        where: {
          id: connectionId,
          userId: session.userId,
        },
        include: {
          secret: true,
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

      const bundle = requireHostedConnectionBundleRecord(record, this.codec);
      const currentConnection = mapHostedPublicAccountRecord(record);

      if (
        typeof options.expectedTokenVersion === "number" &&
        options.expectedTokenVersion > 0 &&
        bundle.tokenVersion !== options.expectedTokenVersion
      ) {
        return {
          connection: currentConnection,
          tokenBundle: buildTokenExport(bundle, now),
          refreshed: false,
          tokenVersionChanged: true,
        };
      }

      if (!options.force && !shouldRefreshHostedToken(bundle.account.accessTokenExpiresAt ?? null, now)) {
        return {
          connection: currentConnection,
          tokenBundle: buildTokenExport(bundle, now),
          refreshed: false,
          tokenVersionChanged: false,
        };
      }

      const provider = requireHostedDeviceSyncProvider(this.registry, bundle.account.provider);
      const nextTokens = await this.refreshProviderTokensWithStatusHandling({
        tx,
        provider,
        bundle,
        now,
      });
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
          accessTokenEncrypted: this.codec.encrypt(nextTokens.accessToken),
          refreshTokenEncrypted: nextRefreshToken ? this.codec.encrypt(nextRefreshToken) : null,
          tokenVersion: {
            increment: 1,
          },
          keyVersion: this.codec.keyVersion,
        },
      });

      return {
        connection: mapHostedPublicAccountRecord(updatedConnection),
        tokenBundle: {
          accessToken: nextTokens.accessToken,
          refreshToken: nextRefreshToken ?? null,
          accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ?? null,
          tokenVersion: updatedSecret.tokenVersion,
          keyVersion: updatedSecret.keyVersion,
          exportedAt: now,
        },
        refreshed: true,
        tokenVersionChanged: false,
      };
    });

    return {
      ...result,
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
    patch: {
      status?: "active" | "reauthorization_required" | "disconnected";
      lastSyncStartedAt?: string | null;
      lastSyncCompletedAt?: string | null;
      lastSyncErrorAt?: string | null;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
      nextReconcileAt?: string | null;
      clearError?: boolean;
    },
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

  private createIngress() {
    return createDeviceSyncPublicIngress({
      publicBaseUrl: this.publicBaseUrl,
      allowedReturnOrigins: this.allowedReturnOrigins,
      registry: this.registry,
      store: this.store,
      hooks: {
        onConnectionEstablished: async ({ account, connection, now }) => {
          const ownerId = await this.store.getConnectionOwnerId(account.id);

          if (!ownerId) {
            return;
          }

          await this.store.createSignal({
            userId: ownerId,
            connectionId: account.id,
            provider: account.provider,
            kind: "connected",
            payload: {
              initialJobs: connection.initialJobs ?? [],
              nextReconcileAt: connection.nextReconcileAt ?? null,
              scopes: account.scopes,
            },
            createdAt: now,
          });
        },
        onWebhookAccepted: async ({ account, webhook, now }) => {
          const ownerId = await this.store.getConnectionOwnerId(account.id);

          if (!ownerId) {
            return;
          }

          await this.store.createSignal({
            userId: ownerId,
            connectionId: account.id,
            provider: account.provider,
            kind: "webhook_hint",
            payload: {
              eventType: webhook.eventType,
              traceId: webhook.traceId ?? null,
              occurredAt: webhook.occurredAt ?? null,
              jobs: webhook.jobs,
              payload: webhook.payload ?? {},
            },
            createdAt: now,
          });
        },
      },
    });
  }

  private async refreshProviderTokensWithStatusHandling(input: {
    tx: any;
    provider: DeviceSyncProvider;
    bundle: ReturnType<typeof requireHostedConnectionBundleRecord>;
    now: string;
  }): Promise<ProviderAuthTokens> {
    try {
      return await input.provider.refreshTokens(input.bundle.account);
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
            }),
            createdAt: new Date(input.now),
          },
        });
      }

      throw error;
    }
  }
}

export function createHostedDeviceSyncControlPlane(request: Request): HostedDeviceSyncControlPlane {
  return new HostedDeviceSyncControlPlane(request);
}

function resolveHostedPublicBaseUrl(request: Request, configuredBaseUrl: string | null): string {
  return (configuredBaseUrl ?? `${new URL(request.url).origin}/api/device-sync`).replace(/\/+$/u, "");
}

function resolveAllowedReturnOrigins(request: Request, publicBaseUrl: string, configuredOrigins: readonly string[]): string[] {
  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = new URL(publicBaseUrl).origin;
  return [...new Set([requestOrigin, publicOrigin, ...configuredOrigins])];
}

function buildTokenExport(
  bundle: ReturnType<typeof requireHostedConnectionBundleRecord>,
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
