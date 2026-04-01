import { PrismaClient } from "@prisma/client";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncAccountStatus,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceClaimResult,
  OAuthStateRecord,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "@murphai/device-syncd";
import type { HostedSecretCodec } from "./crypto";
import type { AuthenticatedHostedUser, HostedBrowserAssertionNonceStore } from "./auth";
import { PrismaHostedAgentSessionStore } from "./prisma-store/agent-sessions";
import { PrismaHostedBrowserAssertionNonceStore } from "./prisma-store/browser-assertion-nonces";
import { PrismaHostedConnectionStore } from "./prisma-store/connections";
import { PrismaHostedLocalHeartbeatStore } from "./prisma-store/local-heartbeats";
import { PrismaHostedOAuthSessionStore } from "./prisma-store/oauth-sessions";
import type {
  CreateHostedSignalInput,
  HostedAgentSessionAuthResult,
  HostedAgentSessionRecord,
  HostedConnectionSecretBundle,
  HostedPrismaTransactionClient,
  HostedSignalRecord,
  UpdateLocalHeartbeatInput,
} from "./prisma-store/types";
import { PrismaHostedSignalStore } from "./prisma-store/signals";
import { PrismaHostedWebhookTraceStore } from "./prisma-store/webhook-traces";

export {
  hostedConnectionWithSecretArgs,
  mapHostedInternalAccountRecord,
  mapHostedPublicAccountRecord,
  requireHostedConnectionBundleRecord,
  requireHostedPublicAccountRecord,
  type HostedConnectionWithSecretRecord,
} from "./prisma-store/connections";
export { generateHostedAgentBearerToken } from "./prisma-store/agent-sessions";
export type {
  CreateHostedSignalInput,
  HostedAgentSessionAuthResult,
  HostedAgentSessionAuthStatus,
  HostedAgentSessionRecord,
  HostedConnectionSecretBundle,
  HostedPrismaTransactionClient,
  HostedSignalRecord,
  UpdateLocalHeartbeatInput,
} from "./prisma-store/types";

export class PrismaDeviceSyncControlPlaneStore
  implements DeviceSyncPublicIngressStore, HostedBrowserAssertionNonceStore
{
  readonly prisma: PrismaClient;
  readonly codec: HostedSecretCodec;
  private readonly oauthSessions: PrismaHostedOAuthSessionStore;
  private readonly connections: PrismaHostedConnectionStore;
  private readonly webhookTraces: PrismaHostedWebhookTraceStore;
  private readonly signals: PrismaHostedSignalStore;
  private readonly browserAssertionNonces: PrismaHostedBrowserAssertionNonceStore;
  private readonly agentSessions: PrismaHostedAgentSessionStore;
  private readonly localHeartbeats: PrismaHostedLocalHeartbeatStore;

  constructor(input: { prisma: PrismaClient; codec: HostedSecretCodec }) {
    this.prisma = input.prisma;
    this.codec = input.codec;
    this.oauthSessions = new PrismaHostedOAuthSessionStore(this.prisma);
    this.connections = new PrismaHostedConnectionStore({
      prisma: this.prisma,
      codec: this.codec,
    });
    this.webhookTraces = new PrismaHostedWebhookTraceStore(this.prisma);
    this.signals = new PrismaHostedSignalStore(this.prisma);
    this.browserAssertionNonces = new PrismaHostedBrowserAssertionNonceStore(this.prisma);
    this.agentSessions = new PrismaHostedAgentSessionStore(this.prisma);
    this.localHeartbeats = new PrismaHostedLocalHeartbeatStore({
      prisma: this.prisma,
      connections: this.connections,
    });
  }

  async deleteExpiredOAuthStates(now: string): Promise<number> {
    return this.oauthSessions.deleteExpiredOAuthStates(now);
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    return this.oauthSessions.createOAuthState(input);
  }

  async consumeOAuthState(state: string, now: string): Promise<OAuthStateRecord | null> {
    return this.oauthSessions.consumeOAuthState(state, now);
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    return this.connections.upsertConnection(input);
  }

  async getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.connections.getConnectionByExternalAccount(provider, externalAccountId);
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    return this.webhookTraces.claimWebhookTrace(input);
  }

  async completeWebhookTrace(
    provider: string,
    traceId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<void> {
    return this.webhookTraces.completeWebhookTrace(provider, traceId, tx);
  }

  async releaseWebhookTrace(provider: string, traceId: string): Promise<void> {
    return this.webhookTraces.releaseWebhookTrace(provider, traceId);
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    return this.connections.markWebhookReceived(accountId, now);
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    return this.connections.listConnectionsForUser(userId);
  }

  async getConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    return this.connections.getConnectionForUser(userId, connectionId);
  }

  async getConnectionOwnerId(connectionId: string): Promise<string | null> {
    return this.connections.getConnectionOwnerId(connectionId);
  }

  async getConnectionBundleForUser(userId: string, connectionId: string): Promise<HostedConnectionSecretBundle | null> {
    return this.connections.getConnectionBundleForUser(userId, connectionId);
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    return this.signals.createSignal(input);
  }

  async listSignalsForUser(userId: string, options: { afterId?: number; limit?: number } = {}): Promise<HostedSignalRecord[]> {
    return this.signals.listSignalsForUser(userId, options);
  }

  async consumeBrowserAssertionNonce(input: {
    nonceHash: string;
    userId: string;
    method: string;
    path: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean> {
    return this.browserAssertionNonces.consumeBrowserAssertionNonce(input);
  }

  async createAgentSession(input: {
    user: AuthenticatedHostedUser;
    label?: string | null;
    tokenHash: string;
    now?: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    return this.agentSessions.createAgentSession(input);
  }

  async authenticateAgentSessionByTokenHash(tokenHash: string, now: string): Promise<HostedAgentSessionAuthResult> {
    return this.agentSessions.authenticateAgentSessionByTokenHash(tokenHash, now);
  }

  async rotateAgentSession(input: {
    sessionId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    return this.agentSessions.rotateAgentSession(input);
  }

  async revokeAgentSession(input: {
    sessionId: string;
    now: string;
    reason: string;
    replacedBySessionId?: string | null;
  }): Promise<HostedAgentSessionRecord | null> {
    return this.agentSessions.revokeAgentSession(input);
  }

  async markConnectionDisconnected(input: {
    connectionId: string;
    userId: string;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<PublicDeviceSyncAccount> {
    return this.connections.markConnectionDisconnected(input);
  }

  async updateConnectionStatus(input: {
    connectionId: string;
    status: DeviceSyncAccountStatus;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<PublicDeviceSyncAccount> {
    return this.connections.updateConnectionStatus(input);
  }

  async updateConnectionFromLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: UpdateLocalHeartbeatInput,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.localHeartbeats.updateConnectionFromLocalHeartbeat(userId, connectionId, patch);
  }

  async withConnectionRefreshLock<TResult>(
    connectionId: string,
    callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select pg_advisory_xact_lock(hashtext(${connectionId}))`;
      return callback(tx);
    });
  }
}
