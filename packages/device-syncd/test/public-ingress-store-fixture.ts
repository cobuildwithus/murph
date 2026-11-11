import { deviceSyncError } from "../src/errors.ts";
import { mergeGuardedJunctionHistoricalBackfillMetadata } from "../src/junction-historical-backfill-progress.ts";
import { isDeviceSyncSourceDisconnectFenced } from "../src/public-account.ts";
import type {
  ClaimDeviceSyncWebhookTraceInput,
  ConsumeOAuthStateResult,
  DiscardUnconsumedOAuthStateResult,
  DeviceAccountCredential,
  DeviceSyncAccount,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceRecord,
  OAuthStateRecord,
  PublicDeviceConnectionSource,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
  UpsertDeviceConnectionSourceInput,
  ListDeviceConnectionSourcesInput,
} from "../src/types.ts";
import {
  DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
} from "../src/types.ts";

export class InMemoryPublicIngressStore implements DeviceSyncPublicIngressStore {
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
  deleteExpiredOAuthStatesCalls = 0;
  markConnectionSetupFailedError: Error | null = null;
  lastCreatedOAuthState: OAuthStateRecord | null = null;
  upsertConnectionCalls = 0;
  private accountCounter = 0;

  deleteExpiredOAuthStates(now: string): number {
    this.deleteExpiredOAuthStatesCalls += 1;
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

  getWebhookConnectionByExternalAccount(provider: string, externalAccountId: string) {
    const account = this.getConnectionByExternalAccount(provider, externalAccountId);
    return account
      ? {
          account,
          connectionOwnerId: this.accountOwners.get(account.id) ?? null,
        }
      : null;
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

  resolveConnectionSourceAdmissionCandidate(input: {
    connectionId: string;
    sourceInstanceKey?: string;
    sourceProviderSlug: string;
  }): PublicDeviceConnectionSource | null {
    return this.listConnectionSources(input)
      .sort((left, right) => {
        const leftExact = input.sourceInstanceKey !== undefined
          && left.sourceInstanceKey === input.sourceInstanceKey;
        const rightExact = input.sourceInstanceKey !== undefined
          && right.sourceInstanceKey === input.sourceInstanceKey;
        const leftAdmitted = left.status === "connected"
          && !isDeviceSyncSourceDisconnectFenced(left);
        const rightAdmitted = right.status === "connected"
          && !isDeviceSyncSourceDisconnectFenced(right);
        return Number(rightExact) - Number(leftExact)
          || Number(rightAdmitted) - Number(leftAdmitted)
          || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
          || left.sourceInstanceKey.localeCompare(right.sourceInstanceKey)
          || left.id.localeCompare(right.id);
      })[0] ?? null;
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

  readWebhookTraceStatus(provider: string, traceId: string): string | null {
    const status = this.webhookTraces.get(`${provider}:${traceId}`)?.status;
    return status === "stored" ? "processed" : status ?? null;
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

