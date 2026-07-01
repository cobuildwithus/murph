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

export class HostedDeviceSyncControlPlane {
  readonly request: Request;
  readonly env: HostedDeviceSyncControlPlaneContext["env"];
  readonly store: HostedDeviceSyncControlPlaneContext["store"];
  readonly publicIngressBaseUrl: string;
  readonly publicIngressBaseUrlSource:
    HostedDeviceSyncControlPlaneContext["publicIngressBaseUrlSource"];
  readonly allowedReturnOrigins: string[];
  readonly agentSessions: HostedDeviceSyncAgentSessionService;
  private readonly context: HostedDeviceSyncControlPlaneContext;
  private authenticatedUserPromise: Promise<AuthenticatedHostedUser> | null = null;

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
