import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceRecord,
  DeviceConnectionSourceStatus,
  DeviceSyncAccountSetupPhase,
  DeviceSyncAccountStatus,
  DeviceSyncAccountRecord,
  ListDeviceSyncAccountsInput,
  DeviceSyncJobRecord,
  DeviceSyncProviderDescriptor,
  ListDeviceConnectionSourcesInput,
  UpsertDeviceConnectionSourceInput,
} from "./client.ts";
import type {
  DeviceProviderDescriptor,
  NamedDeviceProviderRegistry,
} from "@murphai/importers/device-providers/provider-descriptors";

export type { DeviceSyncAccountStatus } from "./client.ts";
export type { DeviceSyncAccountSetupPhase } from "./client.ts";
export type { DeviceSyncAccountSourceSummary } from "./client.ts";
export type { DeviceConnectionSourceStatus } from "./client.ts";
export type { DeviceConnectionSourceResourceAvailabilityValue } from "./client.ts";
export type { DeviceConnectionSourceResourceAvailabilitySummary } from "./client.ts";
export type { UpsertDeviceConnectionSourceInput } from "./client.ts";
export type { ListDeviceConnectionSourcesInput } from "./client.ts";
export type { ListDeviceSyncAccountsInput } from "./client.ts";
export type { DeviceConnectionSourceRecord } from "./client.ts";
export type { DeviceSyncJobRecord } from "./client.ts";

export const DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES = 1_048_576;
export const DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED = {
  webhookTraceCompleted: true,
} as const;

export interface DeviceSyncLogger {
  debug?(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
  warn?(message: string, context?: Record<string, unknown>): void;
  error?(message: string, context?: Record<string, unknown>): void;
}

export interface DeviceSyncServiceConfig {
  vaultRoot: string;
  publicBaseUrl: string;
  allowedReturnOrigins?: string[];
  stateDatabasePath?: string;
  sessionTtlMs?: number;
  workerLeaseMs?: number;
  workerPollMs?: number;
  // Number of durable job rows per drain tick. A provider batch may complete
  // multiple compatible rows in one worker pass, and each row counts here.
  workerBatchSize?: number;
  schedulerPollMs?: number;
  log?: DeviceSyncLogger;
  shouldYieldJobExecution?: (() => boolean) | null;
}

export interface DeviceSyncJobFailureDiagnosticDetails {
  failureCauseCode?: string;
  failureCauseName?: string;
  failureErrorCause?: string;
  failureErrorName?: string;
  providerHttpStatus?: number;
  providerHttpStatusText?: string;
  providerRequestAuthKind?: string;
  providerRequestAuthPlacement?: string;
  providerRequestBodyFieldCount?: number;
  providerRequestBodyFieldNames?: string;
  providerRequestBodyKind?: string;
  providerRequestContentType?: string;
  providerRequestCredentialPresent?: boolean;
  providerRequestEndpointKind?: string;
  providerRequestMethod?: string;
  providerRequestQueryParameterCount?: number;
  providerRequestQueryParameterNames?: string;
  providerResponseErrorCode?: string;
  providerResponseErrorDescription?: string;
  providerResponseErrorDescriptionFieldPresent?: boolean;
  providerResponseErrorFieldPresent?: boolean;
  providerResponseShapeKind?: string;
  providerOAuthErrorCode?: string;
  providerOAuthErrorDescription?: string;
  providerOAuthGrantType?: string;
  providerOAuthRequestBodyBuilderKind?: string;
  providerOAuthRequestClientAuthPlacement?: string;
  providerOAuthRequestClientCredentialPresent?: boolean;
  providerOAuthRequestClientIdPresent?: boolean;
  providerOAuthRequestContentType?: string;
  providerOAuthRequestDuplicateParameterCount?: number;
  providerOAuthRequestEncodingKind?: string;
  providerOAuthRequestHasDuplicateParameters?: boolean;
  providerOAuthRequestMethod?: string;
  providerOAuthRequestOfflineScopePresent?: boolean;
  providerOAuthRequestParameterCount?: number;
  providerOAuthRequestParameterNames?: string;
  providerOAuthRequestRefreshCredentialPresent?: boolean;
  providerOAuthRequestScopeCount?: number;
  providerOAuthRequestScopePresent?: boolean;
  providerOAuthRequestScopeValue?: string;
  providerOAuthRequestTokenEndpointKind?: string;
  providerOAuthResponseErrorDescriptionFieldPresent?: boolean;
  providerOAuthResponseErrorFieldPresent?: boolean;
  providerOAuthResponseShapeKind?: string;
}

export interface DeviceSyncJobFailureDiagnostic {
  accountId: string;
  accountStatus: DeviceSyncAccountStatus | null;
  /** ISO timestamp of the failed attempt, when known. */
  at?: string;
  /** Attempt count of the failing job at execution time, when known. */
  attempts?: number;
  code: string;
  details: DeviceSyncJobFailureDiagnosticDetails;
  /** Job kind of the failing job (for example `resource`, `reconcile`), when known. */
  jobKind?: string;
  provider?: string;
  /** Provider resource name from the failing job payload, when known. */
  resource?: string;
  retryable: boolean;
  /** Sanitized failure summary already passed through the shared redaction helpers. */
  summary?: string;
}

export interface DeviceSyncHttpConfig {
  host?: string;
  port?: number;
  controlToken?: string;
  publicHost?: string;
  publicPort?: number;
}

export interface DeviceSyncHttpListenerAddress {
  host: string;
  port: number;
}

export type PublicProviderDescriptor = DeviceSyncProviderDescriptor;

export interface OAuthStateRecord {
  state: string;
  provider: string;
  returnTo: string | null;
  ownerId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export type PublicDeviceSyncAccount = DeviceSyncAccountRecord;
export type PublicDeviceConnectionSource = DeviceConnectionSourceRecord;
export type StoredDeviceConnectionSource = PublicDeviceConnectionSource;

export interface StoredDeviceSyncAccount extends PublicDeviceSyncAccount {
  externalAccountId: string;
  disconnectGeneration: number;
  credential: StoredDeviceSyncAccountCredential;
  hostedObservedConnectionRevision: number;
  hostedObservedTokenRevision: number;
  hostedObservedTokenVersion: number | null;
  hostedObservedUpdatedAt: string | null;
  localConnectionRevision: number;
  localTokenRevision: number;
}

export interface DeviceSyncAccount extends PublicDeviceSyncAccount {
  externalAccountId: string;
  disconnectGeneration: number;
  credential: DeviceSyncAccountCredential;
}

export interface ProviderAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresAt?: string | null;
}

export type DeviceAccountCredentialKind =
  | "oauth_tokens"
  | "provider_config"
  | "none";

export type DeviceAccountCredential =
  | {
      kind: "oauth_tokens";
      tokens: ProviderAuthTokens;
    }
  | {
      kind: "provider_config";
      providerConfigKey: string;
      subject?: Record<string, string>;
    }
  | {
      kind: "none";
    };

export type StoredDeviceSyncAccountCredential =
  | {
      kind: "oauth_tokens";
      accessTokenEncrypted: string;
      refreshTokenEncrypted: string | null;
      accessTokenExpiresAt: string | null;
      credentialMetadata: Record<string, unknown>;
    }
  | {
      kind: "provider_config";
      providerConfigKey: string;
      credentialMetadata: Record<string, unknown>;
    }
  | {
      kind: "none";
      credentialMetadata: Record<string, unknown>;
    };

export type DeviceSyncAccountCredential =
  | {
      kind: "oauth_tokens";
      tokens: ProviderAuthTokens;
    }
  | {
      kind: "provider_config";
      providerConfigKey: string;
      credentialMetadata: Record<string, unknown>;
    }
  | {
      kind: "none";
      credentialMetadata: Record<string, unknown>;
    };

export function getDeviceSyncAccountOAuthTokens(
  account: Pick<DeviceSyncAccount, "credential">,
): ProviderAuthTokens | null {
  return account.credential.kind === "oauth_tokens" ? account.credential.tokens : null;
}

export function getStoredDeviceSyncAccountOAuthCredential(
  account: Pick<StoredDeviceSyncAccount, "credential">,
): Extract<StoredDeviceSyncAccountCredential, { kind: "oauth_tokens" }> | null {
  return account.credential.kind === "oauth_tokens" ? account.credential : null;
}

export type DeviceSyncProviderCredentialPolicy =
  | {
      kind: "oauth_tokens";
    }
  | {
      kind: "provider_config";
      providerConfigKey: string;
    }
  | {
      kind: "none";
    };

export interface ProviderConnectionSeed {
  externalAccountId: string;
  displayName?: string | null;
  status?: DeviceSyncAccountStatus;
  setupPhase?: DeviceSyncAccountSetupPhase | null;
  setupExpiresAt?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  credential: DeviceAccountCredential;
  nextReconcileAt?: string | null;
}

export interface UpsertPublicDeviceSyncExistingAccountGuard {
  expectedAccountId: string;
  expectedConnectedAt: string;
  rejectIfDisconnected?: boolean;
}

export type UpsertPublicDeviceSyncExistingAccountPolicy =
  | "replace"
  | "preserve_established";

export interface UpsertPublicDeviceSyncConnectionInput {
  ownerId?: string | null;
  provider: string;
  externalAccountId: string;
  displayName?: string | null;
  status?: DeviceSyncAccountStatus;
  setupPhase?: DeviceSyncAccountSetupPhase | null;
  setupExpiresAt?: string | null;
  scopes?: string[];
  credential?: DeviceAccountCredential;
  tokens?: ProviderAuthTokens;
  metadata?: Record<string, unknown>;
  existingAccountGuard?: UpsertPublicDeviceSyncExistingAccountGuard | null;
  existingAccountPolicy: UpsertPublicDeviceSyncExistingAccountPolicy;
  connectedAt: string;
  nextReconcileAt?: string | null;
}

export interface MarkPublicDeviceSyncConnectionSetupFailedInput {
  accountId: string;
  expectedConnectedAt: string | null;
  now: string;
  code: string;
  message: string;
}

export interface MarkPublicDeviceSyncConnectionSetupFailedResult {
  account: PublicDeviceSyncAccount | null;
  applied: boolean;
}

export interface UpsertPublicDeviceSyncConnectionResult {
  account: PublicDeviceSyncAccount;
  previousAccount: PublicDeviceSyncAccount | null;
}

export interface DeviceSyncWebhookTraceRecord {
  provider: string;
  traceId: string;
  externalAccountId: string;
  eventType: string;
  receivedAt: string;
}

export interface ClaimDeviceSyncWebhookTraceInput extends DeviceSyncWebhookTraceRecord {
  claimToken: string;
  processingExpiresAt: string;
}

export type DeviceSyncWebhookTraceClaimResult =
  | "claimed"
  | "processed"
  | "processing";

export type ConsumeOAuthStateResult =
  | {
      status: "consumed";
      record: OAuthStateRecord;
    }
  | {
      /**
       * The state was already consumed and has not expired yet. Browsers
       * deliver callback navigations at-least-once (refresh, tab restore,
       * provider completion-page retries), so a redelivered state must stay
       * distinguishable from an unknown one.
       */
      status: "replayed";
      record: OAuthStateRecord;
    }
  | {
      status: "missing";
    }
  | {
      status: "provider_mismatch";
      provider: string;
    }
  | {
      status: "owner_mismatch";
    };

export interface DeviceSyncPublicIngressStore {
  deleteExpiredOAuthStates(now: string): number | Promise<number>;
  createOAuthState(input: OAuthStateRecord): OAuthStateRecord | Promise<OAuthStateRecord>;
  consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): ConsumeOAuthStateResult | Promise<ConsumeOAuthStateResult>;
  upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount | Promise<PublicDeviceSyncAccount>;
  upsertConnectionWithPrevious?(
    input: UpsertPublicDeviceSyncConnectionInput,
  ): UpsertPublicDeviceSyncConnectionResult | Promise<UpsertPublicDeviceSyncConnectionResult>;
  markConnectionSetupFailed(
    input: MarkPublicDeviceSyncConnectionSetupFailedInput,
  ): MarkPublicDeviceSyncConnectionSetupFailedResult
    | Promise<MarkPublicDeviceSyncConnectionSetupFailedResult>;
  getConnectionById(
    accountId: string,
  ): PublicDeviceSyncAccount | null | Promise<PublicDeviceSyncAccount | null>;
  getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): PublicDeviceSyncAccount | null | Promise<PublicDeviceSyncAccount | null>;
  upsertConnectionSource(
    input: UpsertDeviceConnectionSourceInput,
  ): Pick<PublicDeviceConnectionSource, "connectionId" | "sourceProviderSlug" | "status">
    | Promise<Pick<PublicDeviceConnectionSource, "connectionId" | "sourceProviderSlug" | "status">>;
  listConnectionSources(
    input: ListDeviceConnectionSourcesInput,
  ): Array<Pick<
    PublicDeviceConnectionSource,
    | "connectionId"
    | "lastErrorCode"
    | "lastSeenAt"
    | "sourceInstanceKey"
    | "sourceProviderSlug"
    | "status"
  >>
    | Promise<Array<Pick<
      PublicDeviceConnectionSource,
      | "connectionId"
      | "lastErrorCode"
      | "lastSeenAt"
      | "sourceInstanceKey"
      | "sourceProviderSlug"
      | "status"
    >>>;
  getConnectionOwnerId?(accountId: string): string | null | Promise<string | null>;
  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult | Promise<DeviceSyncWebhookTraceClaimResult>;
  completeWebhookTrace(provider: string, traceId: string, claimToken: string): boolean | Promise<boolean>;
  releaseWebhookTrace(provider: string, traceId: string, claimToken: string): void | Promise<void>;
  markWebhookReceived(accountId: string, now: string): void | Promise<void>;
  /**
   * Required, not optional: a push-primary stall is only detectable because
   * this runs, so a store that silently omitted it would leave the whole signal
   * dead in production while every test against a fake store still passed.
   */
  markConnectionSourceDataReceived(input: {
    connectionId: string;
    now: string;
    sourceProviderSlug: string;
  }): number | Promise<number>;
}

export interface DeviceSyncJobInput {
  kind: string;
  payload?: Record<string, unknown>;
  priority?: number;
  availableAt?: string;
  maxAttempts?: number;
  dedupeKey?: string;
}

export interface ProviderCallbackContext {
  callbackUrl: string;
  state: string;
  now: string;
  grantedScopes: string[];
}

export interface ProviderBeginConnectionContext {
  state: string;
  callbackUrl: string;
  publicBaseUrl: string;
  now: string;
  scopes: string[];
  ownerId?: string | null;
  sourceProviderSlug?: string | null;
}

export interface ProviderBeginConnectionResult {
  authorizationUrl: string;
  connectionSeed?: ProviderConnectionSeed;
  stateMetadata?: Record<string, unknown>;
  scopes?: string[];
}

export interface ProviderCompleteConnectionContext {
  callbackUrl: string;
  state: string;
  stateMetadata?: Record<string, unknown>;
  seededExternalAccountId?: string | null;
  sourceProviderSlug?: string | null;
  query: URLSearchParams;
  now: string;
  grantedScopes: string[];
}

export interface ProviderConnectionResult {
  externalAccountId: string;
  displayName?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  credential?: DeviceAccountCredential;
  tokens?: ProviderAuthTokens;
  setupPhase?: DeviceSyncAccountSetupPhase | null;
  setupExpiresAt?: string | null;
  initialJobs?: DeviceSyncJobInput[];
  nextReconcileAt?: string | null;
}

export interface ProviderWebhookContext {
  headers: Headers;
  rawBody: Buffer;
  now: string;
}

export interface ProviderWebhookResult {
  externalAccountId: string;
  externalAccountDiagnostic?: DeviceSyncWebhookExternalAccountDiagnostic;
  acceptanceMode: DeviceSyncWebhookAcceptanceMode;
  eventType: string;
  traceId: string;
  occurredAt?: string;
  /** Verified provider-envelope send time, when the webhook signature carries one. */
  providerSentAt?: string;
  // Keep top-level parser data narrow; provider-owned jobs may carry sanitized payload hints.
  resourceCategory?: string | null;
  /** Source this provider event is attributable to, including lifecycle events. */
  sourceProviderSlug?: string | null;
  /**
   * The connected source whose data this payload carried, when the provider can
   * name it. Ingress uses it to record per-source data arrival, which is the
   * only way to tell a live push carrier from one the provider has silently
   * stopped feeding. Lifecycle events that carry no data leave it unset.
   */
  dataSourceProviderSlug?: string | null;
  jobs: DeviceSyncJobInput[];
  unknownAccountAction?: "retry" | "accept";
}

export interface DeviceSyncWebhookExternalAccountDiagnostic {
  selectedPath: string | null;
  selectedExternalAccountIdHash: string;
  candidates: readonly DeviceSyncWebhookExternalAccountCandidateDiagnostic[];
}

export interface DeviceSyncWebhookExternalAccountCandidateDiagnostic {
  path: string;
  kind: "external_account_id" | "client_user_id";
  valueHash: string;
  selected: boolean;
}

export interface DeviceSyncIngressWebhook {
  acceptanceMode: DeviceSyncWebhookAcceptanceMode;
  eventType: string;
  jobs: readonly DeviceSyncJobInput[];
  occurredAt?: string;
  /** See `ProviderWebhookResult.providerSentAt`. */
  providerSentAt?: string;
  // Accepted and unknown ingress hooks receive stripped summary plus provider-owned job hints.
  resourceCategory?: string | null;
  /** See `ProviderWebhookResult.sourceProviderSlug`. */
  sourceProviderSlug?: string | null;
  /** See `ProviderWebhookResult.dataSourceProviderSlug`. */
  dataSourceProviderSlug?: string | null;
}

// Durable webhook work means any exact event work that must be durably merged before acknowledgement:
// direct payloads, resource fetches, deletes, deauthorizations, or other non-rehydratable jobs.
export type DeviceSyncWebhookAcceptanceMode =
  | "level_dirty_hint"
  | "durable_webhook_work";

const COALESCIBLE_LEVEL_DIRTY_JOB_KINDS = new Set(["backfill", "reconcile"]);
const COALESCIBLE_LEVEL_DIRTY_JOB_PAYLOAD_KEYS = new Set([
  "includeAthlete",
  "includePersonalInfo",
  "kind",
  "windowDays",
  "windowEnd",
  "windowKind",
  "windowStart",
]);

export function classifyDeviceSyncWebhookAcceptanceMode(
  jobs: readonly DeviceSyncJobInput[],
): DeviceSyncWebhookAcceptanceMode {
  if (jobs.length === 0) {
    return "durable_webhook_work";
  }

  return jobs.every(isCoalescibleLevelDirtyWebhookJob)
    ? "level_dirty_hint"
    : "durable_webhook_work";
}

function isCoalescibleLevelDirtyWebhookJob(job: DeviceSyncJobInput): boolean {
  if (!COALESCIBLE_LEVEL_DIRTY_JOB_KINDS.has(job.kind)) {
    return false;
  }

  const payload = job.payload ?? {};
  if (!hasBoundedDirtyWindowPayload(payload)) {
    return false;
  }

  return Object.entries(payload).every(([key, value]) => {
    if (!COALESCIBLE_LEVEL_DIRTY_JOB_PAYLOAD_KEYS.has(key)) {
      return false;
    }

    return key !== "kind" || value === job.kind;
  });
}

function hasBoundedDirtyWindowPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.windowStart === "string"
    && payload.windowStart.trim().length > 0
    && typeof payload.windowEnd === "string"
    && payload.windowEnd.trim().length > 0;
}

export interface DeviceSyncWebhookPreflightResponse {
  status: number;
  body: string | number | boolean | null | Record<string, unknown> | readonly unknown[];
  headers?: Record<string, string>;
}

export interface ProviderWebhookPreflightContext {
  method: string;
  url: URL;
  headers: Headers;
  rawBody: Buffer;
  now: string;
}

export interface ProviderWebhookAdminEnsureContext {
  publicBaseUrl: string;
}

export interface ProviderWebhookAdminCapability {
  handleWebhookPreflight?(
    context: ProviderWebhookPreflightContext,
  ): DeviceSyncWebhookPreflightResponse | null | Promise<DeviceSyncWebhookPreflightResponse | null>;
  ensureSubscriptions?(context: ProviderWebhookAdminEnsureContext): Promise<void>;
}

export interface DeviceSyncPublicIngressConnectionEstablishedInput {
  account: PublicDeviceSyncAccount;
  /** Start instant of the consumed browser connection state, when applicable. */
  connectionStartedAt?: string | null;
  connectSourceId?: string | null;
  connectTarget?: string | null;
  sourceProviderSlug?: string | null;
  connection: ProviderConnectionResult;
  provider: DeviceSyncProvider;
  now: string;
}

export interface DeviceSyncPublicIngressConnectionEstablishedResult {
  sourceAdmissionCommitted: true;
}

export type DeviceSyncPublicIngressConnectionSourceObservedResult =
  | { sourceAdmissionCommitted: true }
  | { sourceRegistrationRemoved: true };

export interface DeviceSyncPublicIngressConnectionSourceAdmissionRejectedInput {
  account: PublicDeviceSyncAccount;
  /** Start instant of the rejected browser source-connection attempt. */
  connectionStartedAt: string;
  sourceProviderSlug: string;
  provider: DeviceSyncProvider;
  now: string;
}

export interface DeviceSyncPublicIngressConnectionSourceObservedInput {
  account: PublicDeviceSyncAccount;
  eventType: string;
  sourceProviderSlug: string;
  provider: DeviceSyncProvider;
  now: string;
}

export interface DeviceSyncPublicIngressWebhookAcceptedInput {
  account: PublicDeviceSyncAccount;
  claimToken: string;
  traceId: string;
  webhook: DeviceSyncIngressWebhook;
  provider: DeviceSyncProvider;
  now: string;
}

export interface DeviceSyncPublicIngressWebhookAcceptedResult {
  webhookTraceCompleted: true;
}

export interface DeviceSyncPublicIngressWebhookAlreadySatisfiedInput {
  account: PublicDeviceSyncAccount;
  traceId: string;
  webhook: DeviceSyncIngressWebhook;
  provider: DeviceSyncProvider;
  now: string;
}

export interface DeviceSyncPublicIngressWebhookAlreadySatisfiedResult {
  accepted: true;
}

export interface DeviceSyncPublicIngressUnknownWebhookInput {
  provider: DeviceSyncProvider;
  traceId: string;
  webhook: DeviceSyncIngressWebhook;
  externalAccountId: string;
  now: string;
}

export interface DeviceSyncPublicIngressConnectionMutationInput {
  provider: string;
}

export interface DeviceSyncPublicIngressHooks {
  runConnectionMutation?<Result>(
    input: DeviceSyncPublicIngressConnectionMutationInput,
    operation: () => Promise<Result>,
  ): Promise<Result>;
  // This is the sole runtime-specific admission boundary. A Junction callback
  // that names a source succeeds only when this hook atomically commits that
  // source with its durable initial work and returns sourceAdmissionCommitted.
  onConnectionEstablished?(
    input: DeviceSyncPublicIngressConnectionEstablishedInput,
  ): void
    | DeviceSyncPublicIngressConnectionEstablishedResult
    | Promise<void | DeviceSyncPublicIngressConnectionEstablishedResult>;
  // A reused Junction parent can finish provider authorization before hosted
  // source admission rejects an obsolete attempt. The hosted owner uses this
  // hook to remove only that rejected provider registration without applying
  // account-wide cleanup or racing a newer source epoch.
  onConnectionSourceAdmissionRejected?(
    input: DeviceSyncPublicIngressConnectionSourceAdmissionRejectedInput,
  ): void | Promise<void>;
  // Native SDK sources have no browser callback. A current provider-authored
  // event may commit their pending exact-source epoch; passive traffic cannot
  // clear a completed disconnect fence.
  onConnectionSourceObserved?(
    input: DeviceSyncPublicIngressConnectionSourceObservedInput,
  ): void
    | DeviceSyncPublicIngressConnectionSourceObservedResult
    | Promise<void | DeviceSyncPublicIngressConnectionSourceObservedResult>;
  onLevelDirtyWebhookAlreadySatisfied?(
    input: DeviceSyncPublicIngressWebhookAlreadySatisfiedInput,
  ): DeviceSyncPublicIngressWebhookAlreadySatisfiedResult
    | null
    | Promise<DeviceSyncPublicIngressWebhookAlreadySatisfiedResult | null>;
  // When present, the hook owns durable webhook acceptance and must complete the claimed trace
  // transactionally once its side effects are committed by using traceId.
  onWebhookAccepted?(
    input: DeviceSyncPublicIngressWebhookAcceptedInput,
  ): DeviceSyncPublicIngressWebhookAcceptedResult | Promise<DeviceSyncPublicIngressWebhookAcceptedResult>;
  // Optional side-effect hook for provider-requested orphan webhook acceptance.
  onUnknownWebhook?(input: DeviceSyncPublicIngressUnknownWebhookInput): void | Promise<void>;
}

export interface ProviderScheduleResult {
  jobs: DeviceSyncJobInput[];
  nextReconcileAt?: string | null;
}

export interface ProviderSnapshotImportReceipt {
  canonicalEventCount: number;
  canonicalEventExternalRefResourceIds?: readonly string[];
  durableDeliveryAccepted: boolean;
  junctionCanonicalCoverage?: readonly ProviderSnapshotCanonicalCoverageEvidence[];
}

export interface ProviderSnapshotCanonicalCoverageEvidence {
  coverageThrough: string;
  resource: string;
  sourceProviderSlug: string;
}

export interface ProviderJobConnectionSource {
  displayName: string | null;
  firstSeenAt?: string;
  lastErrorCode: string | null;
  lastSeenAt?: string;
  lastErrorMessage: string | null;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  sourceInstanceKey?: string;
  sourceProviderSlug: string;
  status: DeviceConnectionSourceStatus;
}

export interface ProviderJobContext {
  account: DeviceSyncAccount;
  now: string;
  signal?: AbortSignal;
  // Standalone sync discovers provider sub-sources from the provider API.
  // Hosted sync must treat the Web projection as the admission authority.
  connectionSourceAdmissionMode?: "discover_unlisted" | "listed_only";
  shouldYield?(): boolean;
  throwIfAborted?(): void;
  // Providers must route job-time side effects through this context instead of
  // reaching into service/store internals directly.
  importSnapshot(snapshot: unknown): Promise<unknown>;
  upsertConnectionSource?(
    input: Omit<UpsertDeviceConnectionSourceInput, "connectionId">,
  ): DeviceConnectionSourceRecord | Promise<DeviceConnectionSourceRecord>;
  listConnectionSources?(
    input?: Omit<ListDeviceConnectionSourcesInput, "connectionId">,
  ): ProviderJobConnectionSource[] | Promise<ProviderJobConnectionSource[]>;
  refreshAccountTokens(): Promise<DeviceSyncAccount>;
  disconnectAccount?(): Promise<void>;
  logger: DeviceSyncLogger;
}

export interface ProviderJobResult {
  scheduledJobs?: DeviceSyncJobInput[];
  metadataPatch?: Record<string, unknown>;
  nextReconcileAt?: string | null;
}

export interface ProviderJobBatchDescriptor {
  key: string;
  estimatedBytes?: number;
}

export interface DeviceJobBatchExecutor {
  describe(job: DeviceSyncJobRecord): ProviderJobBatchDescriptor | null;
  execute(context: ProviderJobContext, jobs: readonly DeviceSyncJobRecord[]): Promise<ProviderJobResult>;
  maxEstimatedBytes?: number;
  maxJobs?: number;
}

export interface DeviceSyncBackfillDiagnosticContext {
  account: DeviceSyncAccount;
  now: string;
  timeseriesProbeDays?: number;
  windowEnd?: string | null;
  windowStart?: string | null;
}

export interface DeviceSyncBackfillDiagnosticResult {
  generatedAt: string;
  provider: string;
  result: Record<string, unknown>;
}

export type DeviceSyncRestDiagnosticEndpoint =
  | "auto"
  | "devices"
  | "historical_pull"
  | "introspect_resources"
  | "matrix"
  | "providers"
  | "refresh"
  // Mutating: asks the provider to re-run its historical pull for one source.
  | "trigger_historical_pull"
  | "summary"
  | "timeseries";

export interface DeviceSyncRestDiagnosticContext {
  account: DeviceSyncAccount;
  endpoint: DeviceSyncRestDiagnosticEndpoint;
  now: string;
  resource?: string | null;
  sourceProviderSlug?: string | null;
  timeoutSeconds?: number | null;
  windowEnd?: string | null;
  windowStart?: string | null;
}

export interface DeviceSyncProviderDiagnostics {
  diagnoseBackfill?(
    context: DeviceSyncBackfillDiagnosticContext,
  ): Promise<DeviceSyncBackfillDiagnosticResult>;
  probeRest?(
    context: DeviceSyncRestDiagnosticContext,
  ): Promise<DeviceSyncBackfillDiagnosticResult>;
}

export interface DeviceConnectionHandler {
  beginConnection(input: ProviderBeginConnectionContext): Promise<ProviderBeginConnectionResult>;
  completeConnection(input: ProviderCompleteConnectionContext): Promise<ProviderConnectionResult>;
  refreshTokens?(account: DeviceSyncAccount, options?: { signal?: AbortSignal | null }): Promise<ProviderAuthTokens>;
  revokeAccess?(account: DeviceSyncAccount): Promise<void>;
  revokeSourceAccess?(account: DeviceSyncAccount, sourceProviderSlug: string): Promise<void>;
  isSourceAccessActive?(account: DeviceSyncAccount, sourceProviderSlug: string): Promise<boolean>;
}

export interface DeviceSdkSignInToken {
  /** Short-lived provider SDK sign-in token. Never log or persist it. */
  signInToken: string;
  environment: "sandbox" | "production";
}

/**
 * Connection seam for providers whose devices connect through a native mobile
 * SDK sign-in token exchange instead of a hosted Link/OAuth callback. The
 * ensure step must resolve the same provider user a prior Link flow created
 * for the owner so both flows share one device-sync account.
 */
export interface DeviceSdkConnectionHandler {
  ensureConnection(input: {
    ownerId: string;
    now: string;
  }): Promise<ProviderConnectionResult>;
  createSignInToken(input: {
    externalAccountId: string;
  }): Promise<DeviceSdkSignInToken>;
}

export interface DeviceWebhookHandler {
  verifyAndParseWebhook(context: ProviderWebhookContext): Promise<ProviderWebhookResult>;
}

export interface DeviceJobExecutor {
  createScheduledJobs?(account: StoredDeviceSyncAccount, now: string): ProviderScheduleResult;
  executeJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult>;
  batch?: DeviceJobBatchExecutor;
}

export interface DeviceSyncOAuthAdapter {
  buildConnectUrl(input: {
    state: string;
    callbackUrl: string;
    scopes: string[];
    now: string;
  }): string;
  exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult>;
  refreshTokens(account: DeviceSyncAccount, options?: { signal?: AbortSignal | null }): Promise<ProviderAuthTokens>;
}

export interface DeviceSyncProvider {
  provider: string;
  descriptor: DeviceProviderDescriptor;
  credentialPolicy?: DeviceSyncProviderCredentialPolicy;
  connectionHandler?: DeviceConnectionHandler;
  sdkConnectionHandler?: DeviceSdkConnectionHandler;
  diagnostics?: DeviceSyncProviderDiagnostics;
  webhookHandler?: DeviceWebhookHandler;
  jobExecutor?: DeviceJobExecutor;
  webhookAdmin?: ProviderWebhookAdminCapability;
}

export interface DeviceSyncOAuthProvider extends DeviceSyncProvider {
  connectionHandler: DeviceConnectionHandler & {
    refreshTokens: NonNullable<DeviceConnectionHandler["refreshTokens"]>;
  };
  jobExecutor: DeviceJobExecutor;
  oauthAdapter: DeviceSyncOAuthAdapter;
}

export interface DeviceSyncRegistry extends NamedDeviceProviderRegistry<DeviceSyncProvider> {
  register(provider: DeviceSyncProvider): void;
  get(provider: string): DeviceSyncProvider | undefined;
  list(): DeviceSyncProvider[];
}

export interface StartConnectionInput {
  provider: string;
  returnTo?: string | null;
  ownerId?: string | null;
  sourceProviderSlug?: string | null;
  sourceLifecycleProof?: StartConnectionSourceLifecycleProof | null;
  connectSourceId?: string | null;
  connectTarget?: string | null;
}

export interface StartConnectionSourceLifecycleProof {
  connectionId: string;
  lastSeenAt: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
}

export interface BeginConnectionResult {
  provider: string;
  state: string;
  expiresAt: string;
  authorizationUrl: string;
}

export interface HandleConnectionCallbackInput {
  provider: string;
  state?: string | null;
  code?: string | null;
  expectedOwnerId?: string | null;
  scope?: string | null;
  error?: string | null;
  errorDescription?: string | null;
  query?: URLSearchParams;
}

export type HandleOAuthCallbackInput = HandleConnectionCallbackInput;

export interface CompleteConnectionResult {
  account: PublicDeviceSyncAccount;
  returnTo: string | null;
  connectSourceId?: string | null;
  connectTarget?: string | null;
  sourceProviderSlug?: string | null;
}

export interface SdkSignInSessionResult {
  account: PublicDeviceSyncAccount;
  /** Short-lived provider SDK sign-in token. Never log or persist it. */
  signInToken: string;
  environment: DeviceSdkSignInToken["environment"];
}

export interface HandleWebhookResult {
  accepted: boolean;
  duplicate: boolean;
  orphaned?: boolean;
  provider: string;
  eventType: string;
  traceId?: string;
}

export interface QueueManualReconcileResult {
  account: PublicDeviceSyncAccount;
  job: DeviceSyncJobRecord;
  jobs: DeviceSyncJobRecord[];
}

export interface DisconnectAccountResult {
  account: PublicDeviceSyncAccount;
}

export interface DeviceSyncServiceSummary {
  accountsTotal: number;
  accountsActive: number;
  jobsQueued: number;
  jobsRunning: number;
  jobsDead: number;
  oauthStates: number;
  webhookTraces: number;
}

export interface DeviceSyncImporterPort {
  importDeviceProviderSnapshot(input: {
    provider: string;
    snapshot: unknown;
    vaultRoot?: string;
  }): Promise<unknown>;
}

export interface NodeServerHandle {
  control: DeviceSyncHttpListenerAddress;
  public: DeviceSyncHttpListenerAddress | null;
  close(): Promise<void>;
}
