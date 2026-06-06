import type {
  PublicProviderDescriptor,
} from "@murphai/device-syncd/public-ingress";

import {
  assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser,
  type AuthenticatedHostedUser,
} from "./auth";
import {
  createHostedDeviceSyncControlPlaneContext,
  type HostedDeviceSyncControlPlaneContext,
} from "./control-plane-context";
import type { HostedLocalHeartbeatPatch } from "./local-heartbeat";
import {
  type HostedAgentSessionRecord,
} from "./prisma-store";
import {
  HostedDeviceSyncAgentSessionService,
  type HostedTokenBundleExportResponse,
  type HostedTokenBundleRefreshResponse,
} from "./agent-session-service";
import { HostedDeviceSyncPublicIngressService } from "./public-ingress-service";
import { HostedDeviceSyncWebhookAdminService } from "./webhook-admin-service";

export class HostedDeviceSyncControlPlane {
  readonly request: Request;
  readonly env: HostedDeviceSyncControlPlaneContext["env"];
  readonly registry: HostedDeviceSyncControlPlaneContext["registry"];
  readonly store: HostedDeviceSyncControlPlaneContext["store"];
  readonly publicIngressBaseUrl: string;
  readonly publicIngressBaseUrlSource:
    HostedDeviceSyncControlPlaneContext["publicIngressBaseUrlSource"];
  readonly allowedReturnOrigins: string[];
  readonly agentSessions: HostedDeviceSyncAgentSessionService;
  readonly connections: HostedDeviceSyncPublicIngressService;
  readonly webhookAdmin: HostedDeviceSyncWebhookAdminService;
  private readonly context: HostedDeviceSyncControlPlaneContext;
  private authenticatedUserPromise: Promise<AuthenticatedHostedUser> | null = null;

  constructor(request: Request) {
    this.request = request;
    this.context = createHostedDeviceSyncControlPlaneContext(request);
    this.env = this.context.env;
    this.registry = this.context.registry;
    this.store = this.context.store;
    this.publicIngressBaseUrl = this.context.publicIngressBaseUrl;
    this.publicIngressBaseUrlSource = this.context.publicIngressBaseUrlSource;
    this.allowedReturnOrigins = this.context.allowedReturnOrigins;
    this.agentSessions = new HostedDeviceSyncAgentSessionService({
      request,
      store: this.store,
      registry: this.registry,
    });
    this.webhookAdmin = new HostedDeviceSyncWebhookAdminService(this.context);
    this.connections = new HostedDeviceSyncPublicIngressService(this.context, this.webhookAdmin);
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
    return this.connections.describeProviders();
  }

  async listConnections(userId: string) {
    return this.connections.listConnections(userId);
  }

  async getConnectionStatus(userId: string, publicConnectionId: string) {
    return this.connections.getConnectionStatus(userId, publicConnectionId);
  }

  async startConnection(
    userId: string,
    provider: string,
    returnTo: string | null,
    options: {
      sourceProviderSlug?: string | null;
      connectSourceId?: string | null;
      connectTarget?: string | null;
    } = {},
  ) {
    return this.connections.startConnection(userId, provider, returnTo, options);
  }

  async handleOAuthCallback(provider: string, options: { expectedOwnerId?: string | null } = {}) {
    return this.handleConnectionCallback(provider, options);
  }

  async handleConnectionCallback(provider: string, options: { expectedOwnerId?: string | null } = {}) {
    return this.connections.handleConnectionCallback(provider, options);
  }

  async readWebhookRawBody() {
    return this.connections.readWebhookRawBody();
  }

  async handleWebhook(provider: string, rawBody?: Buffer) {
    return this.connections.handleWebhook(provider, rawBody);
  }

  async disconnectConnection(userId: string, connectionId: string) {
    return this.connections.disconnectConnection(userId, connectionId);
  }

  async pairAgent(user: AuthenticatedHostedUser, label: string | null): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    return this.agentSessions.createAgentSession(user, label);
  }

  async requireAgentSession() {
    return this.agentSessions.requireAgentSession();
  }

  async exportTokenBundle(
    session: HostedAgentSessionRecord,
    connectionId: string,
  ): Promise<HostedTokenBundleExportResponse> {
    return this.agentSessions.exportTokenBundle(session, connectionId);
  }

  async refreshTokenBundle(
    session: HostedAgentSessionRecord,
    connectionId: string,
    options: { expectedTokenVersion?: number | null; force?: boolean } = {},
  ): Promise<HostedTokenBundleRefreshResponse> {
    return this.agentSessions.refreshTokenBundle(session, connectionId, options);
  }

  async revokeAgentSession(session: HostedAgentSessionRecord) {
    return this.agentSessions.revokeAgentSession(session);
  }

  async recordLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: HostedLocalHeartbeatPatch,
  ) {
    return this.agentSessions.recordLocalHeartbeat(userId, connectionId, patch);
  }
}

export function createHostedDeviceSyncControlPlane(request: Request): HostedDeviceSyncControlPlane {
  return new HostedDeviceSyncControlPlane(request);
}
