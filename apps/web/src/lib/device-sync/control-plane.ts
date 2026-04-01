import type {
  PublicDeviceSyncAccount,
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
import type { HostedDeviceSyncWakeSource } from "./hosted-dispatch";
import {
  type HostedAgentSessionRecord,
  type UpdateLocalHeartbeatInput,
} from "./prisma-store";
import {
  HostedDeviceSyncAgentSessionService,
  type HostedAgentSessionBearer,
  type HostedTokenExport,
} from "./agent-session-service";
import { HostedDeviceSyncPublicIngressService } from "./public-ingress-service";
import {
  dispatchHostedDeviceSyncWake as dispatchHostedDeviceSyncWakeInternal,
} from "./wake-service";
import { HostedDeviceSyncWebhookAdminService } from "./webhook-admin-service";

export class HostedDeviceSyncControlPlane {
  readonly request: Request;
  readonly env: HostedDeviceSyncControlPlaneContext["env"];
  readonly registry: HostedDeviceSyncControlPlaneContext["registry"];
  readonly codec: HostedDeviceSyncControlPlaneContext["codec"];
  readonly store: HostedDeviceSyncControlPlaneContext["store"];
  readonly publicIngressBaseUrl: string;
  readonly webhookAdminCallbackBaseUrl: string;
  readonly webhookAdminCallbackBaseUrlSource:
    HostedDeviceSyncControlPlaneContext["webhookAdminCallbackBaseUrlSource"];
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
    this.codec = this.context.codec;
    this.store = this.context.store;
    this.publicIngressBaseUrl = this.context.publicIngressBaseUrl;
    this.webhookAdminCallbackBaseUrl = this.context.webhookAdminCallbackBaseUrl;
    this.webhookAdminCallbackBaseUrlSource = this.context.webhookAdminCallbackBaseUrlSource;
    this.allowedReturnOrigins = this.context.allowedReturnOrigins;
    this.agentSessions = new HostedDeviceSyncAgentSessionService({
      request,
      store: this.store,
      registry: this.registry,
      codec: this.codec,
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

  async ensureHostedWebhookAdminUpkeepForRuntimeSnapshot(input: {
    userId: string;
    provider?: string | null;
    connectionId?: string | null;
  }): Promise<void> {
    return this.webhookAdmin.ensureHostedWebhookAdminUpkeepForRuntimeSnapshot(input);
  }

  async getConnectionStatus(userId: string, publicConnectionId: string) {
    return this.connections.getConnectionStatus(userId, publicConnectionId);
  }

  async startConnection(userId: string, provider: string, returnTo: string | null) {
    return this.connections.startConnection(userId, provider, returnTo);
  }

  async handleOAuthCallback(provider: string) {
    return this.connections.handleOAuthCallback(provider);
  }

  async handleWebhook(provider: string) {
    return this.connections.handleWebhook(provider);
  }

  async disconnectConnection(userId: string, connectionId: string) {
    return this.connections.disconnectConnection(userId, connectionId);
  }

  async pairAgent(label: string | null): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    return this.agentSessions.createAgentSession(await this.requireAuthenticatedUser(), label);
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

  async revokeAgentSession(session: HostedAgentSessionRecord) {
    return this.agentSessions.revokeAgentSession(session);
  }

  async recordLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: UpdateLocalHeartbeatInput,
  ) {
    return this.agentSessions.recordLocalHeartbeat(userId, connectionId, patch);
  }

  toBrowserConnection(account: Parameters<HostedDeviceSyncPublicIngressService["toBrowserConnection"]>[0]) {
    return this.connections.toBrowserConnection(account);
  }

  createBrowserConnectionId(connectionId: string): string {
    return this.connections.createBrowserConnectionId(connectionId);
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
