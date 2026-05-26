import type {
  DeviceConnectionSourceRecord,
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
  workerBatchSize?: number;
  schedulerPollMs?: number;
  log?: DeviceSyncLogger;
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
  code: string;
  details: DeviceSyncJobFailureDiagnosticDetails;
  retryable: boolean;
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
  rejectIfDisconnected?: boolean;
}

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
  connectedAt: string;
  nextReconcileAt?: string | null;
}

export interface MarkPublicDeviceSyncConnectionSetupFailedInput {
  accountId: string;
  now: string;
  code: string;
  message: string;
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
  markConnectionSetupFailed(
    input: MarkPublicDeviceSyncConnectionSetupFailedInput,
  ): PublicDeviceSyncAccount | null | Promise<PublicDeviceSyncAccount | null>;
  getConnectionById(
    accountId: string,
  ): PublicDeviceSyncAccount | null | Promise<PublicDeviceSyncAccount | null>;
  getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): PublicDeviceSyncAccount | null | Promise<PublicDeviceSyncAccount | null>;
  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult | Promise<DeviceSyncWebhookTraceClaimResult>;
  completeWebhookTrace(provider: string, traceId: string, claimToken: string): boolean | Promise<boolean>;
  releaseWebhookTrace(provider: string, traceId: string, claimToken: string): void | Promise<void>;
  markWebhookReceived(accountId: string, now: string): void | Promise<void>;
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
  eventType: string;
  traceId: string;
  occurredAt?: string;
  // Keep top-level parser data narrow; provider-owned jobs may carry sanitized payload hints.
  resourceCategory?: string | null;
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
  eventType: string;
  jobs: readonly DeviceSyncJobInput[];
  occurredAt?: string;
  // Accepted and unknown ingress hooks receive stripped summary plus provider-owned job hints.
  resourceCategory?: string | null;
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
  connectSourceId?: string | null;
  connectTarget?: string | null;
  connection: ProviderConnectionResult;
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

export interface DeviceSyncPublicIngressUnknownWebhookInput {
  provider: DeviceSyncProvider;
  traceId: string;
  webhook: DeviceSyncIngressWebhook;
  externalAccountId: string;
  now: string;
}

export interface DeviceSyncPublicIngressHooks {
  onConnectionEstablished?(input: DeviceSyncPublicIngressConnectionEstablishedInput): void | Promise<void>;
  // When present, the hook owns durable webhook acceptance and must complete the claimed trace
  // transactionally once its side effects are committed by using traceId.
  onWebhookAccepted?(
    input: DeviceSyncPublicIngressWebhookAcceptedInput,
  ): DeviceSyncPublicIngressWebhookAcceptedResult | Promise<DeviceSyncPublicIngressWebhookAcceptedResult>;
  onUnknownWebhook?(input: DeviceSyncPublicIngressUnknownWebhookInput): void | Promise<void>;
}

export interface ProviderScheduleResult {
  jobs: DeviceSyncJobInput[];
  nextReconcileAt?: string | null;
}

export interface ProviderJobContext {
  account: DeviceSyncAccount;
  now: string;
  // Providers must route job-time side effects through this context instead of
  // reaching into service/store internals directly.
  importSnapshot(snapshot: unknown): Promise<unknown>;
  upsertConnectionSource?(
    input: Omit<UpsertDeviceConnectionSourceInput, "connectionId">,
  ): DeviceConnectionSourceRecord | Promise<DeviceConnectionSourceRecord>;
  listConnectionSources?(
    input?: Omit<ListDeviceConnectionSourcesInput, "connectionId">,
  ): DeviceConnectionSourceRecord[] | Promise<DeviceConnectionSourceRecord[]>;
  refreshAccountTokens(): Promise<DeviceSyncAccount>;
  disconnectAccount?(): Promise<void>;
  logger: DeviceSyncLogger;
}

export interface ProviderJobResult {
  scheduledJobs?: DeviceSyncJobInput[];
  metadataPatch?: Record<string, unknown>;
  nextReconcileAt?: string | null;
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
  | "historical_pull"
  | "introspect_resources"
  | "providers"
  | "refresh"
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
  refreshTokens?(account: DeviceSyncAccount): Promise<ProviderAuthTokens>;
  revokeAccess?(account: DeviceSyncAccount): Promise<void>;
}

export interface DeviceWebhookHandler {
  verifyAndParseWebhook(context: ProviderWebhookContext): Promise<ProviderWebhookResult>;
}

export interface DeviceJobExecutor {
  createScheduledJobs?(account: StoredDeviceSyncAccount, now: string): ProviderScheduleResult;
  executeJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult>;
}

export interface DeviceSyncOAuthAdapter {
  buildConnectUrl(input: {
    state: string;
    callbackUrl: string;
    scopes: string[];
    now: string;
  }): string;
  exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult>;
  refreshTokens(account: DeviceSyncAccount): Promise<ProviderAuthTokens>;
}

export interface DeviceSyncProvider {
  provider: string;
  descriptor: DeviceProviderDescriptor;
  credentialPolicy?: DeviceSyncProviderCredentialPolicy;
  connectionHandler?: DeviceConnectionHandler;
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
  connectSourceId?: string | null;
  connectTarget?: string | null;
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
