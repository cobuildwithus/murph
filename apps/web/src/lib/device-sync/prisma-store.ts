import { PrismaClient } from "@prisma/client";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import type { HostedExecutionDeviceSyncStagedDirtyAck } from "@murphai/device-syncd/hosted-runtime";
import type {
  ClaimDeviceSyncWebhookTraceInput,
  ClearPublicDeviceSyncOAuthCredentialInput,
  DeviceSyncAccount,
  ConsumeOAuthStateResult,
  DiscardUnconsumedOAuthStateResult,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceClaimResult,
  GetPublicDeviceSyncOAuthCleanupAccountInput,
  ListDeviceConnectionSourcesInput,
  MarkPublicDeviceSyncConnectionSetupFailedInput,
  MarkPublicDeviceSyncConnectionSetupFailedResult,
  OAuthStateRecord,
  OAuthStateConsumeClaim,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
  UpsertPublicDeviceSyncConnectionResult,
} from "@murphai/device-syncd/types";
import {
  lockHostedMemberRow,
  readHostedMemberSuspensionAfterLockTx,
} from "../hosted-onboarding/shared";
import { readHostedHealthDataConsentState } from "../legal/consent";
import type { AuthenticatedHostedUser, HostedBrowserAssertionNonceStore } from "./auth";
import type { HostedLocalHeartbeatPatch } from "./local-heartbeat";
import type {
  HostedDeviceSyncSecretTestCodec,
  HostedRuntimeConnectionSecretMaterial,
  HostedRuntimeApplyPreparedTokenWrite,
  HostedRuntimeApplyTokenWritePreparation,
} from "./prisma-store/connection-secrets";
import type { DeviceProviderApplicationBinding } from "./provider-applications/types";
import { PrismaHostedAgentSessionStore } from "./prisma-store/agent-sessions";
import { PrismaHostedBrowserAssertionNonceStore } from "./prisma-store/browser-assertion-nonces";
import {
  PrismaHostedConnectionStore,
  type HostedConnectionRecord,
  type HostedMemberDeviceConnectionStatus,
  type HostedStoredDeviceSyncAccount,
} from "./prisma-store/connections";
import { PrismaHostedLocalHeartbeatStore } from "./prisma-store/local-heartbeats";
import { PrismaHostedDirtyConnectionStore } from "./prisma-store/dirty-connections";
import type {
  CompanionHrvNightReceiptInspection,
  PreparedHostedDeviceSyncDirtyConnectionUpsert,
} from "./prisma-store/dirty-connections";
import { PrismaHostedOAuthSessionStore } from "./prisma-store/oauth-sessions";
import {
  PrismaHostedConnectionSourceStore,
  type HostedConnectionSourceAdmissionCandidate,
  type HostedDeviceConnectionSource,
  type ListHostedBoundedConnectionSourcesForConnectionsInput,
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
  hostedRuntimeRedactedConnectionRecordArgs,
  mapHostedConnectionRecord,
  mapHostedRuntimeRedactedConnectionRecord,
  sanitizeHostedDeviceSyncConnectionMetadata,
  type HostedStoredDeviceSyncAccount,
  type HostedConnectionRecord,
  type HostedMemberDeviceConnectionStatus,
  type HostedRuntimeConnectionRecord,
  type HostedRuntimeRedactedConnectionRecord,
} from "./prisma-store/connections";
export type {
  HostedRuntimeConnectionSecretMaterial,
  HostedRuntimeApplyPreparedTokenWrite,
  HostedRuntimeApplyTokenWritePreparation,
} from "./prisma-store/connection-secrets";
export {
  HOSTED_AGENT_BEARER_TOKEN_PREFIX,
  generateHostedAgentBearerToken,
} from "./prisma-store/agent-sessions";
export {
  HostedDeviceSyncDirtyPreparationMismatchError,
  hasHostedDeviceSyncDirtyResourcePayload,
  type PreparedHostedDeviceSyncDirtyConnectionUpsert,
} from "./prisma-store/dirty-connections";
export {
  hostedConnectionSourceRecordArgs,
  mapHostedConnectionSourceRecord,
  type HostedConnectionSourceRecord,
  type HostedConnectionSourceAdmissionCandidate,
  type HostedDeviceConnectionSource,
  type ListHostedBoundedConnectionSourcesForConnectionsInput,
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

  async deleteExpiredOAuthStates(): Promise<number> {
    return this.oauthSessions.deleteExpiredOAuthStates();
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    return this.oauthSessions.createOAuthState(input);
  }

  async createOAuthStateWithProviderApplication(
    input: OAuthStateRecord,
    binding: DeviceProviderApplicationBinding,
  ): Promise<OAuthStateRecord> {
    return this.oauthSessions.createOAuthStateWithProviderApplication(input, binding);
  }

  async readOAuthStateProviderApplicationBinding(input: {
    expectedOwnerId: string;
    expectedProvider: string;
    now: string;
    state: string;
  }): Promise<DeviceProviderApplicationBinding | null> {
    return this.oauthSessions.readOAuthStateProviderApplicationBinding(input);
  }

  async consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.oauthSessions.consumeOAuthState(state, now, expectedProvider, expectedOwnerId);
  }

  async resolveOAuthStateWithoutProviderAuthority(
    claim: OAuthStateConsumeClaim,
  ): Promise<boolean> {
    return this.oauthSessions.resolveOAuthStateWithoutProviderAuthority(claim);
  }

  async discardUnconsumedOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<DiscardUnconsumedOAuthStateResult> {
    return this.oauthSessions.discardUnconsumedOAuthState(
      state,
      now,
      expectedProvider,
      expectedOwnerId,
    );
  }

  async consumeOAuthStateWithProviderApplication(
    state: string,
    now: string,
    binding: DeviceProviderApplicationBinding,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.oauthSessions.consumeOAuthStateWithProviderApplication(
      state,
      now,
      binding,
      expectedProvider,
      expectedOwnerId,
    );
  }

  async discardUnconsumedOAuthStateWithProviderApplication(
    state: string,
    now: string,
    binding: DeviceProviderApplicationBinding,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<DiscardUnconsumedOAuthStateResult> {
    return this.oauthSessions.discardUnconsumedOAuthStateWithProviderApplication(
      state,
      now,
      binding,
      expectedProvider,
      expectedOwnerId,
    );
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    return this.connections.upsertConnection(input);
  }

  async upsertConnectionWithPrevious(
    input: UpsertPublicDeviceSyncConnectionInput,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    return this.connections.upsertConnectionWithPrevious(input);
  }

  async upsertConnectionWithProviderApplication(
    input: UpsertPublicDeviceSyncConnectionInput,
    binding: DeviceProviderApplicationBinding,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    return this.connections.upsertConnectionWithProviderApplication(input, binding);
  }

  async markConnectionSetupFailed(
    input: MarkPublicDeviceSyncConnectionSetupFailedInput,
  ): Promise<MarkPublicDeviceSyncConnectionSetupFailedResult> {
    return this.connections.markConnectionSetupFailed(input);
  }

  async clearOAuthCredentialAfterConfirmedRevoke(
    input: ClearPublicDeviceSyncOAuthCredentialInput,
  ): Promise<boolean> {
    return this.connections.clearOAuthCredentialAfterConfirmedRevoke(input);
  }

  async getOAuthCleanupAccount(
    input: GetPublicDeviceSyncOAuthCleanupAccountInput,
  ): Promise<DeviceSyncAccount | null> {
    return this.connections.getOAuthCleanupAccount(input);
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

  async markWebhookReceived(
    accountId: string,
    now: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<void> {
    return this.connections.markWebhookReceived(accountId, now, tx);
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    return this.connections.listConnectionsForUser(userId);
  }

  async listConnectionsRequiringCleanupForUser(
    userId: string,
  ): Promise<PublicDeviceSyncAccount[]> {
    return this.connections.listConnectionsRequiringCleanupForUser(userId);
  }

  async listMemberConnectionStatuses(input: {
    limit: number;
    provider: string;
    status: "active" | "not_disconnected";
    userId: string;
  }): Promise<HostedMemberDeviceConnectionStatus[]> {
    return this.connections.listMemberConnectionStatuses(input);
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

  async materializeDurableConnectionRecord(
    record: HostedConnectionRecord,
    tx?: HostedPrismaTransactionClient,
  ): Promise<PublicDeviceSyncAccount> {
    return this.connections.materializeDurableConnectionRecord(
      record,
      tx ?? this.prisma,
    );
  }

  async materializeStoredConnectionAccount(
    record: HostedConnectionRecord,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedStoredDeviceSyncAccount | null> {
    return this.connections.materializeStoredConnectionAccount(
      record,
      tx ?? this.prisma,
    );
  }

  async readRuntimeConnectionSecretMaterial(input: {
    records: readonly HostedConnectionRecord[];
    tokenConnectionIds: ReadonlySet<string>;
  }, tx?: HostedPrismaTransactionClient): Promise<
    Map<string, HostedRuntimeConnectionSecretMaterial>
  > {
    return this.connections.readRuntimeConnectionSecretMaterial(
      input,
      tx ?? this.prisma,
    );
  }

  async getConnectionOwnerId(connectionId: string): Promise<string | null> {
    return this.connections.getConnectionOwnerId(connectionId);
  }

  async getConnectionRecordForUser(
    userId: string,
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ) {
    return this.connections.getConnectionRecordForUser(userId, connectionId, tx);
  }

  async syncDurableConnectionState(
    account: PublicDeviceSyncAccount,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedConnectionRecord> {
    return this.connections.syncDurableConnectionState(account, tx);
  }

  async prepareRuntimeApplyTokenWrites(
    entries: readonly HostedRuntimeApplyTokenWritePreparation[],
  ): Promise<Map<string, HostedRuntimeApplyPreparedTokenWrite>> {
    return this.connections.prepareRuntimeApplyTokenWrites(entries);
  }

  async persistPreparedRuntimeApplyTokenWrite(input: {
    prepared: HostedRuntimeApplyPreparedTokenWrite;
    record: HostedConnectionRecord;
    tx: HostedPrismaTransactionClient;
  }): Promise<HostedConnectionRecord> {
    return this.connections.persistPreparedRuntimeApplyTokenWrite(input);
  }

  async persistStoredConnectionTokenBundle(input: {
    clearCredential?: boolean;
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

  async clearStaleConnectionRefreshLease(input: {
    connectionId: string;
    tx?: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<boolean> {
    return this.connections.clearStaleConnectionRefreshLease(input);
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    return this.signals.createSignal(input);
  }

  async listRecentConnectionWebhookSignals(input: {
    userId: string;
    connectionIds: readonly string[];
    sourceProviderSlug?: string | null;
    limit?: number;
  }): Promise<HostedSignalRecord[]> {
    return this.signals.listRecentConnectionWebhookSignals(input);
  }

  async upsertDirtyConnection(
    input: UpsertHostedDeviceSyncDirtyConnectionInput,
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    return this.dirtyConnections.upsertDirtyConnection(input);
  }

  async prepareDirtyConnectionUpsert(
    input: Omit<UpsertHostedDeviceSyncDirtyConnectionInput, "tx">,
  ): Promise<PreparedHostedDeviceSyncDirtyConnectionUpsert> {
    return this.dirtyConnections.prepareDirtyConnectionUpsert(input);
  }

  async upsertDirtyConnectionWithPreparedPlanTx(input: {
    prepared: PreparedHostedDeviceSyncDirtyConnectionUpsert;
    tx: HostedPrismaTransactionClient;
  }): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    return this.dirtyConnections.upsertDirtyConnectionWithPreparedPlanTx(input);
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

  async shouldRequestWakeForDirtyConnectionUpsert(input: {
    connectionId: string;
    tx: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<boolean> {
    return this.dirtyConnections.shouldRequestWakeForDirtyConnectionUpsert(input);
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
    input: ListDeviceConnectionSourcesInput,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]>;
  async listConnectionSources(
    input: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]>;
  async listConnectionSources(
    input: string | ListDeviceConnectionSourcesInput,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]> {
    const connectionId = typeof input === "string" ? input : input.connectionId;
    const sources = await this.sources.listConnectionSources(connectionId, tx);
    if (typeof input === "string") {
      return sources;
    }
    return sources.filter((source) =>
      (!input.sourceProviderSlug || source.sourceProviderSlug === input.sourceProviderSlug)
      && (!input.status || source.status === input.status)
    );
  }

  async listConnectionSourceAdmissionCandidates(input: {
    connectionId: string;
    sourceProviderSlug: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedConnectionSourceAdmissionCandidate[]> {
    return this.sources.listConnectionSourceAdmissionCandidates(input);
  }

  async listConnectionSourcesForConnections(
    connectionIds: readonly string[],
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]> {
    return this.sources.listConnectionSourcesForConnections(connectionIds, tx);
  }

  async listBoundedConnectionSourcesForConnections(
    input: ListHostedBoundedConnectionSourcesForConnectionsInput,
  ): Promise<HostedDeviceConnectionSource[]> {
    return this.sources.listBoundedConnectionSourcesForConnections(input);
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

  async withHealthDataAdmissionLock<TResult>(
    userId: string,
    connectionId: string,
    callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
    options: {
      /**
       * Bounds the member-row lock wait via a transaction-local
       * `lock_timeout`, which also covers the advisory-lock step in the same
       * transaction. Only callers whose failure is absorbed by an external
       * redelivery loop (webhook acceptance) should pass this: a bounded
       * waiter fails fast with a retryable error and the provider redelivers.
       * Journeys without redelivery (connection establishment, companion
       * ingestion, scheduled wakes) keep the full transaction budget.
       */
      memberRowLockTimeoutMs?: number;
      /**
       * Require the locked member lifetime to remain active before taking the
       * connection advisory lock. Refresh-lease admission uses this to
       * serialize with account-deletion suspension before provider work.
       */
      requireActiveMember?: boolean;
    } = {},
  ): Promise<TResult> {
    return this.prisma.$transaction(async (tx) => {
      // Member first is the repository-wide consent serialization order.
      // Connection state is locked only after withdrawal authority is current.
      await lockHostedMemberRow(
        tx,
        userId,
        options.memberRowLockTimeoutMs !== undefined
          ? { timeoutMs: options.memberRowLockTimeoutMs }
          : {},
      );
      if (options.requireActiveMember) {
        const ownerStatus = await readHostedMemberSuspensionAfterLockTx(
          tx,
          userId,
        );
        if (ownerStatus === "missing") {
          throw deviceSyncError({
            code: "CONNECTION_OWNER_REQUIRED",
            message: "Hosted device-sync connection owner no longer exists.",
            retryable: false,
            httpStatus: 404,
          });
        }
        if (ownerStatus === "suspended") {
          throw deviceSyncError({
            code: "CONNECTION_OWNER_SUSPENDED",
            message: "Device connections cannot refresh while account deletion is active.",
            retryable: false,
            httpStatus: 409,
          });
        }
      }
      if (await readHostedHealthDataConsentState({
        memberId: userId,
        prisma: tx,
      }) === "revoked") {
        throw deviceSyncError({
          code: "HEALTH_DATA_CONSENT_REQUIRED",
          httpStatus: 403,
          message: "Use Murph again before processing health data.",
          retryable: false,
        });
      }
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${connectionId}))`;
      return callback(tx);
    });
  }

}
