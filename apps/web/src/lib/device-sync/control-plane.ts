import type {
  DeviceSyncRegistry,
  PublicProviderDescriptor,
} from "@murphai/device-syncd/types";

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
import type { HostedDeviceSyncPublicIngressService } from "./public-ingress-service";
import { createHostedBrowserConnectionId } from "./public-connection";
import { HostedDeviceSyncWebhookAdminService } from "./webhook-admin-service";

export class HostedDeviceSyncControlPlane {
  readonly request: Request;
  readonly env: HostedDeviceSyncControlPlaneContext["env"];
  readonly store: HostedDeviceSyncControlPlaneContext["store"];
  readonly publicIngressBaseUrl: string;
  readonly publicIngressBaseUrlSource:
    HostedDeviceSyncControlPlaneContext["publicIngressBaseUrlSource"];
  readonly allowedReturnOrigins: string[];
  readonly agentSessions: HostedDeviceSyncAgentSessionService;
  readonly webhookAdmin: HostedDeviceSyncWebhookAdminService;
  private readonly context: HostedDeviceSyncControlPlaneContext;
  private authenticatedUserPromise: Promise<AuthenticatedHostedUser> | null = null;
  private connectionsPromise: Promise<HostedDeviceSyncPublicIngressService> | null = null;
  private registryPromise: Promise<DeviceSyncRegistry> | null = null;

  constructor(request: Request) {
    this.request = request;
    this.context = createHostedDeviceSyncControlPlaneContext(request);
    this.env = this.context.env;
    this.store = this.context.store;
    this.publicIngressBaseUrl = this.context.publicIngressBaseUrl;
    this.publicIngressBaseUrlSource = this.context.publicIngressBaseUrlSource;
    this.allowedReturnOrigins = this.context.allowedReturnOrigins;
    this.agentSessions = new HostedDeviceSyncAgentSessionService({
      request,
      store: this.store,
    });
    this.webhookAdmin = new HostedDeviceSyncWebhookAdminService(this.context);
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

  async requireRegistry(): Promise<DeviceSyncRegistry> {
    if (!this.registryPromise) {
      this.registryPromise = import("./providers").then(({ createHostedDeviceSyncRegistry }) =>
        createHostedDeviceSyncRegistry(process.env)
      );
    }

    return this.registryPromise;
  }

  async describeProviders(): Promise<PublicProviderDescriptor[]> {
    return (await this.getConnections()).describeProviders();
  }

  async listConnections(userId: string) {
    return (await this.getConnections()).listConnections(userId);
  }

  async getConnectionStatus(userId: string, publicConnectionId: string) {
    return (await this.getConnections()).getConnectionStatus(userId, publicConnectionId);
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
    return (await this.getConnections()).startConnection(userId, provider, returnTo, options);
  }

  async handleOAuthCallback(provider: string, options: { expectedOwnerId?: string | null } = {}) {
    return this.handleConnectionCallback(provider, options);
  }

  async createSdkSignInSession(userId: string, provider: string) {
    return (await this.getConnections()).createSdkSignInSession(userId, provider);
  }

  async handleConnectionCallback(provider: string, options: { expectedOwnerId?: string | null } = {}) {
    return (await this.getConnections()).handleConnectionCallback(provider, options);
  }

  async readWebhookRawBody() {
    return (await this.getConnections()).readWebhookRawBody();
  }

  async handleWebhook(provider: string, rawBody?: Buffer) {
    return (await this.getConnections()).handleWebhook(provider, rawBody);
  }

  async resolveWebhookPreflight(provider: string, rawBody: Buffer) {
    return (await this.getConnections()).resolveWebhookPreflight(provider, rawBody);
  }

  async disconnectConnection(userId: string, connectionId: string) {
    return (await this.getConnections()).disconnectConnection(userId, connectionId);
  }

  createBrowserConnectionId(connectionId: string): string {
    return createHostedBrowserConnectionId(this.env.routingIndexKey, connectionId);
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

  private async getConnections(): Promise<HostedDeviceSyncPublicIngressService> {
    if (!this.connectionsPromise) {
      this.connectionsPromise = this.requireRegistry().then(async (registry) => {
        const { HostedDeviceSyncPublicIngressService } = await import("./public-ingress-service");
        return new HostedDeviceSyncPublicIngressService(this.context, this.webhookAdmin, registry);
      });
    }

    return this.connectionsPromise;
  }
}

export function createHostedDeviceSyncControlPlane(request: Request): HostedDeviceSyncControlPlane {
  return new HostedDeviceSyncControlPlane(request);
}
