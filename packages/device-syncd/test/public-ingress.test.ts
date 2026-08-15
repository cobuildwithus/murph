import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { DeviceSyncError, deviceSyncError } from "../src/errors.ts";
import { DEVICE_CONNECT_SOURCES } from "../src/config/connect-routes.ts";
import { buildJunctionProviderSourceInstanceKey } from "../src/config/junction-connect-sources.ts";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { mergeGuardedJunctionHistoricalBackfillMetadata } from "../src/junction-historical-backfill-progress.ts";
import { createDeviceSyncPublicIngress } from "../src/public-ingress.ts";
import { createDeviceSyncRegistry } from "../src/registry.ts";
import { scopeWebhookTraceId, sha256Text } from "../src/shared.ts";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  ConsumeOAuthStateResult,
  DiscardUnconsumedOAuthStateResult,
  DeviceAccountCredential,
  DeviceConnectionHandler,
  DeviceJobExecutor,
  DeviceSyncAccount,
  DeviceSyncIngressWebhook,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncProvider,
  DeviceSyncPublicIngressConnectionEstablishedInput,
  DeviceSyncPublicIngressStore,
  DeviceSyncPublicIngressWebhookAcceptedInput,
  DeviceSyncPublicIngressWebhookAcceptedResult,
  DeviceSyncWebhookTraceRecord,
  DeviceWebhookHandler,
  OAuthStateRecord,
  PublicDeviceConnectionSource,
  ProviderAuthTokens,
  ProviderConnectionResult,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
  UpsertDeviceConnectionSourceInput,
  ListDeviceConnectionSourcesInput,
} from "../src/types.ts";
import {
  DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
  DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED,
  classifyDeviceSyncWebhookAcceptanceMode,
  getDeviceSyncAccountOAuthTokens,
} from "../src/types.ts";

class InMemoryPublicIngressStore implements DeviceSyncPublicIngressStore {
  private readonly oauthStates = new Map<string, OAuthStateRecord>();
  private readonly consumedOAuthStates = new Map<string, string>();
  private readonly accounts = new Map<string, PublicDeviceSyncAccount>();
  private readonly accountOwners = new Map<string, string>();
  private readonly accountCredentials = new Map<string, DeviceAccountCredential>();
  private readonly accountTokenVersions = new Map<string, number>();
  private readonly accountsByProviderExternal = new Map<string, string>();
  private readonly connectionSources = new Map<string, PublicDeviceConnectionSource>();
  private readonly webhookTraces = new Map<
    string,
    {
      claimToken: string;
      expiresAt: string | null;
      record: DeviceSyncWebhookTraceRecord;
      status: DeviceSyncWebhookTraceClaimResult | "stored";
    }
  >();
  lastRecordedWebhookTrace: DeviceSyncWebhookTraceRecord | null = null;
  lastWebhookTraceClaim: ClaimDeviceSyncWebhookTraceInput | null = null;
  claimWebhookTraceCalls = 0;
  completedWebhookTraceCalls = 0;
  markConnectionSetupFailedError: Error | null = null;
  lastCreatedOAuthState: OAuthStateRecord | null = null;
  upsertConnectionCalls = 0;
  private accountCounter = 0;

  deleteExpiredOAuthStates(now: string): number {
    let deleted = 0;

    for (const [state, record] of this.oauthStates.entries()) {
      if (
        !this.consumedOAuthStates.has(state)
        && Date.parse(record.expiresAt) <= Date.parse(now)
      ) {
        this.oauthStates.delete(state);
        this.consumedOAuthStates.delete(state);
        deleted += 1;
      }
    }

    return deleted;
  }

  createOAuthState(input: OAuthStateRecord): OAuthStateRecord {
    this.lastCreatedOAuthState = input;
    this.oauthStates.set(input.state, input);
    return input;
  }

  consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): ConsumeOAuthStateResult {
    const record = this.oauthStates.get(state) ?? null;

    const consumedAt = this.consumedOAuthStates.get(state) ?? null;
    if (!record || (consumedAt === null && Date.parse(record.expiresAt) <= Date.parse(now))) {
      this.oauthStates.delete(state);
      this.consumedOAuthStates.delete(state);
      return {
        status: "missing",
      };
    }

    if (expectedProvider && record.provider !== expectedProvider) {
      return {
        status: "provider_mismatch",
        provider: record.provider,
      };
    }

    if (expectedOwnerId && record.ownerId !== expectedOwnerId) {
      return {
        status: "owner_mismatch",
      };
    }

    if (consumedAt !== null) {
      const recoveryRequired = Date.parse(now) >= Math.max(
        Date.parse(record.expiresAt),
        Date.parse(consumedAt) + DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
      );
      return {
        status: recoveryRequired
          ? "recovery_required"
          : "replayed",
        consumedAt,
        record,
      };
    }

    this.consumedOAuthStates.set(state, now);
    return {
      status: "consumed",
      consumedAt: now,
      record,
    };
  }

  discardUnconsumedOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): DiscardUnconsumedOAuthStateResult {
    const record = this.oauthStates.get(state) ?? null;
    const consumedAt = this.consumedOAuthStates.get(state) ?? null;
    if (!record || (consumedAt === null && Date.parse(record.expiresAt) <= Date.parse(now))) {
      this.oauthStates.delete(state);
      this.consumedOAuthStates.delete(state);
      return { status: "missing" };
    }
    if (expectedProvider && record.provider !== expectedProvider) {
      return { status: "provider_mismatch", provider: record.provider };
    }
    if (expectedOwnerId && record.ownerId !== expectedOwnerId) {
      return { status: "owner_mismatch" };
    }
    if (consumedAt !== null) {
      const recoveryRequired = Date.parse(now) >= Math.max(
        Date.parse(record.expiresAt),
        Date.parse(consumedAt) + DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
      );
      return {
        status: recoveryRequired
          ? "recovery_required"
          : "replayed",
        consumedAt,
        record,
      };
    }
    this.oauthStates.delete(state);
    return { status: "discarded", record };
  }

  resolveOAuthStateWithoutProviderAuthority(input: {
    state: string;
    consumedAt: string;
  }): boolean {
    if (this.consumedOAuthStates.get(input.state) !== input.consumedAt) {
      return false;
    }
    this.oauthStates.delete(input.state);
    this.consumedOAuthStates.delete(input.state);
    return true;
  }

  /** Whether the state is still consumable (present and not yet consumed). */
  hasOAuthState(state: string): boolean {
    return this.oauthStates.has(state) && !this.consumedOAuthStates.has(state);
  }

  hasOAuthClaim(state: string): boolean {
    return this.oauthStates.has(state);
  }

  peekOAuthState(state: string): OAuthStateRecord | null {
    return this.oauthStates.get(state) ?? null;
  }

  upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount {
    this.upsertConnectionCalls += 1;
    const key = `${input.provider}:${input.externalAccountId}`;
    const existingId = this.accountsByProviderExternal.get(key) ?? null;
    const existing = existingId ? this.accounts.get(existingId) ?? null : null;
    assertExistingAccountGuard(existing, input.existingAccountGuard ?? null);
    const existingOwnerId = existing ? this.accountOwners.get(existing.id) ?? null : null;

    if (existingOwnerId && input.ownerId && existingOwnerId !== input.ownerId) {
      throw deviceSyncError({
        code: "CONNECTION_OWNERSHIP_CONFLICT",
        message: "This provider account is already connected to a different Murph user.",
        retryable: false,
        httpStatus: 409,
      });
    }

    if (
      input.existingAccountPolicy === "preserve_established"
      && existing
      && input.ownerId
      && existingOwnerId === input.ownerId
      && existing.status === "active"
      && existing.setupPhase === "source_confirmed"
    ) {
      this.requireOAuthClaimResolution(input);
      return existing;
    }

    const now = input.connectedAt;
    const id = existing?.id ?? `acct_${String(++this.accountCounter).padStart(2, "0")}`;
    const ownerId = input.ownerId ?? existingOwnerId;
    const tokens = readOAuthCredentialTokens(input);
    const setupPhase = Object.prototype.hasOwnProperty.call(input, "setupPhase")
      ? input.setupPhase ?? null
      : existing?.setupPhase ?? null;
    const setupExpiresAt = Object.prototype.hasOwnProperty.call(input, "setupExpiresAt")
      ? input.setupExpiresAt ?? null
      : existing?.setupExpiresAt ?? null;
    const metadata = existing && input.provider === "junction" && input.existingAccountGuard
      ? mergeGuardedJunctionHistoricalBackfillMetadata({
          existingMetadata: existing.metadata,
          replacementMetadata: input.metadata ?? {},
        })
      : input.metadata ?? {};

    const record: PublicDeviceSyncAccount = {
      id,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      displayName: input.displayName ?? null,
      status: input.status ?? existing?.status ?? "active",
      setupPhase,
      setupExpiresAt,
      scopes: [...(input.scopes ?? [])],
      accessTokenExpiresAt: tokens?.accessTokenExpiresAt ?? null,
      metadata: { ...metadata },
      connectedAt: input.connectedAt,
      lastWebhookAt: existing?.lastWebhookAt ?? null,
      lastSyncStartedAt: existing?.lastSyncStartedAt ?? null,
      lastSyncCompletedAt: existing?.lastSyncCompletedAt ?? null,
      lastSyncErrorAt: existing?.lastSyncErrorAt ?? null,
      lastErrorCode: existing?.lastErrorCode ?? null,
      lastErrorMessage: existing?.lastErrorMessage ?? null,
      nextReconcileAt: input.nextReconcileAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.accounts.set(id, record);
    this.accountCredentials.set(
      id,
      input.credential
        ?? (input.tokens ? { kind: "oauth_tokens", tokens: input.tokens } : { kind: "none" }),
    );
    if (tokens) {
      this.accountTokenVersions.set(
        id,
        (this.accountTokenVersions.get(id) ?? 0) + 1,
      );
    } else {
      this.accountTokenVersions.delete(id);
    }
    if (ownerId) {
      this.accountOwners.set(id, ownerId);
    }
    this.accountsByProviderExternal.set(key, id);
    this.requireOAuthClaimResolution(input);
    return record;
  }

  upsertConnectionWithPrevious(input: UpsertPublicDeviceSyncConnectionInput) {
    const previousAccount = this.getConnectionByExternalAccount(input.provider, input.externalAccountId);
    const account = this.upsertConnection(input);
    return { account, previousAccount };
  }

  markConnectionSetupFailed(input: {
    accountId: string;
    code: string;
    expectedConnectedAt: string | null;
    message: string;
    now: string;
    oauthClaim?: { state: string; consumedAt: string };
  }): {
    account: PublicDeviceSyncAccount | null;
    applied: boolean;
    blockedByRefreshLease: boolean;
    oauthTokenVersion: number | null;
  } {
    if (this.markConnectionSetupFailedError) {
      throw this.markConnectionSetupFailedError;
    }

    const existing = this.accounts.get(input.accountId) ?? null;
    if (!existing) {
      return {
        account: null,
        applied: false,
        blockedByRefreshLease: false,
        oauthTokenVersion: null,
      };
    }
    if (input.expectedConnectedAt === null || existing.connectedAt !== input.expectedConnectedAt) {
      return {
        account: existing,
        applied: false,
        blockedByRefreshLease: false,
        oauthTokenVersion: this.accountTokenVersions.get(existing.id) ?? null,
      };
    }

    const record: PublicDeviceSyncAccount = {
      ...existing,
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      lastSyncErrorAt: input.now,
      nextReconcileAt: null,
      setupPhase: "failed",
      setupExpiresAt: null,
      status: "reauthorization_required",
      updatedAt: input.now,
    };
    this.accounts.set(input.accountId, record);
    this.requireOAuthClaimResolution(input);
    return {
      account: record,
      applied: true,
      blockedByRefreshLease: false,
      oauthTokenVersion: this.accountTokenVersions.get(record.id) ?? null,
    };
  }

  getOAuthCleanupAccount(input: {
    accountId: string;
    expectedConnectedAt: string;
    expectedTokenVersion: number;
  }): DeviceSyncAccount | null {
    const account = this.accounts.get(input.accountId) ?? null;
    const credential = this.accountCredentials.get(input.accountId) ?? null;
    if (
      !account
      || account.connectedAt !== input.expectedConnectedAt
      || account.status !== "reauthorization_required"
      || account.setupPhase !== "failed"
      || credential?.kind !== "oauth_tokens"
      || this.accountTokenVersions.get(input.accountId) !== input.expectedTokenVersion
    ) {
      return null;
    }
    return {
      ...account,
      credential: {
        kind: "oauth_tokens",
        tokens: { ...credential.tokens },
      },
      disconnectGeneration: 0,
    };
  }

  clearOAuthCredentialAfterConfirmedRevoke(input: {
    accountId: string;
    expectedConnectedAt: string;
    expectedTokenVersion: number;
    now: string;
  }): boolean {
    const existing = this.accounts.get(input.accountId) ?? null;
    if (
      !existing
      || existing.connectedAt !== input.expectedConnectedAt
      || existing.status !== "reauthorization_required"
      || existing.setupPhase !== "failed"
      || this.accountTokenVersions.get(input.accountId) !== input.expectedTokenVersion
    ) {
      return false;
    }
    this.accounts.set(input.accountId, {
      ...existing,
      accessTokenExpiresAt: null,
      updatedAt: input.now,
    });
    this.accountCredentials.set(input.accountId, { kind: "none" });
    this.accountTokenVersions.delete(input.accountId);
    return true;
  }

  getConnectionCredential(accountId: string): DeviceAccountCredential | null {
    return this.accountCredentials.get(accountId) ?? null;
  }

  private requireOAuthClaimResolution(input: {
    oauthClaim?: { state: string; consumedAt: string };
  }): void {
    if (
      input.oauthClaim
      && !this.resolveOAuthStateWithoutProviderAuthority(input.oauthClaim)
    ) {
      throw new Error("OAuth claim changed before the in-memory outcome committed.");
    }
  }

  getConnectionByExternalAccount(provider: string, externalAccountId: string): PublicDeviceSyncAccount | null {
    const id = this.accountsByProviderExternal.get(`${provider}:${externalAccountId}`) ?? null;
    return id ? (this.accounts.get(id) ?? null) : null;
  }

  getConnectionById(accountId: string): PublicDeviceSyncAccount | null {
    return this.accounts.get(accountId) ?? null;
  }

  getConnectionOwnerId(accountId: string): string | null {
    return this.accountOwners.get(accountId) ?? null;
  }

  upsertConnectionSource(
    input: UpsertDeviceConnectionSourceInput,
  ): PublicDeviceConnectionSource {
    const key = `${input.connectionId}:${input.sourceInstanceKey}`;
    const existing = this.connectionSources.get(key) ?? null;
    const record: PublicDeviceConnectionSource = {
      id: existing?.id ?? `source_${this.connectionSources.size + 1}`,
      connectionId: input.connectionId,
      sourceInstanceKey: input.sourceInstanceKey,
      sourceProviderSlug: input.sourceProviderSlug,
      displayName: input.displayName ?? existing?.displayName ?? null,
      status: input.status,
      resourceAvailabilitySummary:
        input.resourceAvailabilitySummary ?? existing?.resourceAvailabilitySummary ?? {},
      lastErrorCode: input.lastErrorCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      firstSeenAt: input.firstSeenAt ?? existing?.firstSeenAt ?? input.lastSeenAt,
      lastSeenAt: input.lastSeenAt,
      lastDataAt: input.lastDataAt ?? existing?.lastDataAt ?? null,
      createdAt: existing?.createdAt ?? input.lastSeenAt,
      updatedAt: input.lastSeenAt,
    };
    this.connectionSources.set(key, record);
    return record;
  }

  listConnectionSources(
    input: ListDeviceConnectionSourcesInput,
  ): PublicDeviceConnectionSource[] {
    return [...this.connectionSources.values()].filter((source) =>
      source.connectionId === input.connectionId
      && (
        !input.sourceProviderSlug
        || source.sourceProviderSlug === input.sourceProviderSlug
      )
      && (!input.status || source.status === input.status)
    );
  }

  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult {
    this.claimWebhookTraceCalls += 1;
    this.lastWebhookTraceClaim = input;
    const key = `${input.provider}:${input.traceId}`;
    const existing = this.webhookTraces.get(key);

    if (!existing) {
      this.webhookTraces.set(key, {
        claimToken: input.claimToken,
        expiresAt: input.processingExpiresAt,
        record: {
          eventType: input.eventType,
          externalAccountId: input.externalAccountId,
          provider: input.provider,
          receivedAt: input.receivedAt,
          traceId: input.traceId,
        },
        status: "processing",
      });
      return "claimed";
    }

    if (existing.status === "stored") {
      return "processed";
    }

    if (existing.expiresAt && Date.parse(existing.expiresAt) > Date.parse(input.claimedAt)) {
      return "processing";
    }

    this.webhookTraces.set(key, {
      claimToken: input.claimToken,
      expiresAt: input.processingExpiresAt,
      record: {
        eventType: input.eventType,
        externalAccountId: input.externalAccountId,
        provider: input.provider,
        receivedAt: input.receivedAt,
        traceId: input.traceId,
      },
      status: "processing",
    });
    return "claimed";
  }

  completeWebhookTrace(provider: string, traceId: string, claimToken: string): boolean {
    this.completedWebhookTraceCalls += 1;
    const key = `${provider}:${traceId}`;
    const existing = this.webhookTraces.get(key);

    if (!existing || existing.status !== "processing" || existing.claimToken !== claimToken) {
      return false;
    }

    this.lastRecordedWebhookTrace = existing.record;
    this.webhookTraces.set(key, {
      claimToken: "",
      expiresAt: null,
      record: existing.record,
      status: "stored",
    });
    return true;
  }

  releaseWebhookTrace(provider: string, traceId: string, claimToken: string): void {
    const key = `${provider}:${traceId}`;
    const existing = this.webhookTraces.get(key);

    if (!existing || existing.status !== "processing" || existing.claimToken !== claimToken) {
      return;
    }

    this.webhookTraces.delete(key);
  }

  markWebhookReceived(accountId: string, now: string): void {
    const account = this.accounts.get(accountId);

    if (!account) {
      return;
    }

    this.accounts.set(accountId, {
      ...account,
      lastWebhookAt: now,
      updatedAt: now,
    });
  }

  readonly recordedSourceDataArrivals: { connectionId: string; sourceProviderSlug: string }[] = [];

  markConnectionSourceDataReceived(input: {
    connectionId: string;
    now: string;
    sourceProviderSlug: string;
  }): number {
    this.recordedSourceDataArrivals.push({
      connectionId: input.connectionId,
      sourceProviderSlug: input.sourceProviderSlug,
    });
    return 1;
  }

  patchAccountStatus(accountId: string, status: PublicDeviceSyncAccount["status"]): void {
    const account = this.accounts.get(accountId);

    if (!account) {
      return;
    }

    this.accounts.set(accountId, {
      ...account,
      status,
    });
  }
}

function createVoidDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function readOAuthCredentialTokens(input: UpsertPublicDeviceSyncConnectionInput): ProviderAuthTokens | null {
  if (input.credential) {
    return input.credential.kind === "oauth_tokens" ? input.credential.tokens : null;
  }

  return input.tokens ?? null;
}

function assertExistingAccountGuard(
  existing: PublicDeviceSyncAccount | null,
  guard: UpsertPublicDeviceSyncConnectionInput["existingAccountGuard"] | null,
): void {
  if (!guard) {
    return;
  }

  if (!existing || existing.id !== guard.expectedAccountId) {
    throw deviceSyncError({
      code: "CONNECTION_SEEDED_ACCOUNT_MISMATCH",
      message: "Device sync connection callback referenced an unexpected seeded account.",
      retryable: false,
      httpStatus: 400,
    });
  }

  if (guard.rejectIfDisconnected && existing.status === "disconnected") {
    throw deviceSyncError({
      code: "CONNECTION_ALREADY_DISCONNECTED",
      message: "Device sync connection callback was received after the seeded account was disconnected.",
      retryable: false,
      httpStatus: 409,
    });
  }

  if (existing.connectedAt !== guard.expectedConnectedAt) {
    throw deviceSyncError({
      code: "CONNECTION_SEEDED_ACCOUNT_CHANGED",
      message: "Device sync connection changed after this connection flow started.",
      retryable: false,
      httpStatus: 409,
    });
  }
}

function completeWebhookAcceptDurably(
  store: InMemoryPublicIngressStore,
  account: PublicDeviceSyncAccount,
  traceId: string,
  claimToken: string,
): DeviceSyncPublicIngressWebhookAcceptedResult {
  store.completeWebhookTrace(account.provider, traceId, claimToken);
  return DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED;
}

function requireCallback(callback: (() => void) | null, message: string): () => void {
  assert.ok(callback, message);
  return callback;
}

function readRecordedWebhookTrace(store: InMemoryPublicIngressStore): DeviceSyncWebhookTraceRecord | null {
  return store.lastRecordedWebhookTrace;
}

type FakeProviderOverrides = Partial<DeviceSyncProvider> & {
  beginConnection?: DeviceConnectionHandler["beginConnection"];
  completeConnection?: DeviceConnectionHandler["completeConnection"];
  buildConnectUrl?: (input: {
    state: string;
    callbackUrl: string;
    scopes: string[];
    now: string;
  }) => string;
  exchangeAuthorizationCode?: (
    context: Parameters<DeviceConnectionHandler["completeConnection"]>[0] extends infer _Input
      ? {
          callbackUrl: string;
          state: string;
          now: string;
          grantedScopes: string[];
        }
      : never,
    code: string,
  ) => Promise<ProviderConnectionResult>;
  refreshTokens?: DeviceConnectionHandler["refreshTokens"];
  revokeAccess?: DeviceConnectionHandler["revokeAccess"];
  createScheduledJobs?: DeviceJobExecutor["createScheduledJobs"];
  verifyAndParseWebhook?: (
    context: Parameters<NonNullable<DeviceWebhookHandler["verifyAndParseWebhook"]>>[0],
  ) => Promise<Omit<Awaited<ReturnType<NonNullable<DeviceWebhookHandler["verifyAndParseWebhook"]>>>, "acceptanceMode"> & {
    acceptanceMode?: "level_dirty_hint" | "durable_webhook_work";
  }>;
  executeJob?: DeviceJobExecutor["executeJob"];
};

function createFakeProvider(overrides: FakeProviderOverrides = {}): DeviceSyncProvider {
  const defaultBuildConnectUrl: NonNullable<FakeProviderOverrides["buildConnectUrl"]> = (context) =>
    `https://example.test/oauth?state=${context.state}&redirect_uri=${encodeURIComponent(context.callbackUrl)}`;
  const defaultExchangeAuthorizationCode: NonNullable<FakeProviderOverrides["exchangeAuthorizationCode"]> =
    async (_context, code) => ({
      externalAccountId: `demo-${code}`,
      displayName: `Demo ${code}`,
      scopes: ["offline", "read:data"],
      metadata: {
        connectedBy: code,
      },
      tokens: {
        accessToken: "<REDACTED_ACCESS_TOKEN>",
        refreshToken: "<REDACTED_REFRESH_TOKEN>",
      } satisfies ProviderAuthTokens,
      initialJobs: [
        {
          kind: "backfill",
          payload: {
            windowStart: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
      nextReconcileAt: "2026-03-24T00:00:00.000Z",
    });
  const defaultRefreshTokens: NonNullable<DeviceConnectionHandler["refreshTokens"]> = async () => ({
    accessToken: "<REDACTED_ACCESS_TOKEN_2>",
  });
  const defaultVerifyAndParseWebhook: DeviceWebhookHandler["verifyAndParseWebhook"] = async () => ({
    acceptanceMode: "durable_webhook_work",
    externalAccountId: "demo-abc",
    eventType: "demo.updated",
    traceId: "trace-1",
    jobs: [
      {
        kind: "resource",
        payload: {
          resourceId: "resource-1",
        },
      },
    ],
  });
  const defaultExecuteJob: DeviceJobExecutor["executeJob"] = async () => ({});
  const hasConnectionHandlerOverride = Object.hasOwn(overrides, "connectionHandler");
  const hasWebhookHandlerOverride = Object.hasOwn(overrides, "webhookHandler");
  const hasJobExecutorOverride = Object.hasOwn(overrides, "jobExecutor");
  const buildConnectUrl = Object.hasOwn(overrides, "buildConnectUrl")
    ? overrides.buildConnectUrl
    : defaultBuildConnectUrl;
  const exchangeAuthorizationCode = Object.hasOwn(overrides, "exchangeAuthorizationCode")
    ? overrides.exchangeAuthorizationCode
    : defaultExchangeAuthorizationCode;
  const refreshTokens = Object.hasOwn(overrides, "refreshTokens")
    ? overrides.refreshTokens
    : defaultRefreshTokens;
  const verifyAndParseWebhook = Object.hasOwn(overrides, "verifyAndParseWebhook")
    ? overrides.verifyAndParseWebhook
    : defaultVerifyAndParseWebhook;
  const executeJob = Object.hasOwn(overrides, "executeJob")
    ? overrides.executeJob
    : defaultExecuteJob;
  const createScheduledJobs = Object.hasOwn(overrides, "createScheduledJobs")
    ? overrides.createScheduledJobs
    : undefined;
  const {
    beginConnection,
    completeConnection,
    buildConnectUrl: _buildConnectUrl,
    exchangeAuthorizationCode: _exchangeAuthorizationCode,
    refreshTokens: _refreshTokens,
    revokeAccess,
    createScheduledJobs: _createScheduledJobs,
    verifyAndParseWebhook: _verifyAndParseWebhook,
    executeJob: _executeJob,
    ...providerOverrides
  } = overrides;
  const baseProvider: DeviceSyncProvider = {
    provider: "demo",
    descriptor: {
      provider: "demo",
      displayName: "Demo",
      transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
      oauth: {
        callbackPath: "/oauth/demo/callback",
        defaultScopes: ["offline", "read:data"],
      },
      webhook: {
        path: "/webhooks/demo",
        deliveryMode: "notification",
        supportsAdmin: false,
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
    ...(hasConnectionHandlerOverride
      ? { connectionHandler: providerOverrides.connectionHandler }
      : {
          connectionHandler: {
            beginConnection: beginConnection ?? (async (input) => ({
              authorizationUrl: buildConnectUrl
                ? buildConnectUrl({
                    state: input.state,
                    callbackUrl: input.callbackUrl,
                    scopes: input.scopes,
                    now: input.now,
                  })
                : "",
            })),
            completeConnection: completeConnection ?? (async (input) => {
              const callbackError = input.query.get("error")?.trim();
              if (callbackError) {
                throw deviceSyncError({
                  code: "OAUTH_CALLBACK_REJECTED",
                  message: "OAuth authorization was denied or canceled.",
                  retryable: false,
                  httpStatus: 400,
                });
              }
              const code = input.query.get("code") ?? "";
              if (!code) {
                throw deviceSyncError({
                  code: "OAUTH_CODE_MISSING",
                  message: "OAuth callback is missing the authorization code.",
                  retryable: false,
                  httpStatus: 400,
                });
              }
              if (!exchangeAuthorizationCode) {
                throw new Error("Fake provider exchangeAuthorizationCode is not configured.");
              }
              return exchangeAuthorizationCode({
                callbackUrl: input.callbackUrl,
                state: input.state,
                now: input.now,
                grantedScopes: input.grantedScopes,
              }, code);
            }),
            ...(refreshTokens ? { refreshTokens } : {}),
            ...(revokeAccess ? { revokeAccess } : {}),
          },
        }),
    ...(hasWebhookHandlerOverride
      ? { webhookHandler: providerOverrides.webhookHandler }
      : verifyAndParseWebhook
        ? {
            webhookHandler: {
              verifyAndParseWebhook: async (context) => {
                const parsed = await verifyAndParseWebhook(context);
                return {
                  ...parsed,
                  acceptanceMode: parsed.acceptanceMode
                    ?? classifyDeviceSyncWebhookAcceptanceMode(parsed.jobs),
                };
              },
            },
          }
        : {}),
    ...(hasJobExecutorOverride
      ? { jobExecutor: providerOverrides.jobExecutor }
      : {
          jobExecutor: {
            ...(createScheduledJobs ? { createScheduledJobs } : {}),
            executeJob: executeJob ?? defaultExecuteJob,
          },
        }),
  };

  return {
    ...baseProvider,
    ...providerOverrides,
  };
}

test("public ingress reuses shared OAuth callback logic independently of the local daemon", async () => {
  const store = new InMemoryPublicIngressStore();
  const connectionEvents: Array<{ accountId: string; initialJobs: number }> = [];
  const seenStates: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async exchangeAuthorizationCode(context, code) {
          seenStates.push(context.state);
          return {
            externalAccountId: `demo-${code}`,
            displayName: `Demo ${code}`,
            scopes: ["offline", "read:data"],
            metadata: {
              connectedBy: code,
            },
            tokens: {
              accessToken: "<REDACTED_ACCESS_TOKEN>",
              refreshToken: "<REDACTED_REFRESH_TOKEN>",
            } satisfies ProviderAuthTokens,
            initialJobs: [
              {
                kind: "backfill",
                payload: {
                  windowStart: "2026-01-01T00:00:00.000Z",
                },
              },
            ],
            nextReconcileAt: "2026-03-24T00:00:00.000Z",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished({ account, connection }) {
        connectionEvents.push({
          accountId: account.id,
          initialJobs: connection.initialJobs?.length ?? 0,
        });
      },
    },
  });

  const begin = await ingress.startConnection({
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });
  assert.match(begin.authorizationUrl, /^https:\/\/example\.test\/oauth\?state=/u);
  assert.match(begin.authorizationUrl, /redirect_uri=https%3A%2F%2Fsync\.example\.test%2Fdevice-sync%2Foauth%2Fdemo%2Fcallback/u);

  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.externalAccountId, "demo-abc");
  assert.equal(connected.account.provider, "demo");
  assert.equal(connected.returnTo, "https://app.example.test/settings/devices");
  assert.deepEqual(connectionEvents, [
    {
      accountId: connected.account.id,
      initialJobs: 1,
    },
  ]);
  assert.deepEqual(seenStates, [begin.state]);
});

test("public ingress describes providers with nullable callbacks and rejects unsupported connection starts", async () => {
  const descriptorOnlyProvider = createFakeProvider({
    provider: "descriptor-only",
    descriptor: {
      provider: "descriptor-only",
      displayName: "Descriptor Only",
      transportModes: ["scheduled_poll"],
      webhook: undefined,
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store: new InMemoryPublicIngressStore(),
  });
  const descriptorOnlyIngress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([descriptorOnlyProvider]),
    store: new InMemoryPublicIngressStore(),
  });

  assert.deepEqual(
    ingress.describeProviders(),
    [
      {
        provider: "demo",
        connectionKind: "oauth2",
        credentialPolicy: "oauth_tokens",
        callbackPath: "/oauth/demo/callback",
        callbackUrl: "https://sync.example.test/device-sync/oauth/demo/callback",
        webhookPath: "/webhooks/demo",
        webhookUrl: "https://sync.example.test/device-sync/webhooks/demo",
        supportsWebhooks: true,
        defaultScopes: ["offline", "read:data"],
      },
    ],
  );
  assert.deepEqual(
    descriptorOnlyIngress.describeProvider(descriptorOnlyProvider),
    {
      provider: "descriptor-only",
      connectionKind: "none",
      credentialPolicy: "none",
      callbackPath: null,
      callbackUrl: null,
      webhookPath: null,
      webhookUrl: null,
      supportsWebhooks: false,
      defaultScopes: [],
    },
  );
  await assert.rejects(
    () => descriptorOnlyIngress.startConnection({ provider: "descriptor-only" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_FLOW_NOT_SUPPORTED"
      && error.httpStatus === 500,
  );
});

test("public ingress rejects callback-required connection starts without callback paths", async () => {
  const provider = createFakeProvider({
    provider: "callback-required",
    descriptor: {
      provider: "callback-required",
      displayName: "Callback Required",
      transportModes: ["external_link"],
      connection: {
        kind: "external_link",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
    async beginConnection() {
      return {
        authorizationUrl: "https://provider.example/connect",
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "callback-required-account",
        credential: {
          kind: "none",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store: new InMemoryPublicIngressStore(),
  });

  assert.deepEqual(ingress.describeProvider(provider), {
    provider: "callback-required",
    connectionKind: "external_link",
    credentialPolicy: "none",
    callbackPath: null,
    callbackUrl: null,
    webhookPath: null,
    webhookUrl: null,
    supportsWebhooks: false,
    defaultScopes: [],
  });
  await assert.rejects(
    () => ingress.startConnection({ provider: "callback-required" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CALLBACK_URL_REQUIRED"
      && error.httpStatus === 500,
  );
});

test("public ingress persists validated provider-config connection seeds before external-link redirects", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          displayName: "Junction",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          metadata: {
            linkOutcome: "pending",
          },
        },
        stateMetadata: {
          clientUserIdHash: "client-hash-1",
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
    returnTo: "https://sync.example.test/settings/devices",
  });

  assert.equal(begin.authorizationUrl, `https://junction.example/link?murph_state=${begin.state}`);
  const account = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(account?.status, "active");
  assert.equal(account?.setupPhase, "pending_link");
  assert.ok(account?.setupExpiresAt);
  assert.equal(account?.accessTokenExpiresAt, null);
  assert.deepEqual(account?.metadata, {
    linkOutcome: "pending",
  });
  const stateRecord = store.peekOAuthState(begin.state);
  assert.equal(stateRecord?.ownerId, "<REDACTED_OWNER_ID>");
  assert.equal(stateRecord?.createdAt, account?.connectedAt);
  assert.equal(Object.prototype.hasOwnProperty.call(stateRecord?.metadata ?? {}, "ownerId"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      stateRecord?.metadata ?? {},
      "__murphSeededConnectionUpdatedAt",
    ),
    false,
  );
  assert.equal(
    account ? Object.values(stateRecord?.metadata ?? {}).includes(account.id) : false,
    true,
  );
  assert.equal(Object.values(stateRecord?.metadata ?? {}).includes("external-account-1"), false);
});

test("starting another Junction source preserves an established shared account", async () => {
  const store = new InMemoryPublicIngressStore();
  let acceptedWebhookCount = 0;
  let connectionHookFailureSource: string | null = null;
  let connectionHookNoopSource: string | null = null;
  const rejectedSourceAttempts: Array<{
    connectionStartedAt: string;
    sourceProviderSlug: string;
  }> = [];
  const observedSourceAttempts: Array<{
    eventType: string;
    sourceProviderSlug: string;
    traceClaimed: boolean;
  }> = [];
  const delayedSourceStartEntered = createVoidDeferred();
  const releaseDelayedSourceStart = createVoidDeferred();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll", "webhook_push"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      webhook: {
        deliveryMode: "notification",
        path: "/webhooks/junction",
        supportsAdmin: false,
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      if (input.sourceProviderSlug === "polar") {
        delayedSourceStartEntered.resolve();
        await releaseDelayedSourceStart.promise;
      }
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "shared-junction-account",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          setupPhase: "pending_link",
        },
      };
    },
    async completeConnection(input) {
      if (input.query.get("result") === "failure") {
        throw deviceSyncError({
          code: "JUNCTION_LINK_REJECTED",
          message: "Junction Link was not completed.",
          retryable: false,
          httpStatus: 400,
        });
      }
      return {
        externalAccountId: "shared-junction-account",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        setupPhase: "link_returned",
      };
    },
    async verifyAndParseWebhook(input) {
      const [sourceProviderSlug, timestampMode] = input.rawBody.toString("utf8").split(":");
      assert.ok(sourceProviderSlug);
      const eventType = timestampMode === "lifecycle"
        ? "provider.connection.created"
        : `${sourceProviderSlug}.data`;
      return {
        acceptanceMode: "durable_webhook_work",
        externalAccountId: "shared-junction-account",
        eventType,
        occurredAt: timestampMode === "no_timestamp"
          ? input.now
          : "2026-03-26T12:01:00.000Z",
        traceId: `trace-${sourceProviderSlug}-${timestampMode ?? "timestamped"}`,
        sourceProviderSlug,
        dataSourceProviderSlug: sourceProviderSlug,
        jobs: [{
          kind: "resource",
          payload: {
            resource: "activity",
            sourceProviderSlug,
          },
        }],
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
    hooks: {
      onConnectionEstablished({ account, now, provider, sourceProviderSlug }) {
        if (sourceProviderSlug === connectionHookFailureSource) {
          throw new Error("connection wake persistence failed");
        }
        if (sourceProviderSlug === connectionHookNoopSource) {
          return;
        }
        if (provider.provider === "junction" && sourceProviderSlug) {
          const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
            connectionId: account.id,
            sourceProviderSlug,
          });
          assert.ok(sourceInstanceKey);
          store.upsertConnectionSource({
            connectionId: account.id,
            sourceInstanceKey,
            sourceProviderSlug,
            status: "connected",
            firstSeenAt: now,
            lastSeenAt: now,
          });
        }
        return {
          sourceAdmissionCommitted: true as const,
        };
      },
      onConnectionSourceAdmissionRejected({ connectionStartedAt, sourceProviderSlug }) {
        rejectedSourceAttempts.push({ connectionStartedAt, sourceProviderSlug });
      },
      onConnectionSourceObserved({ account, eventType, sourceProviderSlug }) {
        observedSourceAttempts.push({
          eventType,
          sourceProviderSlug,
          traceClaimed: store.claimWebhookTraceCalls > 0,
        });
        if (
          sourceProviderSlug !== "apple_health_kit"
          || eventType !== "provider.connection.created"
        ) {
          return;
        }
        const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
          connectionId: account.id,
          sourceProviderSlug,
        });
        assert.ok(sourceInstanceKey);
        store.upsertConnectionSource({
          connectionId: account.id,
          sourceInstanceKey,
          sourceProviderSlug,
          status: "connected",
          firstSeenAt: "2026-03-26T12:01:00.000Z",
          lastSeenAt: "2026-03-26T12:01:00.000Z",
        });
        return { sourceAdmissionCommitted: true as const };
      },
      onWebhookAccepted({ account, claimToken, traceId }) {
        acceptedWebhookCount += 1;
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const garmin = await ingress.startConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    sourceProviderSlug: "garmin",
  });
  const established = await ingress.handleConnectionCallback({
    expectedOwnerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    query: new URLSearchParams({
      murph_state: garmin.state,
      result: "success",
    }),
  });
  const establishedConnectedAt = established.account.connectedAt;

  const polarSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: established.account.id,
    sourceProviderSlug: "polar",
  });
  assert.ok(polarSourceInstanceKey);
  const polarPreparedAt = "2026-03-26T12:00:20.000Z";
  store.upsertConnectionSource({
    connectionId: established.account.id,
    sourceInstanceKey: polarSourceInstanceKey,
    sourceProviderSlug: "polar",
    status: "disconnected",
    firstSeenAt: polarPreparedAt,
    lastSeenAt: polarPreparedAt,
  });
  const polarStart = ingress.startConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    sourceProviderSlug: "polar",
    sourceLifecycleProof: {
      connectionId: established.account.id,
      lastSeenAt: polarPreparedAt,
      sourceInstanceKey: polarSourceInstanceKey,
      sourceProviderSlug: "polar",
    },
  });
  await delayedSourceStartEntered.promise;
  store.upsertConnectionSource({
    connectionId: established.account.id,
    sourceInstanceKey: polarSourceInstanceKey,
    sourceProviderSlug: "polar",
    status: "disconnected",
    firstSeenAt: polarPreparedAt,
    lastSeenAt: "2026-03-26T12:00:21.000Z",
    lastErrorCode: "SOURCE_DISCONNECT_IN_PROGRESS",
  });
  releaseDelayedSourceStart.resolve();
  await assert.rejects(
    polarStart,
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_SOURCE_START_STALE",
  );

  const fitbitSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: established.account.id,
    sourceProviderSlug: "fitbit",
  });
  assert.ok(fitbitSourceInstanceKey);
  const concurrentCleanupAt = "2026-03-26T12:00:30.000Z";
  store.upsertConnectionSource({
    connectionId: established.account.id,
    sourceInstanceKey: fitbitSourceInstanceKey,
    sourceProviderSlug: "fitbit",
    status: "disconnected",
    firstSeenAt: concurrentCleanupAt,
    lastSeenAt: concurrentCleanupAt,
    lastErrorCode: "SOURCE_DISCONNECT_IN_PROGRESS",
    lastErrorMessage: "Source cleanup is in progress.",
  });

  const fitbitSourceLifecycleProof = {
    connectionId: established.account.id,
    lastSeenAt: concurrentCleanupAt,
    sourceInstanceKey: fitbitSourceInstanceKey,
    sourceProviderSlug: "fitbit",
  };
  await assert.rejects(
    ingress.startConnection({
      ownerId: "<REDACTED_OWNER_ID>",
      provider: "junction",
      sourceProviderSlug: "fitbit",
      sourceLifecycleProof: fitbitSourceLifecycleProof,
    }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_SOURCE_START_STALE",
  );

  const afterFitbitStart = store.getConnectionByExternalAccount(
    "junction",
    "shared-junction-account",
  );
  assert.equal(afterFitbitStart?.id, established.account.id);
  assert.equal(afterFitbitStart?.setupPhase, "source_confirmed");
  assert.equal(afterFitbitStart?.connectedAt, establishedConnectedAt);
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "garmin",
    })[0]?.status,
    "connected",
  );
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "fitbit",
    })[0]?.lastErrorCode,
    "SOURCE_DISCONNECT_IN_PROGRESS",
  );

  store.upsertConnectionSource({
    connectionId: established.account.id,
    sourceInstanceKey: fitbitSourceInstanceKey,
    sourceProviderSlug: "fitbit",
    status: "disconnected",
    firstSeenAt: concurrentCleanupAt,
    lastSeenAt: concurrentCleanupAt,
  });

  const fitbit = await ingress.startConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    sourceProviderSlug: "fitbit",
    sourceLifecycleProof: fitbitSourceLifecycleProof,
  });

  await assert.doesNotReject(
    ingress.handleWebhook("junction", new Headers(), Buffer.from("garmin")),
  );
  await assert.rejects(
    ingress.handleWebhook("junction", new Headers(), Buffer.from("fitbit")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_SOURCE_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.equal(acceptedWebhookCount, 1);

  const completedFitbit = await ingress.handleConnectionCallback({
    expectedOwnerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    query: new URLSearchParams({
      murph_state: fitbit.state,
      result: "success",
    }),
  });
  await assert.doesNotReject(
    ingress.handleWebhook("junction", new Headers(), Buffer.from("fitbit")),
  );

  assert.equal(completedFitbit.account.id, established.account.id);
  assert.equal(completedFitbit.account.connectedAt, establishedConnectedAt);
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "fitbit",
    })[0]?.status,
    "connected",
  );
  assert.equal(acceptedWebhookCount, 2);

  const appleHealthSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: established.account.id,
    sourceProviderSlug: "apple_health_kit",
  });
  assert.ok(appleHealthSourceInstanceKey);
  store.upsertConnectionSource({
    connectionId: established.account.id,
    sourceInstanceKey: appleHealthSourceInstanceKey,
    sourceProviderSlug: "apple_health_kit",
    status: "disconnected",
    firstSeenAt: "2026-03-26T12:00:00.000Z",
    lastSeenAt: "2026-03-26T12:00:00.000Z",
  });
  await assert.doesNotReject(
    ingress.handleWebhook("junction", new Headers(), Buffer.from("apple_health_kit:lifecycle")),
  );
  assert.deepEqual(observedSourceAttempts, [
    {
      eventType: "fitbit.data",
      sourceProviderSlug: "fitbit",
      traceClaimed: true,
    },
    {
      eventType: "provider.connection.created",
      sourceProviderSlug: "apple_health_kit",
      traceClaimed: true,
    },
  ]);
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "apple_health_kit",
    })[0]?.status,
    "connected",
  );
  assert.equal(acceptedWebhookCount, 3);

  store.upsertConnectionSource({
    connectionId: established.account.id,
    sourceInstanceKey: appleHealthSourceInstanceKey,
    sourceProviderSlug: "apple_health_kit",
    status: "disconnected",
    firstSeenAt: "2026-03-26T12:02:00.000Z",
    lastSeenAt: "2026-03-26T12:02:00.000Z",
  });
  for (const timestampMode of ["timestamped", "no_timestamp"]) {
    await assert.rejects(
      ingress.handleWebhook(
        "junction",
        new Headers(),
        Buffer.from(`apple_health_kit:${timestampMode}`),
      ),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "WEBHOOK_SOURCE_NOT_READY",
    );
  }
  assert.deepEqual(observedSourceAttempts.slice(-2), [
    {
      eventType: "apple_health_kit.data",
      sourceProviderSlug: "apple_health_kit",
      traceClaimed: true,
    },
    {
      eventType: "apple_health_kit.data",
      sourceProviderSlug: "apple_health_kit",
      traceClaimed: true,
    },
  ]);
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "apple_health_kit",
    })[0]?.status,
    "disconnected",
  );

  const withings = await ingress.startConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    sourceProviderSlug: "withings",
  });
  await assert.rejects(
    ingress.handleConnectionCallback({
      expectedOwnerId: "<REDACTED_OWNER_ID>",
      provider: "junction",
      query: new URLSearchParams({
        murph_state: withings.state,
        result: "failure",
      }),
    }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_LINK_REJECTED",
  );

  const afterWithingsFailure = store.getConnectionByExternalAccount(
    "junction",
    "shared-junction-account",
  );
  assert.equal(afterWithingsFailure?.id, established.account.id);
  assert.equal(afterWithingsFailure?.connectedAt, establishedConnectedAt);
  assert.equal(afterWithingsFailure?.setupPhase, "source_confirmed");
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "withings",
    })[0]?.status,
    "disconnected",
  );

  const oura = await ingress.startConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    sourceProviderSlug: "oura",
  });
  connectionHookFailureSource = "oura";
  const ouraStartedAt = store.peekOAuthState(oura.state)?.createdAt;
  assert.ok(ouraStartedAt);
  await assert.rejects(
    ingress.handleConnectionCallback({
      expectedOwnerId: "<REDACTED_OWNER_ID>",
      provider: "junction",
      query: new URLSearchParams({
        murph_state: oura.state,
        result: "success",
      }),
    }),
    /connection wake persistence failed/u,
  );
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "oura",
    })[0]?.status,
    "disconnected",
  );
  assert.equal(
    store.getConnectionByExternalAccount("junction", "shared-junction-account")?.setupPhase,
    "source_confirmed",
  );
  assert.deepEqual(rejectedSourceAttempts, [{
    connectionStartedAt: ouraStartedAt,
    sourceProviderSlug: "oura",
  }]);

  const polar = await ingress.startConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    sourceProviderSlug: "polar",
  });
  connectionHookFailureSource = null;
  connectionHookNoopSource = "polar";
  await assert.rejects(
    ingress.handleConnectionCallback({
      expectedOwnerId: "<REDACTED_OWNER_ID>",
      provider: "junction",
      query: new URLSearchParams({
        murph_state: polar.state,
        result: "success",
      }),
    }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_SOURCE_ADMISSION_NOT_COMMITTED"
      && error.httpStatus === 409,
  );
  assert.equal(
    store.listConnectionSources({
      connectionId: established.account.id,
      sourceProviderSlug: "polar",
    })[0]?.status,
    "disconnected",
  );
  assert.deepEqual(rejectedSourceAttempts.map((attempt) => attempt.sourceProviderSlug), [
    "oura",
    "polar",
  ]);
});

test("public ingress completes seeded external-link callbacks after mutable webhook observations", async () => {
  const store = new InMemoryPublicIngressStore();
  let callbackStateMetadata: Record<string, unknown> | undefined;
  let callbackSeededExternalAccountId: string | null | undefined;
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          displayName: "Junction",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
        stateMetadata: {
          ownerId: "<REDACTED_OWNER_ID>",
          rawUserId: "<REDACTED_USER_ID>",
          junctionUserId: "<REDACTED_PROVIDER_USER_ID>",
          user: "<REDACTED_PROVIDER_USER_ID>",
          accessToken: "<REDACTED_ACCESS_TOKEN>",
          webhookSecret: "<REDACTED_WEBHOOK_SECRET>",
          clientId: "<REDACTED_CLIENT_ID>",
          clientUserId: "<REDACTED_CLIENT_USER_ID>",
          clientUserIdHash: "client-hash-1",
        },
      };
    },
    async completeConnection(input) {
      callbackStateMetadata = input.stateMetadata;
      callbackSeededExternalAccountId = input.seededExternalAccountId;
      return {
        externalAccountId: "external-account-1",
        displayName: "Junction",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        metadata: {
          callbackOutcome: "complete",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
    returnTo: "https://sync.example.test/settings/devices",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(seeded?.setupExpiresAt);
  store.upsertConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    externalAccountId: "external-account-1",
    displayName: "Junction",
    status: "active",
    setupPhase: "pending_link",
    setupExpiresAt: seeded.setupExpiresAt,
    scopes: [],
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    existingAccountPolicy: "replace",
    metadata: {
      callbackOutcome: "seeded",
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 2,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:30:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillEvidence:
        "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
      seedOnlyState: "discard",
    },
    connectedAt: seeded.connectedAt,
    nextReconcileAt: seeded.nextReconcileAt,
  });
  const stateRecord = store.peekOAuthState(begin.state);
  assert.ok(stateRecord);
  store.createOAuthState({
    ...stateRecord,
    metadata: {
      ...stateRecord.metadata,
      __murphSeededConnectionUpdatedAt: seeded.updatedAt,
    },
  });
  const seededConnectedAt = seeded.connectedAt;
  store.markWebhookReceived(seeded.id, "2099-04-26T23:59:59.000Z");
  const observed = store.getConnectionById(seeded.id);
  assert.equal(observed?.connectedAt, seededConnectedAt);
  assert.notEqual(observed?.updatedAt, seeded.updatedAt);
  const completed = await ingress.handleConnectionCallback({
    provider: "junction",
    query: new URLSearchParams({
      murph_state: begin.state,
      result: "success",
    }),
  });

  assert.deepEqual(callbackStateMetadata, {
    clientUserIdHash: "client-hash-1",
  });
  assert.equal(callbackSeededExternalAccountId, "external-account-1");
  assert.equal(Object.prototype.hasOwnProperty.call(callbackStateMetadata ?? {}, "ownerId"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      callbackStateMetadata ?? {},
      "__murphSeededConnectionUpdatedAt",
    ),
    false,
  );
  assert.equal(completed.account.setupPhase, "source_confirmed");
  assert.equal(completed.account.setupExpiresAt, null);
  assert.equal(completed.account.externalAccountId, "external-account-1");
  assert.equal(completed.account.id, seeded.id);
  assert.deepEqual(completed.account.metadata, {
    callbackOutcome: "complete",
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 2,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:30:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillEvidence:
      "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      completed.account.metadata,
      "__murphSeededConnectionUpdatedAt",
    ),
    false,
  );
  assert.equal(Object.values(callbackStateMetadata ?? {}).includes(completed.account.id), false);
});

test("public ingress keeps pending external-link accounts inert until callback confirmation", async () => {
  const store = new InMemoryPublicIngressStore();
  let acceptedCalls = 0;
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll", "webhook_push"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      webhook: {
        deliveryMode: "notification",
        path: "/webhooks/junction",
        supportsAdmin: false,
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
    async verifyAndParseWebhook() {
      return {
        externalAccountId: "external-account-1",
        eventType: "daily.data.sleep.created",
        traceId: "pending-link-trace",
        jobs: [],
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        acceptedCalls += 1;
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });
  const begin = await ingress.startConnection({
    ownerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
  });
  const pending = store.getConnectionByExternalAccount("junction", "external-account-1");

  await assert.rejects(
    () => ingress.handleWebhook("junction", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );

  assert.equal(pending?.setupPhase, "pending_link");
  assert.equal(acceptedCalls, 0);
  assert.equal(store.claimWebhookTraceCalls, 1);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(readRecordedWebhookTrace(store), null);
  assert.equal(
    store.getConnectionByExternalAccount("junction", "external-account-1")?.lastWebhookAt,
    null,
  );

  const completed = await ingress.handleConnectionCallback({
    expectedOwnerId: "<REDACTED_OWNER_ID>",
    provider: "junction",
    query: new URLSearchParams({
      murph_state: begin.state,
      result: "success",
    }),
  });
  const retried = await ingress.handleWebhook(
    "junction",
    new Headers(),
    Buffer.from("{}"),
  );

  assert.equal(completed.account.setupPhase, "source_confirmed");
  assert.equal(retried.accepted, true);
  assert.equal(acceptedCalls, 1);
  assert.equal(store.claimWebhookTraceCalls, 2);
  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress terminally consumes webhooks received after incomplete setup expiry", async () => {
  const store = new InMemoryPublicIngressStore();
  let acceptedCalls = 0;
  let dirtySatisfiedCalls = 0;
  let sourceObservedCalls = 0;
  const provider = createFakeProvider({
    async verifyAndParseWebhook() {
      return {
        acceptanceMode: "level_dirty_hint",
        eventType: "provider.connection.updated",
        externalAccountId: "demo-expired-setup",
        jobs: [],
        sourceProviderSlug: "fitbit",
        traceId: "expired-setup-trace",
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
    hooks: {
      onConnectionSourceObserved() {
        sourceObservedCalls += 1;
        return { sourceAdmissionCommitted: true };
      },
      onLevelDirtyWebhookAlreadySatisfied() {
        dirtySatisfiedCalls += 1;
        return null;
      },
      onWebhookAccepted({ account, claimToken, traceId }) {
        acceptedCalls += 1;
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });
  const account = store.upsertConnection({
    connectedAt: "2026-03-26T12:00:00.000Z",
    credential: { kind: "none" },
    externalAccountId: "demo-expired-setup",
    existingAccountPolicy: "replace",
    metadata: {},
    nextReconcileAt: null,
    ownerId: "owner-123",
    provider: "demo",
    scopes: [],
    setupExpiresAt: "2026-03-26T12:15:00.000Z",
    setupPhase: "pending_link",
    status: "active",
  });
  store.upsertConnectionSource({
    connectionId: account.id,
    firstSeenAt: "2026-03-26T12:00:00.000Z",
    lastSeenAt: "2026-03-26T12:00:00.000Z",
    sourceInstanceKey: "fitbit:test",
    sourceProviderSlug: "fitbit",
    status: "disconnected",
  });
  const prepared = await ingress.prepareWebhookForDurableEnqueue(
    "demo",
    new Headers(),
    Buffer.from("{}"),
    new Date("2026-03-26T12:15:00.000Z"),
  );

  const first = await ingress.handlePreparedWebhook(prepared);
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.equal(acceptedCalls, 0);
  assert.equal(dirtySatisfiedCalls, 0);
  assert.equal(sourceObservedCalls, 0);
  assert.equal(store.claimWebhookTraceCalls, 1);
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(store.recordedSourceDataArrivals.length, 0);
  assert.equal(store.getConnectionById(account.id)?.lastWebhookAt, null);
  assert.equal(store.getConnectionById(account.id)?.setupPhase, "pending_link");
  assert.equal(
    store.getConnectionById(account.id)?.setupExpiresAt,
    "2026-03-26T12:15:00.000Z",
  );

  const duplicate = await ingress.handlePreparedWebhook(prepared);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(acceptedCalls, 0);
  assert.equal(dirtySatisfiedCalls, 0);
  assert.equal(sourceObservedCalls, 0);
  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress keeps a pre-expiry prepared webhook retryable after delayed delivery", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            eventType: "demo.updated",
            externalAccountId: "demo-live-setup",
            jobs: [],
            traceId: "live-setup-delayed-trace",
          };
        },
      }),
    ]),
    store,
  });
  store.upsertConnection({
    connectedAt: "2026-03-26T12:00:00.000Z",
    credential: { kind: "none" },
    externalAccountId: "demo-live-setup",
    existingAccountPolicy: "replace",
    metadata: {},
    nextReconcileAt: null,
    ownerId: "owner-123",
    provider: "demo",
    scopes: [],
    setupExpiresAt: "2026-03-26T12:15:00.000Z",
    setupPhase: "pending_link",
    status: "active",
  });
  const prepared = await ingress.prepareWebhookForDurableEnqueue(
    "demo",
    new Headers(),
    Buffer.from("{}"),
    new Date("2026-03-26T12:14:59.999Z"),
  );

  await assert.rejects(
    () => ingress.handlePreparedWebhook(prepared),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.equal(store.claimWebhookTraceCalls, 1);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(readRecordedWebhookTrace(store), null);
});

test("public ingress rejects external-link callbacks that do not match the seeded account", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-2",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(seeded?.setupPhase, "pending_link");

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_SEEDED_ACCOUNT_MISMATCH"
      && error.httpStatus === 500,
  );

  const failed = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(failed);
  assert.equal(failed.id, seeded?.id);
  assert.equal(failed.status, "reauthorization_required");
  assert.equal(failed.setupPhase, "failed");
  assert.equal(failed.lastErrorCode, "CONNECTION_SEEDED_ACCOUNT_MISMATCH");
  assert.equal(store.getConnectionByExternalAccount("junction", "external-account-2"), null);
});

test("public ingress rejects stale external-link callbacks after seeded accounts are disconnected", async () => {
  const store = new InMemoryPublicIngressStore();
  let completeCalls = 0;
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      completeCalls += 1;
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    returnTo: "/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
    ownerId: "<REDACTED_OWNER_ID>",
    connectSourceId: "garmin",
    connectTarget: "garmin",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(seeded);
  store.patchAccountStatus(seeded.id, "disconnected");

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "success",
        }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "CONNECTION_ALREADY_DISCONNECTED");
      assert.equal(error.httpStatus, 409);
      assert.equal(error.details?.connectSourceId, "garmin");
      assert.equal(error.details?.connectTarget, "garmin");
      assert.equal(error.details?.provider, "junction");
      assert.equal(
        error.details?.returnTo,
        "https://sync.example.test/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
      );
      assert.equal(Object.values(error.details ?? {}).includes(seeded.id), false);
      assert.equal(Object.values(error.details ?? {}).includes(seeded.externalAccountId), false);
      return true;
    },
  );

  const disconnected = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(disconnected?.status, "disconnected");
  assert.equal(disconnected?.setupPhase, "pending_link");
  assert.equal(completeCalls, 0);
});

test("public ingress rejects seeded callbacks after the connection starts a newer epoch", async () => {
  const store = new InMemoryPublicIngressStore();
  let completeCalls = 0;
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      completeCalls += 1;
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(seeded);
  const reconnected = store.upsertConnection({
    provider: "junction",
    externalAccountId: "external-account-1",
    displayName: "Garmin",
    setupPhase: "source_confirmed",
    scopes: [],
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    existingAccountPolicy: "replace",
    metadata: { connectionEpoch: "new" },
    connectedAt: "2099-04-27T00:00:00.000Z",
    nextReconcileAt: null,
  });

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_SEEDED_ACCOUNT_CHANGED"
      && error.httpStatus === 409,
  );

  const current = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(current?.id, reconnected.id);
  assert.equal(current?.connectedAt, reconnected.connectedAt);
  assert.deepEqual(current?.metadata, { connectionEpoch: "new" });
  assert.equal(current?.status, "active");
  assert.equal(completeCalls, 0);
});

test("public ingress rejects seeded callbacks that finish after the seeded account is disconnected", async () => {
  const store = new InMemoryPublicIngressStore();
  let completeCalls = 0;
  let resolveProviderCompletionStarted: (() => void) | null = null;
  let releaseProviderCompletion: () => void = () => {
    throw new Error("Provider completion release was not initialized.");
  };
  const providerCompletionStarted = new Promise<void>((resolve) => {
    resolveProviderCompletionStarted = resolve;
  });
  const providerCompletionRelease = new Promise<void>((resolve) => {
    releaseProviderCompletion = resolve;
  });
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    beginConnection: async (input) => ({
      authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
      connectionSeed: {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      },
    }),
    completeConnection: async () => {
      completeCalls += 1;
      resolveProviderCompletionStarted?.();
      await providerCompletionRelease;
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    returnTo: "/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
    ownerId: "<REDACTED_OWNER_ID>",
    connectSourceId: "garmin",
    connectTarget: "garmin",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(seeded);
  const callback = ingress.handleConnectionCallback({
    provider: "junction",
    query: new URLSearchParams({
      murph_state: begin.state,
      result: "success",
    }),
  });
  await providerCompletionStarted;
  store.patchAccountStatus(seeded.id, "disconnected");
  releaseProviderCompletion();

  await assert.rejects(
    () => callback,
    (error: unknown) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "CONNECTION_ALREADY_DISCONNECTED");
      assert.equal(error.httpStatus, 409);
      assert.equal(error.details?.connectSourceId, "garmin");
      assert.equal(error.details?.connectTarget, "garmin");
      assert.equal(error.details?.provider, "junction");
      return true;
    },
  );

  const disconnected = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(disconnected?.status, "disconnected");
  assert.equal(disconnected?.setupPhase, "pending_link");
  assert.equal(completeCalls, 1);
});

test("public ingress marks seeded external-link accounts failed when callbacks fail before upsert", async () => {
  const store = new InMemoryPublicIngressStore();
  const callbackError = new DeviceSyncError({
    code: "EXTERNAL_LINK_CALLBACK_FAILED",
    message: "External link callback could not be completed.",
    httpStatus: 400,
  });
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      throw callbackError;
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(seeded?.status, "active");
  assert.equal(seeded?.setupPhase, "pending_link");

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "failure",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "EXTERNAL_LINK_CALLBACK_FAILED"
      && error.httpStatus === 400,
  );

  const failed = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(failed);
  assert.equal(failed.id, seeded?.id);
  assert.equal(failed.status, "reauthorization_required");
  assert.equal(failed.setupPhase, "failed");
  assert.equal(failed.setupExpiresAt, null);
  assert.equal(failed.lastErrorCode, "EXTERNAL_LINK_CALLBACK_FAILED");
  assert.equal(failed.lastErrorMessage, "External link callback could not be completed.");
  assert.ok(failed.lastSyncErrorAt);
});

test("public ingress marks seeded external-link accounts failed when callback credentials violate policy", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "unexpected-profile",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "PROVIDER_CONFIG_KEY_MISMATCH"
      && error.httpStatus === 500,
  );

  const failed = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(failed);
  assert.equal(failed.status, "reauthorization_required");
  assert.equal(failed.setupPhase, "failed");
  assert.equal(failed.lastErrorCode, "PROVIDER_CONFIG_KEY_MISMATCH");
});

test("public ingress rejects callback credentials that violate provider credential policy", async () => {
  const makeIngress = (connection: ProviderConnectionResult) => {
    const store = new InMemoryPublicIngressStore();
    const provider = createFakeProvider({
      provider: "junction",
      credentialPolicy: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      descriptor: {
        provider: "junction",
        displayName: "Junction",
        transportModes: ["external_link", "scheduled_poll"],
        connection: {
          kind: "external_link",
          callbackPath: "/connect/junction/callback",
        },
        normalization: {
          metricFamilies: ["activity"],
          snapshotParser: "schema",
        },
        sourcePriorityHints: {
          defaultPriority: 60,
          metricFamilies: {
            activity: 60,
          },
        },
      },
      async beginConnection(input) {
        return {
          authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        };
      },
      async completeConnection() {
        return connection;
      },
    });
    return {
      ingress: createDeviceSyncPublicIngress({
        publicBaseUrl: "https://sync.example.test/device-sync",
        registry: createDeviceSyncRegistry([provider]),
        store,
      }),
      store,
    };
  };

  const wrongKey = makeIngress({
    externalAccountId: "external-account-1",
    credential: {
      kind: "provider_config",
      providerConfigKey: "other-profile",
    },
  });
  const wrongKeyState = await wrongKey.ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  await assert.rejects(
    () =>
      wrongKey.ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: wrongKeyState.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "PROVIDER_CONFIG_KEY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(wrongKey.store.getConnectionByExternalAccount("junction", "external-account-1"), null);

  const wrongKind = makeIngress({
    externalAccountId: "external-account-2",
    credential: {
      kind: "none",
    },
  });
  const wrongKindState = await wrongKind.ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  await assert.rejects(
    () =>
      wrongKind.ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: wrongKindState.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CREDENTIAL_POLICY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(wrongKind.store.getConnectionByExternalAccount("junction", "external-account-2"), null);

  const mixedCredential = makeIngress({
    externalAccountId: "external-account-3",
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    tokens: {
      accessToken: "<REDACTED_ACCESS_TOKEN>",
      refreshToken: "<REDACTED_REFRESH_TOKEN>",
    },
  });
  const mixedCredentialState = await mixedCredential.ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  await assert.rejects(
    () =>
      mixedCredential.ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: mixedCredentialState.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CREDENTIAL_AMBIGUOUS"
      && error.httpStatus === 500,
  );
  assert.equal(mixedCredential.store.getConnectionByExternalAccount("junction", "external-account-3"), null);
});

test("public ingress rejects provider-config connection seeds with the wrong provider config key", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection() {
      return {
        authorizationUrl: "https://junction.example/link",
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "other-profile",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  await assert.rejects(
    () => ingress.startConnection({ provider: "junction", ownerId: "<REDACTED_OWNER_ID>" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "PROVIDER_CONFIG_KEY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(store.getConnectionByExternalAccount("junction", "external-account-1"), null);
});

test("configured provider manifests own credential policy over provider instances", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "oura",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "oura",
      displayName: "Fake Oura",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/oura/callback",
      },
      normalization: {
        metricFamilies: ["sleep"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 90,
        metricFamilies: {
          sleep: 90,
        },
      },
    },
    async beginConnection() {
      return {
        authorizationUrl: "https://oura.example/link",
        connectionSeed: {
          externalAccountId: "oura-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "oura-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  await assert.rejects(
    () => ingress.startConnection({ provider: "oura", ownerId: "<REDACTED_OWNER_ID>" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CREDENTIAL_POLICY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(store.getConnectionByExternalAccount("oura", "oura-account-1"), null);
});

test("public ingress validates OAuth callback state ownership and required parameters", async () => {
  const store = new InMemoryPublicIngressStore();
  const demoProvider = createFakeProvider();
  const completeConnection = vi.spyOn(demoProvider.connectionHandler!, "completeConnection");
  const alternateProvider = createFakeProvider({
    provider: "alt",
    descriptor: {
      provider: "alt",
      displayName: "Alt",
      transportModes: ["oauth_callback", "scheduled_poll"],
      oauth: {
        callbackPath: "/oauth/alt/callback",
        defaultScopes: ["offline", "read:alt"],
      },
      webhook: undefined,
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      demoProvider,
      alternateProvider,
    ]),
    store,
  });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        code: "abc",
        state: "   ",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_STATE_MISSING"
      && error.httpStatus === 400,
  );

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        code: "abc",
        state: "missing-state",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_STATE_INVALID"
      && error.httpStatus === 400,
  );

  const mismatchedState = await ingress.startConnection({ provider: "demo" });
  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "alt",
        code: "abc",
        state: mismatchedState.state,
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_PROVIDER_MISMATCH"
      && error.httpStatus === 400,
  );

  const missingCodeState = await ingress.startConnection({ provider: "demo" });
  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: missingCodeState.state,
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_CODE_MISSING"
      && error.httpStatus === 400,
  );
  assert.equal(store.hasOAuthClaim(missingCodeState.state), false);
  assert.equal(completeConnection.mock.calls.length, 0);
});

test("public ingress never reinterprets a consumed callback from mutable replay query fields", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    async exchangeAuthorizationCode() {
      throw new Error("provider exchange outcome unavailable");
    },
  });
  const completeConnection = vi.spyOn(provider.connectionHandler!, "completeConnection");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });
  const begin = await ingress.startConnection({
    ownerId: "member_a",
    provider: "demo",
  });
  await assert.rejects(
    () => ingress.handleOAuthCallback({
      code: "ambiguous",
      expectedOwnerId: "member_a",
      provider: "demo",
      state: begin.state,
    }),
    /provider exchange outcome unavailable/,
  );

  for (const replay of [
    { error: "access_denied" },
    {},
    { code: "different", error: "access_denied" },
  ]) {
    await assert.rejects(
      () => ingress.handleOAuthCallback({
        ...replay,
        expectedOwnerId: "member_a",
        provider: "demo",
        state: begin.state,
      }),
      (error: unknown) =>
        error instanceof DeviceSyncError && error.code === "OAUTH_STATE_REPLAYED",
    );
  }
  assert.equal(completeConnection.mock.calls.length, 1);
  assert.equal(store.hasOAuthClaim(begin.state), true);
});

test("public ingress retains an ambiguous provider-exchange claim", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async exchangeAuthorizationCode() {
          throw new Error("provider exchange outcome unavailable");
        },
      }),
    ]),
    store,
  });
  const begin = await ingress.startConnection({
    ownerId: "member_a",
    provider: "demo",
  });

  await assert.rejects(
    () => ingress.handleOAuthCallback({
      code: "ambiguous",
      expectedOwnerId: "member_a",
      provider: "demo",
      state: begin.state,
    }),
    /provider exchange outcome unavailable/,
  );
  assert.equal(store.hasOAuthClaim(begin.state), true);
});

test("public ingress requires manual provider recovery after an ambiguous callback lease expires", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
  try {
    const store = new InMemoryPublicIngressStore();
    const provider = createFakeProvider({
      async exchangeAuthorizationCode() {
        throw new Error("provider exchange outcome unavailable");
      },
    });
    const completeConnection = vi.spyOn(
      provider.connectionHandler!,
      "completeConnection",
    );
    const ingress = createDeviceSyncPublicIngress({
      publicBaseUrl: "https://sync.example.test/device-sync",
      registry: createDeviceSyncRegistry([provider]),
      sessionTtlMs: 60_000,
      store,
    });
    const begin = await ingress.startConnection({
      ownerId: "member_a",
      provider: "demo",
    });

    await assert.rejects(
      () => ingress.handleOAuthCallback({
        code: "ambiguous",
        expectedOwnerId: "member_a",
        provider: "demo",
        state: begin.state,
      }),
      /provider exchange outcome unavailable/,
    );
    vi.setSystemTime(new Date(
      Date.parse("2026-08-13T12:00:00.000Z")
        + DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
    ));

    await assert.rejects(
      () => ingress.handleOAuthCallback({
        code: "ambiguous",
        expectedOwnerId: "member_a",
        provider: "demo",
        state: begin.state,
      }),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "OAUTH_CALLBACK_RECOVERY_REQUIRED"
        && error.httpStatus === 409,
    );
    assert.equal(completeConnection.mock.calls.length, 1);
    assert.equal(store.hasOAuthClaim(begin.state), true);
  } finally {
    vi.useRealTimers();
  }
});

test("public ingress finalizes successful callback state before a redelivery", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider();
  const connectionHandler = provider.connectionHandler;
  assert.ok(connectionHandler);
  const completeConnection = vi.spyOn(connectionHandler, "completeConnection");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    ownerId: "member_a",
    provider: "demo",
    returnTo: "https://sync.example.test/settings/devices",
    connectSourceId: "demo",
    connectTarget: "demo",
  });

  const connected = await ingress.handleConnectionCallback({
    expectedOwnerId: "member_a",
    provider: "demo",
    state: begin.state,
    code: "abc",
  });
  assert.equal(connected.account.provider, "demo");

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        expectedOwnerId: "member_a",
        provider: "demo",
        state: begin.state,
        code: "abc",
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "OAUTH_STATE_INVALID");
      assert.equal(error.httpStatus, 400);
      return true;
    },
  );

  // Redelivery must not redo the connection work.
  assert.equal(completeConnection.mock.calls.length, 1);
  assert.equal(store.upsertConnectionCalls, 1);
  assert.equal(store.hasOAuthClaim(begin.state), false);
});

test("public ingress falls back to granted scopes when the provider omits scopes", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async exchangeAuthorizationCode() {
          return {
            externalAccountId: "demo-abc",
            displayName: "Demo abc",
            metadata: {},
            tokens: {
              accessToken: "<REDACTED_ACCESS_TOKEN>",
            } satisfies ProviderAuthTokens,
          };
        },
      }),
    ]),
    store: new InMemoryPublicIngressStore(),
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
    scope: " offline   read:data  ",
  });

  assert.deepEqual(connected.account.scopes, ["offline", "read:data"]);
});

test("public ingress rejects webhook deliveries for providers without webhook handlers", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        descriptor: {
          provider: "demo",
          displayName: "Demo",
          transportModes: ["oauth_callback", "scheduled_poll"],
          oauth: {
            callbackPath: "/oauth/demo/callback",
            defaultScopes: ["offline", "read:data"],
          },
          webhook: undefined,
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: {
              activity: 50,
            },
          },
        },
        verifyAndParseWebhook: undefined,
      }),
    ]),
    store: new InMemoryPublicIngressStore(),
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOKS_NOT_SUPPORTED"
      && error.httpStatus === 404,
  );
});

test("public ingress freezes a versioned prepared webhook at its verified receipt instant without touching the store", async () => {
  const store = new InMemoryPublicIngressStore();
  const receivedAt = new Date("2026-04-10T12:00:00.000Z");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook({ now }) {
          assert.equal(now, receivedAt.toISOString());
          return {
            externalAccountId: "opaque-account",
            eventType: "demo.updated",
            jobs: [],
            traceId: "opaque-trace",
          };
        },
      }),
    ]),
    store,
  });

  assert.deepEqual(await ingress.prepareWebhookForDurableEnqueue(
    "demo",
    new Headers(),
    Buffer.from("{}"),
    receivedAt,
  ), {
    acceptanceMode: "durable_webhook_work",
    eventType: "demo.updated",
    externalAccountId: "opaque-account",
    jobs: [],
    provider: "demo",
    receivedAt: receivedAt.toISOString(),
    schema: "murph.device-sync-prepared-webhook.v1",
    traceId: scopeWebhookTraceId("demo", "opaque-account", "opaque-trace"),
  });
  assert.equal(store.claimWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
});

test("public ingress admits a prepared webhook after verifier rotation without invoking the new verifier", async () => {
  const receivedAt = new Date("2026-04-10T12:00:00.000Z");
  let originalVerifierCalls = 0;
  let rotatedVerifierCalls = 0;
  const store = new InMemoryPublicIngressStore();
  const original = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          originalVerifierCalls += 1;
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            jobs: [],
            traceId: "secret-one-trace",
          };
        },
      }),
    ]),
    store,
  });
  const begin = await original.startConnection({ provider: "demo" });
  await original.handleOAuthCallback({ code: "abc", provider: "demo", state: begin.state });
  const prepared = await original.prepareWebhookForDurableEnqueue(
    "demo",
    new Headers({ "x-demo-signature": "secret-one-proof" }),
    Buffer.from("secret-one-body"),
    receivedAt,
  );

  const rotated = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          rotatedVerifierCalls += 1;
          throw deviceSyncError({
            code: "WEBHOOK_SIGNATURE_INVALID",
            httpStatus: 401,
            message: "Only rotated proof is accepted.",
            retryable: false,
          });
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const result = await rotated.handlePreparedWebhook(prepared);
  assert.equal(result.accepted, true);
  assert.equal(originalVerifierCalls, 1);
  assert.equal(rotatedVerifierCalls, 0);
  assert.equal(store.lastWebhookTraceClaim?.receivedAt, receivedAt.toISOString());
});

test("public ingress revalidates current provider and connection authority for prepared webhooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
  });
  const prepared = await ingress.prepareWebhookForDurableEnqueue(
    "demo",
    new Headers(),
    Buffer.from("{}"),
    new Date("2026-04-10T12:00:00.000Z"),
  );

  const providerRemoved = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([]),
    store,
  });
  const removed = await providerRemoved.handlePreparedWebhook(prepared);
  assert.equal(removed.accepted, true);
  assert.equal(removed.duplicate, false);

  const currentStore = new InMemoryPublicIngressStore();
  const currentIngress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store: currentStore,
  });
  await assert.rejects(
    () => currentIngress.handlePreparedWebhook(prepared),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY",
  );
});

test("public ingress leases a delayed queued trace from dequeue time while preserving its receipt time", async () => {
  const receivedAt = new Date("2026-04-10T12:00:00.000Z");
  const claimedAt = new Date("2026-04-10T12:30:00.000Z");
  vi.useFakeTimers();
  vi.setSystemTime(claimedAt);
  try {
    const store = new InMemoryPublicIngressStore();
    const ingress = createDeviceSyncPublicIngress({
      publicBaseUrl: "https://sync.example.test/device-sync",
      registry: createDeviceSyncRegistry([
        createFakeProvider({
          async verifyAndParseWebhook({ now }) {
            assert.equal(now, receivedAt.toISOString());
            return {
              externalAccountId: "demo-abc",
              eventType: "demo.updated",
              jobs: [],
              traceId: "queued-trace",
            };
          },
        }),
      ]),
      store,
      hooks: {
        onWebhookAccepted({ account, claimToken, traceId }) {
          return completeWebhookAcceptDurably(store, account, traceId, claimToken);
        },
      },
    });
    const begin = await ingress.startConnection({ provider: "demo" });
    await ingress.handleOAuthCallback({
      code: "abc",
      provider: "demo",
      state: begin.state,
    });

    await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"), receivedAt);

    assert.equal(store.lastWebhookTraceClaim?.receivedAt, receivedAt.toISOString());
    assert.equal(store.lastWebhookTraceClaim?.claimedAt, claimedAt.toISOString());
    assert.equal(
      Date.parse(store.lastWebhookTraceClaim?.processingExpiresAt ?? ""),
      claimedAt.getTime() + 5 * 60 * 1_000,
    );
  } finally {
    vi.useRealTimers();
  }
});

test("public ingress leaves retryable unknown-account webhook traces retryable without running orphan hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownWebhooks: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const expectedExternalAccountHash = sha256Text("demo-late");
  const expectedClientUserHash = sha256Text("demo-client");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
            externalAccountDiagnostic: {
              selectedPath: "$.user_id",
              selectedExternalAccountIdHash: expectedExternalAccountHash,
              candidates: [
                {
                  kind: "external_account_id",
                  path: "$.user_id",
                  selected: true,
                  valueHash: expectedExternalAccountHash,
                },
                {
                  kind: "client_user_id",
                  path: "$.client_user_id",
                  selected: false,
                  valueHash: expectedClientUserHash,
                },
              ],
            },
            eventType: "demo.updated",
            traceId: "trace-late",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ provider, externalAccountId, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        unknownWebhooks.push(`${provider.provider}:${externalAccountId}:${traceId}`);
      },
    },
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-late", "trace-late");
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.deepEqual(unknownWebhooks, []);
  assert.equal(warnContexts.length, 2);
  assert.equal(warnContexts[0]?.externalAccountIdHash, expectedExternalAccountHash);
  assert.equal(warnContexts[0]?.unknownAccountAction, "retry");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
  assert.deepEqual(warnContexts[0]?.externalAccountDiagnostic, {
    selectedPath: "$.user_id",
    selectedExternalAccountIdHash: expectedExternalAccountHash,
    candidates: [
      {
        kind: "external_account_id",
        path: "$.user_id",
        selected: true,
        valueHash: expectedExternalAccountHash,
      },
      {
        kind: "client_user_id",
        path: "$.client_user_id",
        selected: false,
        valueHash: expectedClientUserHash,
      },
    ],
  });
  assert.equal(JSON.stringify(warnContexts).includes("demo-late"), false);
  assert.equal(JSON.stringify(warnContexts).includes("demo-client"), false);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
});

test("public ingress can complete verified unknown-account webhook traces without provider retries", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownCalls: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-race",
            eventType: "demo.updated",
            traceId: "trace-orphan",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ provider, externalAccountId, traceId }) {
        unknownCalls.push(`${provider.provider}:${externalAccountId}:${traceId}`);
      },
    },
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-race", "trace-orphan");
  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.deepEqual(result, {
    accepted: true,
    duplicate: false,
    orphaned: true,
    provider: "demo",
    eventType: "demo.updated",
    traceId: expectedScopedTraceId,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.orphaned, undefined);
  assert.deepEqual(unknownCalls, [`demo:demo-race:${expectedScopedTraceId}`]);
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
  assert.equal(warnContexts[0]?.externalAccountIdHash, sha256Text("demo-race"));
  assert.equal(JSON.stringify(warnContexts).includes("demo-race"), false);
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);
});

test("public ingress accepts provider-requested unknown-account webhooks without an orphan hook", async () => {
  const store = new InMemoryPublicIngressStore();
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-race",
            eventType: "demo.updated",
            traceId: "trace-orphan",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-race", "trace-orphan");
  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.deepEqual(result, {
    accepted: true,
    duplicate: false,
    orphaned: true,
    provider: "demo",
    eventType: "demo.updated",
    traceId: expectedScopedTraceId,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, false);
  assert.equal(warnContexts[0]?.externalAccountIdHash, sha256Text("demo-race"));
  assert.equal(JSON.stringify(warnContexts).includes("demo-race"), false);
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);
});

test("public ingress retries durable webhook work for unknown accounts even when provider asks to accept orphans", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownCalls: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "durable_webhook_work",
            externalAccountId: "demo-late",
            eventType: "demo.updated",
            traceId: "trace-durable-orphan",
            jobs: [
              {
                kind: "resource",
                payload: {
                  resourceId: "resource-1",
                  webhookDataJson: "{\"sample\":true}",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ traceId }) {
        unknownCalls.push(traceId);
      },
    },
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );

  assert.deepEqual(unknownCalls, []);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
  assert.equal(warnContexts[0]?.acceptanceMode, "durable_webhook_work");
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
});

test("public ingress passes only a stripped webhook summary into accepted hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedCalls: Array<{ traceId: string; webhook: DeviceSyncIngressWebhook }> = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-summary",
            occurredAt: "2026-04-11T12:59:00.000Z",
            providerSentAt: "2026-04-11T12:59:30.000Z",
            resourceCategory: "  sleep  ",
            jobs: [
              {
                kind: "resource",
                payload: {
                  resourceId: "resource-1",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        acceptedCalls.push({ traceId, webhook });
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.traceId, scopeWebhookTraceId("demo", "demo-abc", "trace-summary"));
  assert.deepEqual(acceptedCalls, [
    {
      traceId: scopeWebhookTraceId("demo", "demo-abc", "trace-summary"),
      webhook: {
        acceptanceMode: "durable_webhook_work",
        eventType: "demo.updated",
        jobs: [
          {
            kind: "resource",
            payload: {
              resourceId: "resource-1",
            },
          },
        ],
        occurredAt: "2026-04-11T12:59:00.000Z",
        providerSentAt: "2026-04-11T12:59:30.000Z",
        resourceCategory: "sleep",
      },
    },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(acceptedCalls[0]?.webhook ?? {}, "payload"), false);
});

test("public ingress passes the same stripped webhook summary into accepted orphan hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownCalls: Array<{ traceId: string; webhook: DeviceSyncIngressWebhook }> = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
            eventType: "demo.updated",
            traceId: "trace-summary-unknown",
            occurredAt: "2026-04-11T12:59:00.000Z",
            resourceCategory: "  sleep  ",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ traceId, webhook }) {
        unknownCalls.push({ traceId, webhook });
      },
    },
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.orphaned, true);
  assert.deepEqual(unknownCalls, [
    {
      traceId: scopeWebhookTraceId("demo", "demo-late", "trace-summary-unknown"),
      webhook: {
        acceptanceMode: "level_dirty_hint",
        eventType: "demo.updated",
        jobs: [],
        occurredAt: "2026-04-11T12:59:00.000Z",
        resourceCategory: "sleep",
      },
    },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(unknownCalls[0]?.webhook ?? {}, "payload"), false);
});

test("public ingress scopes durable webhook traces by external account while preserving same-account dedupe", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook({ rawBody }) {
          const parsed = JSON.parse(rawBody.toString("utf8")) as {
            externalAccountId: string;
            eventType: string;
            traceId: string;
          };
          return {
            externalAccountId: parsed.externalAccountId,
            eventType: parsed.eventType,
            traceId: parsed.traceId,
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        acceptedWebhooks.push(`${account.id}:${traceId}`);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const firstConnection = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: firstConnection.state,
    code: "a",
  });
  const secondConnection = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: secondConnection.state,
    code: "b",
  });

  const first = await ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from(JSON.stringify({
      externalAccountId: "demo-a",
      eventType: "demo.updated",
      traceId: "provider-event-1",
    })),
  );
  const second = await ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from(JSON.stringify({
      externalAccountId: "demo-b",
      eventType: "demo.updated",
      traceId: "provider-event-1",
    })),
  );
  const duplicate = await ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from(JSON.stringify({
      externalAccountId: "demo-a",
      eventType: "demo.updated",
      traceId: "provider-event-1",
    })),
  );

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.traceId, scopeWebhookTraceId("demo", "demo-a", "provider-event-1"));
  assert.equal(second.traceId, scopeWebhookTraceId("demo", "demo-b", "provider-event-1"));
  assert.equal(duplicate.traceId, first.traceId);
  assert.deepEqual(acceptedWebhooks, [
    `acct_01:${scopeWebhookTraceId("demo", "demo-a", "provider-event-1")}`,
    `acct_02:${scopeWebhookTraceId("demo", "demo-b", "provider-event-1")}`,
  ]);
});

test("public ingress claims and completes already-satisfied dirty hints", async () => {
  const store = new InMemoryPublicIngressStore();
  let alreadySatisfiedCalls = 0;
  let acceptedCalls = 0;
  let observedCalls = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "level_dirty_hint",
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            sourceProviderSlug: "apple_health_kit",
            traceId: "trace-already-dirty",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionSourceObserved({ eventType }) {
        observedCalls += 1;
        assert.equal(eventType, "demo.updated");
        assert.equal(store.claimWebhookTraceCalls, 1);
        return { sourceAdmissionCommitted: true };
      },
      onLevelDirtyWebhookAlreadySatisfied({ webhook }) {
        alreadySatisfiedCalls += 1;
        assert.equal(webhook.acceptanceMode, "level_dirty_hint");
        return { accepted: true };
      },
      onWebhookAccepted() {
        acceptedCalls += 1;
        throw new Error("already-satisfied webhook should not run accepted hook");
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });
  const account = store.getConnectionByExternalAccount("demo", "demo-abc");
  assert.ok(account);
  store.upsertConnectionSource({
    connectionId: account.id,
    sourceInstanceKey: `${account.id}:apple_health_kit`,
    sourceProviderSlug: "apple_health_kit",
    status: "disconnected",
    firstSeenAt: "2026-04-10T00:00:00.000Z",
    lastSeenAt: "2026-04-10T00:00:00.000Z",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.traceId, scopeWebhookTraceId("demo", "demo-abc", "trace-already-dirty"));
  assert.equal(alreadySatisfiedCalls, 1);
  assert.equal(observedCalls, 1);
  assert.equal(acceptedCalls, 0);
  assert.equal(store.claimWebhookTraceCalls, 1);
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(store.getConnectionByExternalAccount("demo", "demo-abc")?.lastWebhookAt, null);
});

test("public ingress finishes source lifecycle before concurrent dirty coalescing completes its trace", async () => {
  const store = new InMemoryPublicIngressStore();
  const order: string[] = [];
  let dirtySatisfied = false;
  let releaseSourceLifecycle!: () => void;
  let signalSourceLifecycleStarted!: () => void;
  const sourceLifecycleReleased = new Promise<void>((resolve) => {
    releaseSourceLifecycle = resolve;
  });
  const sourceLifecycleStarted = new Promise<void>((resolve) => {
    signalSourceLifecycleStarted = resolve;
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook({ rawBody }) {
          const registration = rawBody.toString("utf8") === "registration";
          return {
            acceptanceMode: "level_dirty_hint",
            externalAccountId: "demo-abc",
            eventType: registration ? "provider.connection.created" : "daily.data.updated",
            ...(registration ? { sourceProviderSlug: "apple_health_kit" } : {}),
            traceId: registration ? "trace-registration" : "trace-dirty",
            jobs: [{ kind: "reconcile" }],
          };
        },
      }),
    ]),
    store,
    hooks: {
      async onConnectionSourceObserved({ eventType }) {
        assert.equal(eventType, "provider.connection.created");
        order.push("source:start");
        signalSourceLifecycleStarted();
        await sourceLifecycleReleased;
        order.push("source:complete");
        return { sourceAdmissionCommitted: true };
      },
      onLevelDirtyWebhookAlreadySatisfied({ webhook }) {
        if (webhook.eventType === "provider.connection.created") {
          assert.equal(dirtySatisfied, true);
          order.push("registration:dirty-coalesced");
          return { accepted: true };
        }
        return null;
      },
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        assert.equal(webhook.eventType, "daily.data.updated");
        dirtySatisfied = true;
        order.push("dirty:accepted");
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({ provider: "demo", state: begin.state, code: "abc" });
  const account = store.getConnectionByExternalAccount("demo", "demo-abc");
  assert.ok(account);
  store.upsertConnectionSource({
    connectionId: account.id,
    sourceInstanceKey: `${account.id}:apple_health_kit`,
    sourceProviderSlug: "apple_health_kit",
    status: "disconnected",
    firstSeenAt: "2026-04-10T00:00:00.000Z",
    lastSeenAt: "2026-04-10T00:00:00.000Z",
  });

  const registration = ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from("registration"),
  );
  await sourceLifecycleStarted;

  await ingress.handleWebhook("demo", new Headers(), Buffer.from("dirty"));
  releaseSourceLifecycle();
  const registered = await registration;
  const replay = await ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from("registration"),
  );

  assert.equal(registered.accepted, true);
  assert.equal(registered.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(order, [
    "source:start",
    "dirty:accepted",
    "source:complete",
    "registration:dirty-coalesced",
  ]);
  assert.equal(store.completedWebhookTraceCalls, 2);
});

test("public ingress completes a source-registration trace after target cleanup", async () => {
  const store = new InMemoryPublicIngressStore();
  let acceptedCalls = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "level_dirty_hint",
            externalAccountId: "demo-abc",
            eventType: "provider.connection.created",
            sourceProviderSlug: "apple_health_kit",
            traceId: "trace-cleaned-registration",
            jobs: [{ kind: "reconcile" }],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionSourceObserved() {
        return { sourceRegistrationRemoved: true };
      },
      onLevelDirtyWebhookAlreadySatisfied() {
        throw new Error("cleaned source registration must not reach dirty coalescing");
      },
      onWebhookAccepted() {
        acceptedCalls += 1;
        throw new Error("cleaned source registration must not reach durable acceptance");
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({ provider: "demo", state: begin.state, code: "abc" });
  const account = store.getConnectionByExternalAccount("demo", "demo-abc");
  assert.ok(account);
  store.upsertConnectionSource({
    connectionId: account.id,
    sourceInstanceKey: `${account.id}:apple_health_kit`,
    sourceProviderSlug: "apple_health_kit",
    status: "disconnected",
    firstSeenAt: "2026-04-10T00:00:00.000Z",
    lastSeenAt: "2026-04-10T00:00:00.000Z",
    lastErrorCode: "SOURCE_USER_DISCONNECTED",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(acceptedCalls, 0);
  assert.equal(store.claimWebhookTraceCalls, 1);
  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress records no source arrival when durable acceptance fails", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            dataSourceProviderSlug: "garmin",
            externalAccountId: "demo-abc",
            eventType: "daily.data.sleep.created",
            traceId: "trace-acceptance-failure",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted() {
        throw new Error("durable acceptance failed");
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    /durable acceptance failed/u,
  );

  // Stamping an arrival for a payload that was never durably accepted would
  // report a stalled carrier as healthy.
  assert.deepEqual(store.recordedSourceDataArrivals, []);
});

test("public ingress does not use already-satisfied coalescing for durable webhook work", async () => {
  const store = new InMemoryPublicIngressStore();
  let alreadySatisfiedCalls = 0;
  let acceptedCalls = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "durable_webhook_work",
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-payload",
            jobs: [
              {
                kind: "resource",
                payload: {
                  webhookDataJson: "{\"sample\":true}",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onLevelDirtyWebhookAlreadySatisfied() {
        alreadySatisfiedCalls += 1;
        return { accepted: true };
      },
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        acceptedCalls += 1;
        assert.equal(webhook.acceptanceMode, "durable_webhook_work");
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(alreadySatisfiedCalls, 0);
  assert.equal(acceptedCalls, 1);
  assert.equal(store.claimWebhookTraceCalls, 1);
  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress marks disconnected-account webhook traces processed so delayed duplicates stay suppressed", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.deleted",
            traceId: "trace-inactive",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        acceptedWebhooks.push(account.id);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });
  const prepared = await ingress.prepareWebhookForDurableEnqueue(
    "demo",
    new Headers(),
    Buffer.from("{}"),
    new Date("2026-04-10T12:00:00.000Z"),
  );
  store.patchAccountStatus(connected.account.id, "disconnected");

  const first = await ingress.handlePreparedWebhook(prepared);
  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-abc", "trace-inactive");
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.traceId, expectedScopedTraceId);
  assert.deepEqual(acceptedWebhooks, []);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);

  const duplicate = await ingress.handlePreparedWebhook(prepared);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.traceId, expectedScopedTraceId);
  assert.deepEqual(acceptedWebhooks, []);
  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress leaves reauthorization-required webhook traces retryable until the account is reconnected", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-reauthorization",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        acceptedWebhooks.push(account.id);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });
  store.patchAccountStatus(connected.account.id, "reauthorization_required");

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );

  assert.deepEqual(acceptedWebhooks, []);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
});

test("public ingress leaves the webhook trace retryable when the durable acceptance hook fails", async () => {
  const store = new InMemoryPublicIngressStore();
  let attempts = 0;
  let successes = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-retryable",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("transient enqueue failure");
        }

        successes += 1;
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await assert.rejects(() => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")), /transient enqueue failure/u);
  assert.equal(attempts, 1);
  assert.equal(successes, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);

  const retry = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, false);
  assert.equal(attempts, 2);
  assert.equal(successes, 1);
  const recordedRetryableTrace = readRecordedWebhookTrace(store);
  assert.ok(recordedRetryableTrace);
  assert.equal(recordedRetryableTrace.traceId, scopeWebhookTraceId("demo", "demo-abc", "trace-retryable"));

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.duplicate, true);
  assert.equal(attempts, 2);
  assert.equal(successes, 1);
});

test("public ingress does not stamp lastWebhookAt when durable acceptance fails", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-no-stamp",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted() {
        throw new Error("transient enqueue failure");
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await assert.rejects(() => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")), /transient enqueue failure/u);
  assert.equal(store.lastRecordedWebhookTrace, null);
  assert.equal(store.getConnectionByExternalAccount("demo", connected.account.externalAccountId)?.lastWebhookAt, null);
});

test("public ingress keeps accepted webhook traces when only receipt timestamp persistence fails", async () => {
  const store = new InMemoryPublicIngressStore();
  const warn = vi.fn();
  store.markWebhookReceived = () => {
    throw new Error("mark failed");
  };

  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-mark-failure",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    log: { warn },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.deepEqual(result, {
    accepted: true,
    duplicate: false,
    provider: "demo",
    eventType: "demo.updated",
    traceId: scopeWebhookTraceId("demo", "demo-abc", "trace-mark-failure"),
  });
  assert.equal(
    store.lastRecordedWebhookTrace?.traceId,
    scopeWebhookTraceId("demo", "demo-abc", "trace-mark-failure"),
  );
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(warn.mock.calls.length, 1);
});

test("public ingress records source data arrival only for payloads that carried data", async () => {
  async function handleWebhookWith(parsed: {
    dataSourceProviderSlug?: string | null;
    eventType: string;
    traceId: string;
  }) {
    const store = new InMemoryPublicIngressStore();
    const ingress = createDeviceSyncPublicIngress({
      publicBaseUrl: "https://sync.example.test/device-sync",
      registry: createDeviceSyncRegistry([
        createFakeProvider({
          async verifyAndParseWebhook() {
            return {
              externalAccountId: "demo-abc",
              jobs: [],
              ...parsed,
            };
          },
        }),
      ]),
      store,
    });

    const begin = await ingress.startConnection({ provider: "demo" });
    const connected = await ingress.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "abc",
    });

    await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

    return { connected, store };
  }

  const delivered = await handleWebhookWith({
    dataSourceProviderSlug: "garmin",
    eventType: "daily.data.sleep.created",
    traceId: "trace-source-data",
  });
  assert.deepEqual(delivered.store.recordedSourceDataArrivals, [
    {
      connectionId: delivered.connected.account.id,
      sourceProviderSlug: "garmin",
    },
  ]);

  // A connection lifecycle event proves nothing about the data carrier, so it
  // must not refresh the arrival signal a stalled source is measured against.
  const lifecycle = await handleWebhookWith({
    dataSourceProviderSlug: null,
    eventType: "provider.connection.created",
    traceId: "trace-source-lifecycle",
  });
  assert.deepEqual(lifecycle.store.recordedSourceDataArrivals, []);
});

test("public ingress keeps accepted webhooks when only source arrival persistence fails", async () => {
  const store = new InMemoryPublicIngressStore();
  const warn = vi.fn();
  store.markConnectionSourceDataReceived = () => {
    throw new Error("arrival write failed");
  };

  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            dataSourceProviderSlug: "garmin",
            externalAccountId: "demo-abc",
            eventType: "daily.data.sleep.created",
            traceId: "trace-arrival-failure",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    log: { warn },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(warn.mock.calls.length, 1);
});

test("public ingress omits provider-supplied OAuth error descriptions from warning logs", async () => {
  const store = new InMemoryPublicIngressStore();
  const warn = vi.fn();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
    log: { warn },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        error: "access_denied",
        errorDescription: "<REDACTED_PROVIDER_ERROR_DESCRIPTION>",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError && error.code === "OAUTH_CALLBACK_REJECTED",
  );

  assert.equal(store.hasOAuthClaim(begin.state), false);
  assert.equal(warn.mock.calls.length, 1);
  assert.deepEqual(warn.mock.calls[0]?.[1], {
    provider: "demo",
    callbackError: "access_denied",
  });
});

test("public ingress hashes unknown external account ids before logging them", async () => {
  const store = new InMemoryPublicIngressStore();
  const warn = vi.fn();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-unknown",
            eventType: "demo.updated",
            traceId: "trace-unknown-account",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    log: { warn },
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.equal(warn.mock.calls.length, 1);
  assert.deepEqual(warn.mock.calls[0]?.[1], {
    provider: "demo",
    externalAccountIdHash: sha256Text("demo-unknown"),
    eventType: "demo.updated",
    traceId: scopeWebhookTraceId("demo", "demo-unknown", "trace-unknown-account"),
    acceptanceMode: "durable_webhook_work",
    unknownAccountAction: "retry",
    unknownWebhookHookConfigured: false,
  });
});

test("public ingress rejects overlapping active webhook deliveries until the first claim finishes", async () => {
  const store = new InMemoryPublicIngressStore();
  let acceptedCalls = 0;
  let releaseProcessing: (() => void) | null = null;
  const enteredProcessing = new Promise<void>((resolve) => {
    releaseProcessing = resolve;
  });
  let unblockProcessing: (() => void) | null = null;
  const processingGate = new Promise<void>((resolve) => {
    unblockProcessing = resolve;
  });

  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-overlap",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      async onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        acceptedCalls += 1;
        releaseProcessing?.();
        await processingGate;
        assert.equal("traceId" in webhook, false);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const firstWebhook = ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  await enteredProcessing;

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_TRACE_IN_PROGRESS"
      && error.httpStatus === 503
      && error.retryable === true,
  );

  requireCallback(unblockProcessing, "processing gate was not initialized")();
  const firstResult = await firstWebhook;
  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-abc", "trace-overlap");

  assert.equal(firstResult.accepted, true);
  assert.equal(firstResult.duplicate, false);
  assert.equal(firstResult.traceId, expectedScopedTraceId);
  assert.equal(acceptedCalls, 1);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.traceId, expectedScopedTraceId);
  assert.equal(acceptedCalls, 1);
});

test("public ingress releases claimed traces when the accepted hook returns without an explicit completion receipt", async () => {
  const store = new InMemoryPublicIngressStore();
  let attempts = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-missing-receipt",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        attempts += 1;
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  Object.defineProperty(ingress, "hooks", {
    configurable: true,
    value: {
      onWebhookAccepted({ account, claimToken, traceId }: DeviceSyncPublicIngressWebhookAcceptedInput) {
        attempts += 1;

        if (attempts > 1) {
          return completeWebhookAcceptDurably(store, account, traceId, claimToken);
        }

        return undefined;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_TRACE_COMPLETION_REQUIRED"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.equal(attempts, 1);
  assert.equal(store.lastRecordedWebhookTrace, null);

  const retry = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-abc", "trace-missing-receipt");

  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, false);
  assert.equal(retry.traceId, expectedScopedTraceId);
  assert.equal(attempts, 2);
  const recordedTrace = readRecordedWebhookTrace(store);
  assert.ok(recordedTrace);
  assert.equal(recordedTrace.traceId, expectedScopedTraceId);
});

test("public ingress preserves callback redirect context on OAuth callback failures", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
  });

  const begin = await ingress.startConnection({
    connectSourceId: "garmin",
    connectTarget: "garmin",
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
    sourceProviderSlug: "garmin",
  });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        error: "access_denied",
        errorDescription: "The user canceled the OAuth flow.",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OAUTH_CALLBACK_REJECTED" &&
      error.message === "OAuth authorization was denied or canceled." &&
      error.details?.connectSourceId === "garmin" &&
      error.details?.connectTarget === "garmin" &&
      error.details?.provider === "demo" &&
      error.details?.returnTo === "https://app.example.test/settings/devices",
  );
});

test("public ingress passes connect source context to connection-established hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const connectionEvents: DeviceSyncPublicIngressConnectionEstablishedInput[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
    hooks: {
      onConnectionEstablished(event) {
        connectionEvents.push(event);
      },
    },
  });

  const begin = await ingress.startConnection({
    connectSourceId: "garmin",
    connectTarget: "garmin",
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
    sourceProviderSlug: "garmin",
  });

  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connectionEvents.length, 1);
  assert.equal(connectionEvents[0]?.account.id, connected.account.id);
  assert.equal(connectionEvents[0]?.connectSourceId, "garmin");
  assert.equal(connectionEvents[0]?.connectTarget, "garmin");
  assert.equal(
    connectionEvents[0]?.connectionStartedAt,
    store.lastCreatedOAuthState?.createdAt,
  );
  assert.equal(connectionEvents[0]?.sourceProviderSlug, "garmin");
  assert.equal(connected.sourceProviderSlug, "garmin");
});

test("public ingress retains the claim when provider revoke and cleanup-owner persistence fail", async () => {
  const persistError = new Error("persist failed before connection storage");
  const revokeCalls: Array<{ accessToken: string; externalAccountId: string }> = [];
  const warnEvents: Array<{ context?: Record<string, unknown>; message: string }> = [];

  class FailingUpsertStore extends InMemoryPublicIngressStore {
    override upsertConnection(_input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount {
      throw persistError;
    }
  }

  const store = new FailingUpsertStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          const tokens = getDeviceSyncAccountOAuthTokens(account);
          assert.ok(tokens);
          revokeCalls.push({
            accessToken: tokens.accessToken,
            externalAccountId: account.externalAccountId,
          });
          throw new Error("cleanup revoke failed");
        },
      }),
    ]),
    store,
    log: {
      warn(message, context) {
        warnEvents.push({
          context: context as Record<string, unknown> | undefined,
          message,
        });
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "abc",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_SETUP_CLEANUP_FAILED"
      && error.cause === persistError,
  );

  assert.deepEqual(revokeCalls, []);
  assert.equal(warnEvents.length, 1);
  assert.equal(warnEvents[0]?.message, "Failed to persist provider cleanup ownership after OAuth setup failure.");
  assert.equal(warnEvents[0]?.context?.failureCode, "DEVICE_SYNC_OAUTH_CLEANUP_OWNER_PERSIST_FAILED");
  assert.deepEqual(warnEvents[0]?.context?.error, {
    category: "unexpected_error",
    message: "persist failed before connection storage",
    name: "Error",
  });
  assert.equal(warnEvents[0]?.context?.provider, "demo");
  assert.equal(store.hasOAuthState(begin.state), false);
  assert.equal(store.hasOAuthClaim(begin.state), true);
  assert.equal(store.getConnectionByExternalAccount("demo", "demo-abc"), null);
});

test("public ingress persists cleanup ownership when provider revoke fails after a transient write failure", async () => {
  const persistError = new Error("transient persist failure");
  class FailFirstUpsertStore extends InMemoryPublicIngressStore {
    private shouldFail = true;

    override upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount {
      if (this.shouldFail) {
        this.shouldFail = false;
        throw persistError;
      }
      return super.upsertConnection(input);
    }
  }
  const store = new FailFirstUpsertStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess() {
          throw new Error("provider revoke unavailable");
        },
      }),
    ]),
    store,
  });
  const begin = await ingress.startConnection({
    ownerId: "member_a",
    provider: "demo",
  });

  await assert.rejects(
    () => ingress.handleOAuthCallback({
      expectedOwnerId: "member_a",
      provider: "demo",
      state: begin.state,
      code: "cleanup-owner",
    }),
    (error: unknown) => error === persistError,
  );

  const cleanupOwner = store.getConnectionByExternalAccount(
    "demo",
    "demo-cleanup-owner",
  );
  assert.ok(cleanupOwner);
  assert.equal(cleanupOwner.status, "reauthorization_required");
  assert.equal(cleanupOwner.setupPhase, "failed");
  assert.equal(store.getConnectionCredential(cleanupOwner.id)?.kind, "oauth_tokens");
  assert.equal(store.hasOAuthClaim(begin.state), false);
});

test("public ingress revokes and marks setup failure after post-persistence OAuth hook failures", async () => {
  const store = new InMemoryPublicIngressStore();
  const revokeCalls: string[] = [];
  const hookError = new Error(
    "post-persist hook failure for https://provider.example.test/oauth/user@example.test at '/tmp/device-sync/oauth' while notifying (415) 555-0100",
  );
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          const failed = store.getConnectionByExternalAccount("demo", account.externalAccountId);
          assert.equal(failed?.status, "reauthorization_required");
          assert.equal(store.getConnectionCredential(failed!.id)?.kind, "oauth_tokens");
          revokeCalls.push(account.externalAccountId);
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished({ account }) {
        store.markWebhookReceived(account.id, "2099-04-26T23:59:59.000Z");
        throw hookError;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "persisted",
      }),
    (error: unknown) => error === hookError,
  );

  assert.deepEqual(revokeCalls, ["demo-persisted"]);
  assert.equal(store.hasOAuthState(begin.state), false);
  const storedAccount = store.getConnectionByExternalAccount("demo", "demo-persisted");
  assert.ok(storedAccount);
  assert.equal(storedAccount.id, "acct_01");
  assert.equal(storedAccount.status, "reauthorization_required");
  assert.equal(storedAccount.lastWebhookAt, "2099-04-26T23:59:59.000Z");
  assert.equal(storedAccount.accessTokenExpiresAt, null);
  assert.equal(storedAccount.lastErrorCode, "OAUTH_SETUP_FAILED");
  assert.equal(
    storedAccount.lastErrorMessage,
    "post-persist hook failure for <redacted-url> at '<redacted-path>' while notifying <redacted-phone>",
  );
  assert.ok(storedAccount.lastSyncErrorAt);
  assert.equal(storedAccount.nextReconcileAt, null);
  assert.equal(store.getConnectionCredential(storedAccount.id)?.kind, "none");
});

test("public ingress retains durable OAuth authority when post-persistence revoke is ambiguous", async () => {
  const store = new InMemoryPublicIngressStore();
  const hookError = new Error("post-persist hook failure");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          const failed = store.getConnectionByExternalAccount("demo", account.externalAccountId);
          assert.equal(failed?.status, "reauthorization_required");
          assert.equal(store.getConnectionCredential(failed!.id)?.kind, "oauth_tokens");
          throw new Error("provider revoke result unavailable");
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        throw hookError;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await assert.rejects(
    () => ingress.handleOAuthCallback({
      code: "persisted-ambiguous-revoke",
      provider: "demo",
      state: begin.state,
    }),
    (error: unknown) => error === hookError,
  );

  const failed = store.getConnectionByExternalAccount(
    "demo",
    "demo-persisted-ambiguous-revoke",
  );
  assert.equal(failed?.setupPhase, "failed");
  assert.equal(failed?.status, "reauthorization_required");
  assert.equal(store.getConnectionCredential(failed!.id)?.kind, "oauth_tokens");
});

test("public ingress does not revoke or clear while token refresh ownership is in flight", async () => {
  class RefreshLeasedStore extends InMemoryPublicIngressStore {
    override markConnectionSetupFailed(input: Parameters<InMemoryPublicIngressStore["markConnectionSetupFailed"]>[0]) {
      const account = this.getConnectionById(input.accountId);
      return {
        account,
        applied: false,
        blockedByRefreshLease: true,
        oauthTokenVersion: 1,
      };
    }
  }
  const store = new RefreshLeasedStore();
  const revokeAccess = vi.fn();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({ revokeAccess }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        throw new Error("post-persist hook failure");
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await assert.rejects(() => ingress.handleOAuthCallback({
    code: "refresh-leased",
    provider: "demo",
    state: begin.state,
  }));

  const account = store.getConnectionByExternalAccount("demo", "demo-refresh-leased");
  assert.equal(account?.status, "active");
  assert.equal(store.getConnectionCredential(account!.id)?.kind, "oauth_tokens");
  assert.equal(revokeAccess.mock.calls.length, 0);
});

test("public ingress retains persisted cleanup ownership when failure marking is unavailable", async () => {
  const store = new InMemoryPublicIngressStore();
  const revokeCalls: string[] = [];
  const hookError = new Error("post-persist hook failure");
  store.markConnectionSetupFailedError = new Error("setup failure mark failed");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          revokeCalls.push(account.externalAccountId);
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        throw hookError;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "persisted",
      }),
    (error: unknown) => error === hookError,
  );

  assert.deepEqual(revokeCalls, []);
  assert.equal(store.hasOAuthState(begin.state), false);
  assert.equal(store.hasOAuthClaim(begin.state), false);
  assert.equal(
    store.getConnectionByExternalAccount("demo", "demo-persisted")?.status,
    "active",
  );
});

test("public ingress skips provider revocation when post-persistence setup cleanup loses its epoch", async () => {
  const store = new InMemoryPublicIngressStore();
  const revokeCalls: string[] = [];
  const hookError = new Error("post-persist hook failure");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          revokeCalls.push(account.externalAccountId);
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished({ account }) {
        store.upsertConnection({
          provider: account.provider,
          externalAccountId: account.externalAccountId,
          displayName: "New connection epoch",
          scopes: account.scopes,
          tokens: {
            accessToken: "<REDACTED_NEW_ACCESS_TOKEN>",
            refreshToken: "<REDACTED_NEW_REFRESH_TOKEN>",
          },
          existingAccountPolicy: "replace",
          metadata: { connectionEpoch: "new" },
          connectedAt: "2099-04-27T00:00:00.000Z",
          nextReconcileAt: null,
        });
        throw hookError;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "persisted",
      }),
    (error: unknown) => error === hookError,
  );

  assert.deepEqual(revokeCalls, []);
  assert.equal(store.hasOAuthState(begin.state), false);
  const storedAccount = store.getConnectionByExternalAccount("demo", "demo-persisted");
  assert.equal(storedAccount?.status, "active");
  assert.equal(storedAccount?.connectedAt, "2099-04-27T00:00:00.000Z");
  assert.deepEqual(storedAccount?.metadata, { connectionEpoch: "new" });
});

test("public ingress does not burn valid oauth state on provider mismatch", async () => {
  const store = new InMemoryPublicIngressStore();
  const whoopBase = createFakeProvider();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([
      createFakeProvider(),
      createFakeProvider({
        provider: "whoop",
        descriptor: {
          ...whoopBase.descriptor,
          displayName: "Whoop",
          oauth: {
            ...whoopBase.descriptor.oauth,
            callbackPath: "/oauth/whoop/callback",
            defaultScopes: ["offline", "read:data"],
          },
          provider: "whoop",
        },
      }),
    ]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "whoop",
        state: begin.state,
        code: "wrong-provider",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OAUTH_PROVIDER_MISMATCH" &&
      error.httpStatus === 400,
  );
  assert.equal(store.hasOAuthState(begin.state), true);

  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.provider, "demo");
  assert.equal(store.hasOAuthState(begin.state), false);
});

test("public ingress does not burn valid oauth state on owner mismatch", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider();
  const connectionHandler = provider.connectionHandler;
  assert.ok(connectionHandler);
  const completeConnection = vi.spyOn(connectionHandler, "completeConnection");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    ownerId: "member_a",
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        expectedOwnerId: "member_b",
        provider: "demo",
        state: begin.state,
        code: "abc",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OAUTH_STATE_OWNER_MISMATCH" &&
      error.httpStatus === 403,
  );
  assert.equal(store.hasOAuthState(begin.state), true);
  assert.equal(completeConnection.mock.calls.length, 0);

  const connected = await ingress.handleConnectionCallback({
    expectedOwnerId: "member_a",
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.provider, "demo");
  assert.equal(store.hasOAuthState(begin.state), false);
  assert.equal(completeConnection.mock.calls.length, 1);
});

test("public ingress discards tampered persisted returnTo values before reuse", async () => {
  const store = new InMemoryPublicIngressStore();
  store.createOAuthState({
    state: "tampered-state",
    provider: "demo",
    returnTo: "javascript:alert(1)",
    metadata: {},
    createdAt: "2099-05-24T00:00:00.000Z",
    expiresAt: "2099-05-24T01:00:00.000Z",
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
  });

  try {
    const connected = await ingress.handleOAuthCallback({
      provider: "demo",
      state: "tampered-state",
      code: "abc",
    });

    assert.equal(connected.returnTo, null);
    assert.equal(warnSpy.mock.calls.length, 1);
  } finally {
    warnSpy.mockRestore();
  }
});

test("public ingress preserves non-device-sync callback errors without wrapping them", async () => {
  const expected = new Error("unexpected oauth exchange failure");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async exchangeAuthorizationCode() {
          throw expected;
        },
      }),
    ]),
    store: new InMemoryPublicIngressStore(),
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "abc",
      }),
    (error: unknown) => error === expected,
  );
});

test("public ingress rejects unknown providers before creating OAuth state", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store: new InMemoryPublicIngressStore(),
  });

  await assert.rejects(
    () => ingress.startConnection({ provider: "missing-provider" }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "PROVIDER_NOT_REGISTERED" &&
      error.httpStatus === 404,
  );
});

test("public ingress releases unknown-account webhook traces when the unknown hook fails", async () => {
  const store = new InMemoryPublicIngressStore();
  let unknownAttempts = 0;
  const warnMessages: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
            eventType: "demo.updated",
            traceId: "trace-release-on-error",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      async onUnknownWebhook() {
        unknownAttempts += 1;
        throw new Error("transient unknown-account hook failure");
      },
    },
    log: {
      warn(message, context) {
        warnMessages.push(message);
        warnContexts.push(context ?? {});
      },
    },
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    /transient unknown-account hook failure/u,
  );
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    /transient unknown-account hook failure/u,
  );

  assert.equal(unknownAttempts, 2);
  assert.equal(
    warnMessages.filter((message) =>
      message === "Failed to run unknown device sync webhook hook; releasing orphan trace for retry."
    ).length,
    2,
  );
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
  assert.equal(warnContexts[0]?.externalAccountIdHash, sha256Text("demo-late"));
  assert.equal(JSON.stringify(warnContexts).includes("demo-late"), false);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
});

test("public ingress rejects protocol-relative, backslash-prefixed, and credential-bearing returnTo values", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store: new InMemoryPublicIngressStore(),
  });

  for (const returnTo of [
    "//evil.test/steal",
    "/\\evil.test",
    "/settings\nsteal",
    "https://operator:secret@app.example.test/settings/devices",
  ]) {
    await assert.rejects(
      () =>
        ingress.startConnection({
          provider: "demo",
          returnTo,
        }),
      (error: unknown) =>
        error instanceof DeviceSyncError &&
        error.code === "RETURN_TO_INVALID" &&
        error.httpStatus === 400,
    );
  }
});

test("public ingress stores webhook receipt timestamps using ingestion time, not provider event time", async () => {
  const store = new InMemoryPublicIngressStore();
  const observedAcceptedAt: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-received-at",
            occurredAt: "2026-03-01T00:00:00.000Z",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook, now }) {
        assert.equal("traceId" in webhook, false);
        observedAcceptedAt.push(now);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(observedAcceptedAt.length, 1);
  assert.equal(store.lastRecordedWebhookTrace?.receivedAt, observedAcceptedAt[0]);
  assert.equal(store.getConnectionByExternalAccount("demo", "demo-abc")?.lastWebhookAt, observedAcceptedAt[0]);
  assert.notEqual(store.lastRecordedWebhookTrace?.receivedAt, "2026-03-01T00:00:00.000Z");
  assert.notEqual(
    store.getConnectionByExternalAccount("demo", connected.account.externalAccountId)?.lastWebhookAt,
    "2026-03-01T00:00:00.000Z",
  );
});

test("public ingress does not complete a claimed webhook trace twice when the durable hook already owns completion", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress rejects built-in OAuth callback jobs that drift from the provider manifest", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        provider: "strava",
        descriptor: {
          provider: "strava",
          displayName: "Strava",
          transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
          oauth: {
            callbackPath: "/oauth/strava/callback",
            defaultScopes: ["activity:read"],
          },
          webhook: {
            path: "/webhooks/strava",
            deliveryMode: "notification",
            supportsAdmin: false,
          },
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: {
              activity: 50,
            },
          },
        },
        async exchangeAuthorizationCode(_context, code) {
          return {
            externalAccountId: `strava-${code}`,
            displayName: `Strava ${code}`,
            scopes: ["activity:read"],
            metadata: {},
            tokens: {
              accessToken: "<REDACTED_ACCESS_TOKEN>",
              refreshToken: "<REDACTED_REFRESH_TOKEN>",
            },
            initialJobs: [
              {
                kind: "backfill",
                payload: {
                  unexpected: true,
                },
              },
            ],
            nextReconcileAt: "2026-03-24T00:00:00.000Z",
          };
        },
      }),
    ]),
    store,
  });

  const begin = await ingress.startConnection({ provider: "strava" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "strava",
        state: begin.state,
        code: "abc",
      }),
    /not declared in the provider manifest/u,
  );

  assert.equal(
    store.getConnectionByExternalAccount("strava", "strava-abc")?.status,
    "reauthorization_required",
  );
});

test("public ingress rejects built-in webhook jobs that drift from the provider manifest before durable trace claim", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        provider: "whoop",
        descriptor: {
          provider: "whoop",
          displayName: "WHOOP",
          transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
          oauth: {
            callbackPath: "/oauth/whoop/callback",
            defaultScopes: ["offline"],
          },
          webhook: {
            path: "/webhooks/whoop",
            deliveryMode: "notification",
            supportsAdmin: false,
          },
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: {
              activity: 50,
            },
          },
        },
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "whoop-abc",
            eventType: "sleep.updated",
            traceId: "trace-1",
            jobs: [
              {
                kind: "resource",
                payload: {
                  resourceId: 123,
                  resourceType: "sleep",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
  });

  await assert.rejects(
    () => ingress.handleWebhook("whoop", new Headers(), Buffer.from("{}")),
    /resourceId must be a string/u,
  );

  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(readRecordedWebhookTrace(store), null);
});

test("public ingress SDK sign-in session ensures the account before minting and stays idempotent", async () => {
  const store = new InMemoryPublicIngressStore();
  const connectionEvents: Array<{ accountId: string; initialJobs: number }> = [];
  const orderOfOperations: string[] = [];
  let mintedTokens = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        sdkConnectionHandler: {
          async ensureConnection(input) {
            orderOfOperations.push(`ensure:${input.ownerId}`);
            return {
              externalAccountId: "demo-sdk-user-1",
              displayName: "Demo",
              scopes: [],
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
              setupPhase: "source_confirmed",
              initialJobs: [
                {
                  kind: "backfill",
                  payload: {
                    windowStart: "2026-01-01T00:00:00.000Z",
                  },
                },
              ],
              nextReconcileAt: "2026-03-24T00:00:00.000Z",
            };
          },
          async createSignInToken(input) {
            orderOfOperations.push(`mint:${input.externalAccountId}`);
            mintedTokens += 1;
            return {
              signInToken: `sdk-sign-in-token-${mintedTokens}`,
              environment: "sandbox",
            };
          },
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished({ account, connection }) {
        connectionEvents.push({
          accountId: account.id,
          initialJobs: connection.initialJobs?.length ?? 0,
        });
      },
    },
  });

  const first = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });

  assert.equal(first.signInToken, "sdk-sign-in-token-1");
  assert.equal(first.environment, "sandbox");
  assert.equal(first.account.externalAccountId, "demo-sdk-user-1");
  assert.equal(first.account.status, "active");
  assert.equal(first.account.setupPhase, "source_confirmed");
  // The account must exist before the token is minted so SDK webhooks are
  // never orphan-delayed behind a token-only exchange.
  assert.deepEqual(orderOfOperations, ["ensure:member-1", "mint:demo-sdk-user-1"]);

  const second = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });

  // Idempotent ensure: the second call resolves the same account row.
  assert.equal(second.account.id, first.account.id);
  assert.equal(second.signInToken, "sdk-sign-in-token-2");
  assert.deepEqual(orderOfOperations, [
    "ensure:member-1",
    "mint:demo-sdk-user-1",
    "ensure:member-1",
    "mint:demo-sdk-user-1",
  ]);
  assert.equal(store.upsertConnectionCalls, 1);
  assert.deepEqual(connectionEvents, [
    { accountId: first.account.id, initialJobs: 1 },
  ]);

  // The webhook resolver sees the ensured account through the same
  // external-account lookup ingestion uses.
  const resolved = await store.getConnectionByExternalAccount("demo", "demo-sdk-user-1");
  assert.equal(resolved?.id, first.account.id);
  assert.equal(resolved?.status, "active");
});

test("public ingress SDK sign-in session intentionally reconnects a disconnected account", async () => {
  const store = new InMemoryPublicIngressStore();
  let connectionEstablishedEvents = 0;
  let mintedTokens = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        sdkConnectionHandler: {
          async ensureConnection() {
            return {
              externalAccountId: "demo-sdk-user-1",
              displayName: "Demo",
              scopes: [],
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
              setupPhase: "source_confirmed",
            };
          },
          async createSignInToken() {
            mintedTokens += 1;
            return {
              signInToken: `sdk-sign-in-token-${mintedTokens}`,
              environment: "sandbox",
            };
          },
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        connectionEstablishedEvents += 1;
      },
    },
  });

  const first = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });
  store.patchAccountStatus(first.account.id, "disconnected");
  assert.equal(
    store.getConnectionByExternalAccount("demo", "demo-sdk-user-1")?.status,
    "disconnected",
  );

  const reconnected = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });

  assert.equal(reconnected.account.id, first.account.id);
  assert.equal(reconnected.account.status, "active");
  assert.equal(reconnected.account.setupPhase, "source_confirmed");
  assert.equal(reconnected.signInToken, "sdk-sign-in-token-2");
  assert.equal(store.upsertConnectionCalls, 2);
  assert.equal(connectionEstablishedEvents, 2);
});

test("public ingress SDK sign-in resume mints against the exact active account without lifecycle writes", async () => {
  const store = new InMemoryPublicIngressStore();
  let connectionEstablishedEvents = 0;
  let ensureConnectionCalls = 0;
  let mintedTokens = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        sdkConnectionHandler: {
          async ensureConnection() {
            ensureConnectionCalls += 1;
            return {
              externalAccountId: "demo-sdk-user-1",
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
              setupPhase: "source_confirmed",
            };
          },
          async createSignInToken() {
            mintedTokens += 1;
            return {
              signInToken: `sdk-sign-in-token-${mintedTokens}`,
              environment: "sandbox",
            };
          },
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        connectionEstablishedEvents += 1;
      },
    },
  });

  const connected = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });
  const resumed = await ingress.resumeSdkSignInSession({
    accountId: connected.account.id,
    provider: "demo",
    ownerId: "member-1",
  });

  assert.equal(resumed.account.id, connected.account.id);
  assert.equal(resumed.signInToken, "sdk-sign-in-token-2");
  assert.equal(ensureConnectionCalls, 1);
  assert.equal(store.upsertConnectionCalls, 1);
  assert.equal(connectionEstablishedEvents, 1);
});

test("public ingress SDK sign-in resume rejects terminal, missing, mismatched, and foreign accounts", async () => {
  const store = new InMemoryPublicIngressStore();
  let ensureConnectionCalls = 0;
  let mintedTokens = 0;
  const sdkConnectionHandler = {
    async ensureConnection() {
      ensureConnectionCalls += 1;
      return {
        externalAccountId: "demo-sdk-user-1",
        tokens: {
          accessToken: "<REDACTED_ACCESS_TOKEN>",
        } satisfies ProviderAuthTokens,
        setupPhase: "source_confirmed" as const,
      };
    },
    async createSignInToken() {
      mintedTokens += 1;
      return {
        signInToken: `sdk-sign-in-token-${mintedTokens}`,
        environment: "sandbox" as const,
      };
    },
  };
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({ sdkConnectionHandler }),
      createFakeProvider({ provider: "other", sdkConnectionHandler }),
    ]),
    store,
  });
  const connected = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });
  const expectResumeRejected = async (input: {
    accountId: string;
    provider: string;
    ownerId: string;
  }) => {
    await assert.rejects(
      () => ingress.resumeSdkSignInSession(input),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "SDK_SIGN_IN_RECONNECT_REQUIRED"
        && error.httpStatus === 409,
    );
  };

  store.patchAccountStatus(connected.account.id, "disconnected");
  await expectResumeRejected({
    accountId: connected.account.id,
    provider: "demo",
    ownerId: "member-1",
  });
  store.patchAccountStatus(connected.account.id, "reauthorization_required");
  await expectResumeRejected({
    accountId: connected.account.id,
    provider: "demo",
    ownerId: "member-1",
  });
  store.patchAccountStatus(connected.account.id, "active");
  await expectResumeRejected({
    accountId: connected.account.id,
    provider: "demo",
    ownerId: "member-2",
  });
  await expectResumeRejected({
    accountId: connected.account.id,
    provider: "other",
    ownerId: "member-1",
  });
  await expectResumeRejected({
    accountId: "missing-account",
    provider: "demo",
    ownerId: "member-1",
  });

  assert.equal(ensureConnectionCalls, 1);
  assert.equal(store.upsertConnectionCalls, 1);
  assert.equal(mintedTokens, 1);
});

test("public ingress SDK sign-in resume withholds a token when disconnect wins during mint", async () => {
  const store = new InMemoryPublicIngressStore();
  let accountId = "";
  let mintedTokens = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        sdkConnectionHandler: {
          async ensureConnection() {
            return {
              externalAccountId: "demo-sdk-user-1",
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
              setupPhase: "source_confirmed",
            };
          },
          async createSignInToken() {
            mintedTokens += 1;
            if (mintedTokens === 2) {
              store.patchAccountStatus(accountId, "disconnected");
            }
            return {
              signInToken: `sdk-sign-in-token-${mintedTokens}`,
              environment: "sandbox",
            };
          },
        },
      }),
    ]),
    store,
  });
  const connected = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });
  accountId = connected.account.id;

  await assert.rejects(
    () => ingress.resumeSdkSignInSession({
      accountId,
      provider: "demo",
      ownerId: "member-1",
    }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "SDK_SIGN_IN_RECONNECT_REQUIRED",
  );
  assert.equal(mintedTokens, 2);
  assert.equal(store.upsertConnectionCalls, 1);
});

test("public ingress SDK sign-in session refuses to reuse an established account for a different owner", async () => {
  const store = new InMemoryPublicIngressStore();
  let mintedTokens = 0;
  let connectionEstablishedEvents = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        sdkConnectionHandler: {
          async ensureConnection() {
            return {
              externalAccountId: "demo-sdk-user-1",
              displayName: "Demo",
              scopes: [],
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
              setupPhase: "source_confirmed",
            };
          },
          async createSignInToken() {
            mintedTokens += 1;
            return {
              signInToken: `sdk-sign-in-token-${mintedTokens}`,
              environment: "sandbox",
            };
          },
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        connectionEstablishedEvents += 1;
      },
    },
  });

  const first = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });

  assert.equal(first.signInToken, "sdk-sign-in-token-1");
  assert.equal(connectionEstablishedEvents, 1);

  await assert.rejects(
    () =>
      ingress.createSdkSignInSession({
        provider: "demo",
        ownerId: "member-2",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "CONNECTION_OWNERSHIP_CONFLICT" &&
      error.httpStatus === 409,
  );

  assert.equal(mintedTokens, 1);
  assert.equal(connectionEstablishedEvents, 1);
  assert.equal(store.upsertConnectionCalls, 2);
});

test("public ingress SDK sign-in session skips established side effects when upsert sees a concurrent create", async () => {
  class ConcurrentCreateStore extends InMemoryPublicIngressStore {
    hideNextExternalLookup = false;

    override getConnectionByExternalAccount(provider: string, externalAccountId: string): PublicDeviceSyncAccount | null {
      if (this.hideNextExternalLookup) {
        this.hideNextExternalLookup = false;
        return null;
      }

      return super.getConnectionByExternalAccount(provider, externalAccountId);
    }

    override upsertConnectionWithPrevious(input: UpsertPublicDeviceSyncConnectionInput) {
      const previousAccount = super.getConnectionByExternalAccount(input.provider, input.externalAccountId);
      const account = super.upsertConnection(input);
      return { account, previousAccount };
    }
  }

  const store = new ConcurrentCreateStore();
  const connectionEvents: Array<{ accountId: string; initialJobs: number }> = [];
  let mintedTokens = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        sdkConnectionHandler: {
          async ensureConnection() {
            return {
              externalAccountId: "demo-sdk-user-1",
              displayName: "Demo",
              scopes: [],
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
              setupPhase: "source_confirmed",
              initialJobs: [
                {
                  kind: "backfill",
                  payload: {
                    windowStart: "2026-01-01T00:00:00.000Z",
                  },
                },
              ],
            };
          },
          async createSignInToken() {
            mintedTokens += 1;
            return {
              signInToken: `sdk-sign-in-token-${mintedTokens}`,
              environment: "sandbox",
            };
          },
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished({ account, connection }) {
        connectionEvents.push({
          accountId: account.id,
          initialJobs: connection.initialJobs?.length ?? 0,
        });
      },
    },
  });

  const first = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });

  store.hideNextExternalLookup = true;
  const second = await ingress.createSdkSignInSession({
    provider: "demo",
    ownerId: "member-1",
  });

  assert.equal(second.account.id, first.account.id);
  assert.equal(second.signInToken, "sdk-sign-in-token-2");
  assert.equal(second.account.updatedAt, first.account.updatedAt);
  assert.equal(store.upsertConnectionCalls, 2);
  assert.deepEqual(connectionEvents, [
    { accountId: first.account.id, initialJobs: 1 },
  ]);
});

test("public ingress SDK sign-in session clears persisted authority and returns no token when admission fails", async () => {
  const store = new InMemoryPublicIngressStore();
  let hookCalls = 0;
  let mintedTokens = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        sdkConnectionHandler: {
          async ensureConnection() {
            return {
              externalAccountId: "demo-sdk-user-1",
              displayName: "Demo",
              scopes: [],
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
              setupPhase: "source_confirmed",
              initialJobs: [
                {
                  kind: "backfill",
                  payload: {
                    windowStart: "2026-01-01T00:00:00.000Z",
                  },
                },
              ],
            };
          },
          async createSignInToken() {
            mintedTokens += 1;
            return {
              signInToken: "sdk-sign-in-token",
              environment: "sandbox",
            };
          },
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        hookCalls += 1;
        throw new Error("wake enqueue failed with authorization=<REDACTED_AUTHORIZATION>");
      },
    },
  });

  await assert.rejects(
    () => ingress.createSdkSignInSession({
      provider: "demo",
      ownerId: "member-1",
    }),
    /wake enqueue failed/u,
  );

  const account = store.getConnectionByExternalAccount("demo", "demo-sdk-user-1");
  assert.equal(account?.status, "reauthorization_required");
  assert.equal(account?.setupPhase, "failed");
  assert.equal(account?.accessTokenExpiresAt, null);
  assert.equal(hookCalls, 1);
  assert.equal(mintedTokens, 0);
});

test("public ingress SDK sign-in session rejects unsupported providers and missing owners", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider(),
      createFakeProvider({
        provider: "demo-sdk",
        sdkConnectionHandler: {
          async ensureConnection() {
            return {
              externalAccountId: "demo-sdk-user-1",
              tokens: {
                accessToken: "<REDACTED_ACCESS_TOKEN>",
              } satisfies ProviderAuthTokens,
            };
          },
          async createSignInToken() {
            return {
              signInToken: "sdk-sign-in-token",
              environment: "production",
            };
          },
        },
      }),
    ]),
    store,
  });

  await assert.rejects(
    () => ingress.createSdkSignInSession({ provider: "demo", ownerId: "member-1" }),
    (error: unknown) => error instanceof DeviceSyncError && error.code === "SDK_SIGN_IN_NOT_SUPPORTED",
  );

  await assert.rejects(
    () => ingress.createSdkSignInSession({ provider: "demo-sdk", ownerId: "  " }),
    (error: unknown) => error instanceof DeviceSyncError && error.code === "CONNECTION_OWNER_REQUIRED",
  );

  assert.equal(store.getConnectionByExternalAccount("demo-sdk", "demo-sdk-user-1"), null);
});

test("every default-enabled Junction Link connect source completes the real-provider callback with normalized initial jobs", async () => {
  // Regression for the production outage where source-scoped Junction Link
  // completions enqueued initial jobs whose payload carried a field the
  // junction manifest did not declare: the callback handler threw
  // DEVICE_SYNC_JOB_PAYLOAD_INVALID before persisting the connection, hard-
  // walling every web Link connect. The fake-provider ingress tests above and
  // the manifest-free provider unit tests each passed while the real
  // provider/manifest seam was broken, so this test wires the REAL junction
  // provider (Junction HTTP mocked at the fetch boundary) into the REAL
  // ingress service and walks every default-enabled Link source end to end.
  const junctionLinkRoutes = DEVICE_CONNECT_SOURCES.flatMap((source) =>
    source.routes.flatMap((route) =>
      route.kind === "junction_link" && route.defaultEnabled
        ? [{ connectSourceId: source.connectSourceId, route }]
        : []
    )
  );
  assert.ok(
    junctionLinkRoutes.length >= 10,
    "expected the connect-source registry to enumerate default-enabled Junction Link routes",
  );

  for (const { connectSourceId, route } of junctionLinkRoutes) {
    const junctionUserId = `junction-user-${route.sourceProviderSlug}`;
    const provider = createJunctionDeviceSyncProvider({
      apiKey: "sk_us_test_123",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      region: "us",
      pushSourceRecoveryEnabled: false,
      summaryResources: ["activity"],
      summaryBackfillDays: 2,
      timeseriesResources: [],
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
          return new Response(JSON.stringify({ id: junctionUserId }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
          return new Response(JSON.stringify({ link_web_url: "https://link.junction.com/session/link-token-1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected Junction request for ${route.sourceProviderSlug}: ${url}`);
      },
    });

    const store = new InMemoryPublicIngressStore();
    const establishedJobs: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
    const ingress = createDeviceSyncPublicIngress({
      publicBaseUrl: "https://sync.example.test/device-sync",
      allowedReturnOrigins: ["https://app.example.test"],
      registry: createDeviceSyncRegistry([provider]),
      store,
      hooks: {
        onConnectionEstablished(input) {
          establishedJobs.push(...(input.connection.initialJobs ?? []));
          return { sourceAdmissionCommitted: true };
        },
      },
    });

    const begin = await ingress.startConnection({
      provider: "junction",
      returnTo: "https://app.example.test/device-sync/connect/complete",
      ownerId: "hosted-member-1",
      sourceProviderSlug: route.sourceProviderSlug,
      connectSourceId,
      connectTarget: route.connectTarget,
    });
    assert.equal(
      begin.authorizationUrl,
      "https://link.junction.com/session/link-token-1",
      `Junction Link start should succeed for ${route.sourceProviderSlug}`,
    );

    const connected = await ingress.handleConnectionCallback({
      provider: "junction",
      state: begin.state,
      expectedOwnerId: "hosted-member-1",
      query: new URLSearchParams({
        murph_state: begin.state,
        state: "success",
      }),
    });

    assert.equal(connected.sourceProviderSlug, route.sourceProviderSlug);
    assert.equal(connected.account.provider, "junction");
    assert.equal(
      connected.account.setupPhase,
      "source_confirmed",
      `Junction Link completion should confirm the source for ${route.sourceProviderSlug}`,
    );
    assert.deepEqual(establishedJobs.map((job) => job.kind), ["backfill", "reconcile"]);
    for (const job of establishedJobs) {
      assert.equal(
        job.payload?.sourceProviderSlug,
        route.sourceProviderSlug,
        `initial ${job.kind} job should stay scoped to ${route.sourceProviderSlug} through the manifest boundary`,
      );
    }
  }
});
