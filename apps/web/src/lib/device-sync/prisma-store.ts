import { PrismaClient, type Prisma } from "@prisma/client";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import { buildCommittedConnectionStartOAuthState } from "@murphai/device-syncd/types";
import type {
  ClaimDeviceSyncWebhookTraceInput,
  CommitPublicDeviceSyncConnectionStartInput,
  CommitPublicDeviceSyncSdkConnectionStartInput,
  ConsumeOAuthStateResult,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceClaimResult,
  MarkPublicDeviceSyncConnectionSetupFailedInput,
  MarkPublicDeviceSyncConnectionSetupFailedResult,
  OAuthStateRecord,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
  UpsertPublicDeviceSyncConnectionResult,
} from "@murphai/device-syncd/types";
import type { HostedExecutionDeviceSyncStagedDirtyAck } from "@murphai/device-syncd/hosted-runtime";
import type { HostedDeviceSyncSecretTestCodec } from "./prisma-store/connection-secrets";
import { isUniqueViolation } from "./prisma-store/prisma-errors";
import type { HostedLocalHeartbeatPatch } from "./local-heartbeat";
import { normalizeNullableString } from "./shared";
import type { AuthenticatedHostedUser, HostedBrowserAssertionNonceStore } from "./auth";
import { PrismaHostedAgentSessionStore } from "./prisma-store/agent-sessions";
import { PrismaHostedBrowserAssertionNonceStore } from "./prisma-store/browser-assertion-nonces";
import { PrismaHostedConnectionStore } from "./prisma-store/connections";
import { PrismaHostedLocalHeartbeatStore } from "./prisma-store/local-heartbeats";
import { PrismaHostedDirtyConnectionStore } from "./prisma-store/dirty-connections";
import type { CompanionHrvNightReceiptInspection } from "./prisma-store/dirty-connections";
import { PrismaHostedOAuthSessionStore } from "./prisma-store/oauth-sessions";
import {
  PrismaHostedConnectionSourceStore,
  type HostedDeviceConnectionSource,
  type ListHostedRuntimeSnapshotConnectionSourcesInput,
  type MarkHostedDeviceConnectionSourceDataReceivedInput,
  type MarkHostedDeviceConnectionSourcesDisconnectedInput,
  type UpsertHostedDeviceConnectionSourceInput,
} from "./prisma-store/sources";
import type {
  CreateHostedSignalInput,
  CreateHostedTokenAuditInput,
  HostedDeviceSyncDirtyConnectionAckRecord,
  HostedDeviceSyncDirtyConnectionRecord,
  HostedDeviceSyncDirtyResource,
  HostedDeviceSyncDueReconcileConnectionRecord,
  HostedConnectionRefreshLeaseClaimResult,
  HostedAgentSessionAuthResult,
  HostedAgentSessionRecord,
  HostedPrismaTransactionClient,
  HostedSignalRecord,
  HostedTokenAuditRecord,
  UpsertHostedDeviceSyncDirtyConnectionInput,
  UpsertHostedDeviceSyncDirtyConnectionResult,
} from "./prisma-store/types";
import { PrismaHostedSignalStore } from "./prisma-store/signals";
import { PrismaHostedTokenAuditStore } from "./prisma-store/token-audits";
import { PrismaHostedWebhookTraceStore } from "./prisma-store/webhook-traces";

export {
  hostedConnectionRecordArgs,
  mapHostedConnectionRecord,
  sanitizeHostedDeviceSyncConnectionMetadata,
  type HostedStoredDeviceSyncAccount,
  type HostedConnectionRecord,
} from "./prisma-store/connections";
export {
  HOSTED_AGENT_BEARER_TOKEN_PREFIX,
  generateHostedAgentBearerToken,
} from "./prisma-store/agent-sessions";
export {
  hostedConnectionSourceRecordArgs,
  mapHostedConnectionSourceRecord,
  type HostedConnectionSourceRecord,
  type HostedDeviceConnectionSource,
  type ListHostedRuntimeSnapshotConnectionSourcesInput,
  type MarkHostedDeviceConnectionSourceDataReceivedInput,
  type MarkHostedDeviceConnectionSourcesDisconnectedInput,
  type UpsertHostedDeviceConnectionSourceInput,
} from "./prisma-store/sources";
export type {
  CreateHostedSignalInput,
  CreateHostedTokenAuditInput,
  HostedDeviceSyncDirtyConnectionAckRecord,
  HostedDeviceSyncDirtyConnectionRecord,
  HostedDeviceSyncDueReconcileConnectionRecord,
  HostedDeviceSyncDirtyResource,
  HostedConnectionRefreshLeaseClaimResult,
  HostedAgentSessionAuthResult,
  HostedAgentSessionAuthStatus,
  HostedAgentSessionRecord,
  HostedPrismaTransactionClient,
  HostedSignalRecord,
  HostedTokenAuditRecord,
  UpsertHostedDeviceSyncDirtyConnectionInput,
  UpsertHostedDeviceSyncDirtyConnectionResult,
} from "./prisma-store/types";

export class PrismaDeviceSyncControlPlaneStore
  implements DeviceSyncPublicIngressStore, HostedBrowserAssertionNonceStore
{
  readonly prisma: PrismaClient;
  private readonly oauthSessions: PrismaHostedOAuthSessionStore;
  private readonly connections: PrismaHostedConnectionStore;
  private readonly webhookTraces: PrismaHostedWebhookTraceStore;
  private readonly signals: PrismaHostedSignalStore;
  private readonly dirtyConnections: PrismaHostedDirtyConnectionStore;
  private readonly sources: PrismaHostedConnectionSourceStore;
  private readonly browserAssertionNonces: PrismaHostedBrowserAssertionNonceStore;
  private readonly agentSessions: PrismaHostedAgentSessionStore;
  private readonly localHeartbeats: PrismaHostedLocalHeartbeatStore;
  private readonly tokenAudits: PrismaHostedTokenAuditStore;

  constructor(input: {
    prisma: PrismaClient;
    codec?: HostedDeviceSyncSecretTestCodec;
    providerAccountBlindIndexKey?: Buffer | null;
  }) {
    this.prisma = input.prisma;
    this.oauthSessions = new PrismaHostedOAuthSessionStore(this.prisma);
    this.connections = new PrismaHostedConnectionStore({
      codec: input.codec,
      prisma: this.prisma,
      providerAccountBlindIndexKey: input.providerAccountBlindIndexKey,
    });
    this.webhookTraces = new PrismaHostedWebhookTraceStore({
      prisma: this.prisma,
      providerAccountBlindIndexKey: input.providerAccountBlindIndexKey,
    });
    this.signals = new PrismaHostedSignalStore(this.prisma);
    this.dirtyConnections = new PrismaHostedDirtyConnectionStore(this.prisma);
    this.sources = new PrismaHostedConnectionSourceStore(this.prisma);
    this.browserAssertionNonces = new PrismaHostedBrowserAssertionNonceStore(this.prisma);
    this.agentSessions = new PrismaHostedAgentSessionStore(this.prisma);
    this.localHeartbeats = new PrismaHostedLocalHeartbeatStore({
      prisma: this.prisma,
      connections: this.connections,
    });
    this.tokenAudits = new PrismaHostedTokenAuditStore(this.prisma);
  }

  async deleteExpiredOAuthStates(now: string): Promise<number> {
    return this.oauthSessions.deleteExpiredOAuthStates(now);
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    return this.oauthSessions.createOAuthState(input);
  }

  async consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.oauthSessions.consumeOAuthState(state, now, expectedProvider, expectedOwnerId);
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    return this.connections.upsertConnection(input);
  }

  async stageConnectionStart(oauthState: OAuthStateRecord): Promise<void> {
    const ownerId = requireHostedConnectionStartOwnerId(oauthState.ownerId);
    await this.prisma.$transaction(async (tx) => {
      await lockActiveHostedConnectionStartOwnerTx(tx, ownerId);
      await this.oauthSessions.createOAuthState(
        { ...oauthState, ownerId },
        tx,
      );
    });
  }

  async commitConnectionStart(
    input: CommitPublicDeviceSyncConnectionStartInput,
  ): Promise<void> {
    try {
      await this.commitConnectionStartOnce(input);
    } catch (error) {
      if (!input.connectionSeed || !isUniqueViolation(error)) {
        throw error;
      }

      await this.commitConnectionStartOnce(input);
    }
  }

  private async commitConnectionStartOnce(
    input: CommitPublicDeviceSyncConnectionStartInput,
  ): Promise<void> {
    const ownerId = requireHostedConnectionStartOwnerId(input.oauthState.ownerId);
    const connectionSeed = input.connectionSeed ?? null;

    if (
      connectionSeed
      && normalizeNullableString(connectionSeed.ownerId) !== ownerId
    ) {
      throw deviceSyncError({
        code: "CONNECTION_OWNER_MISMATCH",
        message: "Device-sync connection seed and OAuth state owners must match.",
        retryable: false,
        httpStatus: 400,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await lockActiveHostedConnectionStartOwnerTx(tx, ownerId);

      const seededAccount = connectionSeed
        ? await this.connections.upsertConnectionTx(tx, connectionSeed)
        : null;
      const oauthState = buildCommittedConnectionStartOAuthState(
        { ...input.oauthState, ownerId },
        seededAccount,
      );

      const replaced = await this.oauthSessions.replaceStagedConnectionStartOAuthState(
        oauthState,
        tx,
      );
      if (!replaced) {
        throw deviceSyncError({
          code: "CONNECTION_START_STATE_MISSING",
          message: "The staged device-sync connection start is unavailable.",
          retryable: true,
          httpStatus: 409,
        });
      }
    });
  }

  async commitSdkConnectionStart(
    input: CommitPublicDeviceSyncSdkConnectionStartInput,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    try {
      return await this.commitSdkConnectionStartOnce(input);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      return this.commitSdkConnectionStartOnce(input);
    }
  }

  private async commitSdkConnectionStartOnce(
    input: CommitPublicDeviceSyncSdkConnectionStartInput,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    const ownerId = requireHostedConnectionStartOwnerId(input.connectionSeed.ownerId);

    return this.prisma.$transaction(async (tx) => {
      await lockActiveHostedConnectionStartOwnerTx(tx, ownerId);
      const persisted = await this.connections.upsertConnectionWithPreviousTx(
        tx,
        { ...input.connectionSeed, ownerId },
      );
      const consumed = await this.oauthSessions.consumeStagedConnectionStart({
        ownerId,
        provider: input.connectionSeed.provider,
        state: input.state,
      }, tx);
      if (!consumed) {
        throw deviceSyncError({
          code: "CONNECTION_START_STATE_MISSING",
          message: "The staged device-sync connection start is unavailable.",
          retryable: true,
          httpStatus: 409,
        });
      }
      return persisted;
    });
  }

  async upsertConnectionWithPrevious(
    input: UpsertPublicDeviceSyncConnectionInput,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    return this.connections.upsertConnectionWithPrevious(input);
  }

  async markConnectionSetupFailed(
    input: MarkPublicDeviceSyncConnectionSetupFailedInput,
  ): Promise<MarkPublicDeviceSyncConnectionSetupFailedResult> {
    return this.connections.markConnectionSetupFailed(input);
  }

  async getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.connections.getConnectionByExternalAccount(provider, externalAccountId);
  }

  async getConnectionById(accountId: string): Promise<PublicDeviceSyncAccount | null> {
    return this.connections.getConnectionById(accountId);
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    return this.webhookTraces.claimWebhookTrace(input);
  }

  async completeWebhookTrace(
    provider: string,
    traceId: string,
    claimToken: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    return this.webhookTraces.completeWebhookTrace(provider, traceId, claimToken, tx);
  }

  async releaseWebhookTrace(provider: string, traceId: string, claimToken: string): Promise<void> {
    return this.webhookTraces.releaseWebhookTrace(provider, traceId, claimToken);
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    return this.connections.markWebhookReceived(accountId, now);
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    return this.connections.listConnectionsForUser(userId);
  }

  async getConnectionForUser(
    userId: string,
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.connections.getConnectionForUser(userId, connectionId, tx);
  }

  async getStoredConnectionAccountForUser(
    userId: string,
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ) {
    return this.connections.getStoredConnectionAccountForUser(userId, connectionId, tx);
  }

  async getConnectionOwnerId(connectionId: string): Promise<string | null> {
    return this.connections.getConnectionOwnerId(connectionId);
  }

  async getConnectionRecordForUser(userId: string, connectionId: string) {
    return this.connections.getConnectionRecordForUser(userId, connectionId);
  }

  async syncDurableConnectionState(account: PublicDeviceSyncAccount, tx?: HostedPrismaTransactionClient): Promise<void> {
    return this.connections.syncDurableConnectionState(account, tx);
  }

  async persistStoredConnectionTokenBundle(input: {
    clearExternalAccountId?: boolean;
    connectionId: string;
    externalAccountId?: string | null;
    provider: string;
    clearRefreshLease?: boolean;
    refreshLeaseOwner?: string | null;
    tokenBundle: {
      accessToken: string;
      accessTokenExpiresAt: string | null;
      keyVersion: string;
      refreshToken: string | null;
      tokenVersion: number;
    } | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<void> {
    return this.connections.persistStoredConnectionTokenBundle(input);
  }

  async clearStoredProviderConfigCredential(input: {
    connectionId: string;
    externalAccountId: string;
    provider: string;
    providerConfigKey: string;
    tx?: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<boolean> {
    return this.connections.clearStoredProviderConfigCredential(input);
  }

  async claimConnectionRefreshLease(input: {
    connectionId: string;
    userId: string;
    tokenVersion: number;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedConnectionRefreshLeaseClaimResult> {
    return this.connections.claimConnectionRefreshLease(input);
  }

  async clearConnectionRefreshLease(input: {
    connectionId: string;
    leaseOwner: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<boolean> {
    return this.connections.clearConnectionRefreshLease(input);
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    return this.signals.createSignal(input);
  }

  async listRecentConnectionWebhookSignals(input: {
    userId: string;
    connectionIds: readonly string[];
    limit?: number;
  }): Promise<HostedSignalRecord[]> {
    return this.signals.listRecentConnectionWebhookSignals(input);
  }

  async upsertDirtyConnection(
    input: UpsertHostedDeviceSyncDirtyConnectionInput,
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    return this.dirtyConnections.upsertDirtyConnection(input);
  }

  async inspectCompanionHrvNightReceipt(input: {
    connectionIds: readonly string[];
    nightDate: string;
    now: string;
    resource: HostedDeviceSyncDirtyResource;
    userId: string;
  }): Promise<CompanionHrvNightReceiptInspection> {
    return this.dirtyConnections.inspectCompanionHrvNightReceipt(input);
  }

  async getDirtyConnection(input: {
    connectionId: string;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionRecord | null> {
    return this.dirtyConnections.getDirtyConnection(input);
  }

  async hasPendingDirtyConnection(
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    return this.dirtyConnections.hasPendingDirtyConnection(connectionId, tx);
  }

  async hasPendingDirtyConnectionForUser(
    userId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    return this.dirtyConnections.hasPendingDirtyConnectionForUser(userId, tx);
  }

  async listPendingDirtyConnectionsForUser(input: {
    limit: number;
    stagedDirtyAcks?: readonly HostedExecutionDeviceSyncStagedDirtyAck[];
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }) {
    return this.dirtyConnections.listPendingDirtyConnectionsForUser(input);
  }

  async listDueReconcileConnectionsForSweep(input: {
    dueAt: Date;
    limit: number;
    recoveryBucketStartedAt: Date;
  }): Promise<HostedDeviceSyncDueReconcileConnectionRecord[]> {
    return this.connections.listDueReconcileConnectionsForSweep(input);
  }

  async markDirtyConnectionProcessed(input: {
    connectionId: string;
    processedDirtyPayloadIds?: readonly string[];
    processedRevision: bigint;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionAckRecord | null> {
    return this.dirtyConnections.markDirtyConnectionProcessed(input);
  }

  async createTokenAudit(input: CreateHostedTokenAuditInput): Promise<HostedTokenAuditRecord> {
    return this.tokenAudits.createTokenAudit(input);
  }

  async upsertConnectionSource(
    input: UpsertHostedDeviceConnectionSourceInput,
  ): Promise<HostedDeviceConnectionSource> {
    return this.sources.upsertConnectionSource(input);
  }

  async markConnectionSourceDataReceived(
    input: MarkHostedDeviceConnectionSourceDataReceivedInput,
  ): Promise<number> {
    return this.sources.markConnectionSourceDataReceived(input);
  }

  async markConnectionSourcesDisconnected(
    input: MarkHostedDeviceConnectionSourcesDisconnectedInput,
  ): Promise<number> {
    return this.sources.markConnectionSourcesDisconnected(input);
  }

  async listConnectionSources(
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]> {
    return this.sources.listConnectionSources(connectionId, tx);
  }

  async listRuntimeSnapshotConnectionSources(
    input: ListHostedRuntimeSnapshotConnectionSourcesInput,
  ): Promise<HostedDeviceConnectionSource[]> {
    return this.sources.listRuntimeSnapshotConnectionSources(input);
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

  async touchAgentSession(input: {
    sessionId: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    return this.agentSessions.touchAgentSession(input);
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

  async updateConnectionFromLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: HostedLocalHeartbeatPatch,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.withConnectionMutationLock(
      connectionId,
      async (tx) => this.localHeartbeats.updateConnectionFromLocalHeartbeat(userId, connectionId, patch, tx),
    );
  }

  async withConnectionMutationLock<TResult>(
    connectionId: string,
    callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${connectionId}))`;
      return callback(tx);
    });
  }

}

function requireHostedConnectionStartOwnerId(ownerId: string | null | undefined): string {
  const normalizedOwnerId = normalizeNullableString(ownerId);

  if (!normalizedOwnerId) {
    throw deviceSyncError({
      code: "CONNECTION_OWNER_REQUIRED",
      message: "Hosted device-sync connections must be initiated by an authenticated Murph user.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return normalizedOwnerId;
}

async function lockActiveHostedConnectionStartOwnerTx(
  prisma: Prisma.TransactionClient,
  ownerId: string,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ active: boolean }>>`
    SELECT suspended_at IS NULL AS active
    FROM hosted_member
    WHERE id = ${ownerId}
    FOR UPDATE
  `;

  if (rows[0]?.active !== true) {
    throw deviceSyncError({
      code: "CONNECTION_OWNER_UNAVAILABLE",
      message: "Device sync connections are unavailable for this Murph account.",
      retryable: false,
      httpStatus: 403,
    });
  }
}
