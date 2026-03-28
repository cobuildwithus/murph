import {
  createDeviceSyncPublicIngress,
  deviceSyncError,
} from "@murph/device-syncd";

import type {
  BeginConnectionResult,
  CompleteConnectionResult,
  DeviceSyncProvider,
  HandleWebhookResult,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
} from "@murph/device-syncd";
import { getPrisma } from "../prisma";
import {
  assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser,
  type AuthenticatedHostedUser,
} from "./auth";
import { createHostedSecretCodec } from "./crypto";
import type { HostedDeviceSyncWakeSource } from "./hosted-dispatch";
import { readHostedDeviceSyncEnvironment } from "./env";
import { createHostedDeviceSyncRegistry } from "./providers";
import {
  generateHostedAgentBearerToken,
  type HostedAgentSessionRecord,
  type UpdateLocalHeartbeatInput,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import { toIsoTimestamp } from "./shared";
import {
  dispatchHostedDeviceSyncWake as dispatchHostedDeviceSyncWakeInternal,
  disconnectHostedDeviceSyncConnection,
  handleHostedDeviceSyncConnectionEstablished,
  handleHostedDeviceSyncWebhookAccepted,
} from "./wake-service";
import {
  HostedDeviceSyncAgentSessionService,
  type HostedAgentSessionBearer,
  type HostedTokenExport,
} from "./agent-session-service";

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
  readonly agentSessions: HostedDeviceSyncAgentSessionService;
  private authenticatedUserPromise: Promise<AuthenticatedHostedUser> | null = null;

  constructor(request: Request) {
    this.request = request;
    this.publicBaseUrl = resolveHostedPublicBaseUrl(request, this.env.publicBaseUrl);
    this.allowedReturnOrigins = resolveAllowedReturnOrigins(request, this.publicBaseUrl, this.env.allowedReturnOrigins);
    this.agentSessions = new HostedDeviceSyncAgentSessionService({
      request,
      store: this.store,
      registry: this.registry,
      codec: this.codec,
    });
  }

  requireAuthenticatedUser(): Promise<AuthenticatedHostedUser> {
    if (!this.authenticatedUserPromise) {
      this.authenticatedUserPromise = requireAuthenticatedHostedUser(this.request, this.env, {
        nonceStore: this.store,
      });
    }

    return this.authenticatedUserPromise;
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

  async ensureHostedWebhookSubscriptionsForRuntimeSnapshot(input: {
    userId: string;
    provider?: string | null;
    connectionId?: string | null;
  }): Promise<void> {
    const providers = await this.resolveActiveWebhookAdminProviders(input.userId, input);

    for (const provider of providers) {
      await this.ensureHostedWebhookSubscriptions({
        bestEffort: false,
        provider,
      });
    }
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
    return this.registry.get(provider)?.webhookAdmin?.resolveVerificationChallenge?.({
      url: new URL(this.request.url),
      verificationToken: this.env.ouraWebhookVerificationToken,
    }) ?? null;
  }

  async handleWebhook(provider: string): Promise<HandleWebhookResult> {
    const rawBody = Buffer.from(await this.request.arrayBuffer());
    return this.createIngress().handleWebhook(provider, this.request.headers, rawBody);
  }

  async disconnectConnection(userId: string, connectionId: string): Promise<{
    connection: PublicDeviceSyncAccount;
    warning?: { code: string; message: string };
  }> {
    return disconnectHostedDeviceSyncConnection({
      connectionId,
      registry: this.registry,
      store: this.store,
      userId,
    });
  }

  async pairAgent(userId: string, label: string | null): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    const user = await this.requireAuthenticatedUser();

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
    return this.agentSessions.requireAgentSession();
  }

  async listSignals(agentUserId: string, url: URL) {
    return this.agentSessions.listSignals(agentUserId, url);
  }

  async exportTokenBundle(session: HostedAgentSessionRecord, connectionId: string): Promise<{
    connection: PublicDeviceSyncAccount;
    tokenBundle: HostedTokenExport;
    agentSession: HostedAgentSessionBearer;
  }> {
    return this.agentSessions.exportTokenBundle(session, connectionId);
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
    return this.agentSessions.refreshTokenBundle(session, connectionId, options);
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
    return this.agentSessions.recordLocalHeartbeat(userId, connectionId, patch);
  }

  private async ensureHostedWebhookSubscriptions(input: {
    bestEffort: boolean;
    provider: DeviceSyncProvider;
  }): Promise<void> {
    const ensureSubscriptions = input.provider.webhookAdmin?.ensureSubscriptions;

    if (!ensureSubscriptions) {
      return;
    }

    const operation = ensureSubscriptions({
      publicBaseUrl: this.publicBaseUrl,
      verificationToken: this.env.ouraWebhookVerificationToken,
    });

    if (!input.bestEffort) {
      await operation;
      return;
    }

    try {
      await operation;
    } catch (error) {
      console.error("Failed to ensure hosted webhook subscriptions during connection setup.", {
        provider: input.provider.provider,
        error,
      });
    }
  }

  private async resolveActiveWebhookAdminProviders(
    userId: string,
    input: {
      provider?: string | null;
      connectionId?: string | null;
    },
  ): Promise<DeviceSyncProvider[]> {
    const providerNames = new Set<string>();

    if (input.connectionId) {
      const connection = await this.store.getConnectionForUser(userId, input.connectionId);

      if (
        connection
        && connection.status !== "disconnected"
        && (!input.provider || connection.provider === input.provider)
        && this.registry.get(connection.provider)?.webhookAdmin?.ensureSubscriptions
      ) {
        providerNames.add(connection.provider);
      }
    } else {
      const connections = await this.store.listConnectionsForUser(userId);

      for (const connection of connections) {
        if (connection.status === "disconnected") {
          continue;
        }

        if (input.provider && connection.provider !== input.provider) {
          continue;
        }

        if (this.registry.get(connection.provider)?.webhookAdmin?.ensureSubscriptions) {
          providerNames.add(connection.provider);
        }
      }
    }

    return [...providerNames]
      .map((providerName) => this.registry.get(providerName))
      .filter((provider): provider is DeviceSyncProvider => Boolean(provider));
  }

  private createIngress() {
    return createDeviceSyncPublicIngress({
      publicBaseUrl: this.publicBaseUrl,
      allowedReturnOrigins: this.allowedReturnOrigins,
      registry: this.registry,
      store: this.store,
      hooks: {
        onConnectionEstablished: async ({ account, connection, now, provider }) => {
          await handleHostedDeviceSyncConnectionEstablished({
            account,
            connection,
            now,
            store: this.store,
          });

          await this.ensureHostedWebhookSubscriptions({
            bestEffort: true,
            provider,
          });
        },
        onWebhookAccepted: async ({ account, webhook, now }) => {
          await handleHostedDeviceSyncWebhookAccepted({
            account,
            now,
            store: this.store,
            webhook,
          });
        },
      },
    });
  }
}

export function createHostedDeviceSyncControlPlane(request: Request): HostedDeviceSyncControlPlane {
  return new HostedDeviceSyncControlPlane(request);
}

export async function dispatchHostedDeviceSyncWake(input: {
  connectionId: string;
  occurredAt: string;
  provider: string;
  source: HostedDeviceSyncWakeSource;
  traceId?: string | null;
  userId: string;
}): Promise<{ dispatched: boolean; reason?: string }> {
  return dispatchHostedDeviceSyncWakeInternal(input);
}

function resolveHostedPublicBaseUrl(request: Request, configuredBaseUrl: string | null): string {
  return (configuredBaseUrl ?? `${new URL(request.url).origin}/api/device-sync`).replace(/\/+$/u, "");
}

function resolveAllowedReturnOrigins(request: Request, publicBaseUrl: string, configuredOrigins: readonly string[]): string[] {
  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = new URL(publicBaseUrl).origin;
  return [...new Set([requestOrigin, publicOrigin, ...configuredOrigins])];
}

function resolveHostedAgentSessionExpiry(now: string): string {
  return new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString();
}
