import type {
  DeviceSyncAccountStatus,
  DeviceSyncAccountRecord,
  DeviceSyncProviderDescriptor,
} from "./client.ts";
import type {
  DeviceProviderDescriptor,
  NamedDeviceProviderRegistry,
} from "@murphai/importers/device-providers/provider-descriptors";

export type { DeviceSyncAccountStatus } from "./client.ts";

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

export interface DeviceSyncHttpConfig {
  host?: string;
  port?: number;
  controlToken?: string;
  publicHost?: string;
  publicPort?: number;
  ouraWebhookVerificationToken?: string;
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
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export type PublicDeviceSyncAccount = DeviceSyncAccountRecord;

export interface StoredDeviceSyncAccount extends PublicDeviceSyncAccount {
  externalAccountId: string;
  disconnectGeneration: number;
  accessTokenEncrypted: string;
  hostedObservedTokenVersion: number | null;
  hostedObservedUpdatedAt: string | null;
  refreshTokenEncrypted: string | null;
}

export interface DeviceSyncAccount extends PublicDeviceSyncAccount {
  externalAccountId: string;
  disconnectGeneration: number;
  accessToken: string;
  refreshToken: string | null;
}

export interface ProviderAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresAt?: string;
}

export interface UpsertPublicDeviceSyncConnectionInput {
  ownerId?: string | null;
  provider: string;
  externalAccountId: string;
  displayName?: string | null;
  status?: DeviceSyncAccountStatus;
  scopes?: string[];
  tokens: ProviderAuthTokens;
  metadata?: Record<string, unknown>;
  connectedAt: string;
  nextReconcileAt?: string | null;
}

export interface DeviceSyncWebhookTraceRecord {
  provider: string;
  traceId: string;
  externalAccountId: string;
  eventType: string;
  receivedAt: string;
}

export interface ClaimDeviceSyncWebhookTraceInput extends DeviceSyncWebhookTraceRecord {
  processingExpiresAt: string;
}

export type DeviceSyncWebhookTraceClaimResult =
  | "claimed"
  | "processed"
  | "processing";

export interface DeviceSyncPublicIngressStore {
  deleteExpiredOAuthStates(now: string): number | Promise<number>;
  createOAuthState(input: OAuthStateRecord): OAuthStateRecord | Promise<OAuthStateRecord>;
  consumeOAuthState(state: string, now: string): OAuthStateRecord | null | Promise<OAuthStateRecord | null>;
  upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount | Promise<PublicDeviceSyncAccount>;
  getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): PublicDeviceSyncAccount | null | Promise<PublicDeviceSyncAccount | null>;
  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult | Promise<DeviceSyncWebhookTraceClaimResult>;
  completeWebhookTrace(provider: string, traceId: string): void | Promise<void>;
  releaseWebhookTrace(provider: string, traceId: string): void | Promise<void>;
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

export interface DeviceSyncJobRecord {
  id: string;
  provider: string;
  accountId: string;
  kind: string;
  payload: Record<string, unknown>;
  priority: number;
  availableAt: string;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
  status: "queued" | "running" | "succeeded" | "dead";
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProviderCallbackContext {
  callbackUrl: string;
  state: string;
  now: string;
  grantedScopes: string[];
}

export interface ProviderConnectionResult {
  externalAccountId: string;
  displayName?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  tokens: ProviderAuthTokens;
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
  eventType: string;
  traceId: string;
  occurredAt?: string;
  // Keep the shared parser result narrow so ingress hooks do not inherit raw provider payloads.
  resourceCategory?: string | null;
  jobs: DeviceSyncJobInput[];
}

export interface DeviceSyncIngressWebhook {
  eventType: string;
  jobs: readonly DeviceSyncJobInput[];
  occurredAt?: string;
  // Accepted and unknown ingress hooks should receive only the stripped webhook summary.
  resourceCategory?: string | null;
}

export interface ProviderWebhookAdminChallengeContext {
  url: URL;
  verificationToken: string | null;
}

export interface ProviderWebhookAdminEnsureContext {
  publicBaseUrl: string;
  verificationToken: string | null;
}

export interface ProviderWebhookAdminCapability {
  resolveVerificationChallenge?(context: ProviderWebhookAdminChallengeContext): string | null;
  ensureSubscriptions?(context: ProviderWebhookAdminEnsureContext): Promise<void>;
}

export interface DeviceSyncPublicIngressConnectionEstablishedInput {
  account: PublicDeviceSyncAccount;
  connection: ProviderConnectionResult;
  provider: DeviceSyncProvider;
  now: string;
}

export interface DeviceSyncPublicIngressWebhookAcceptedInput {
  account: PublicDeviceSyncAccount;
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
  importSnapshot(snapshot: unknown): Promise<unknown>;
  refreshAccountTokens(): Promise<DeviceSyncAccount>;
  logger: DeviceSyncLogger;
}

export interface ProviderJobResult {
  scheduledJobs?: DeviceSyncJobInput[];
  metadataPatch?: Record<string, unknown>;
  nextReconcileAt?: string | null;
}

export interface DeviceSyncProvider {
  provider: string;
  descriptor: DeviceProviderDescriptor;
  webhookAdmin?: ProviderWebhookAdminCapability;
  buildConnectUrl(input: {
    state: string;
    callbackUrl: string;
    scopes: string[];
    now: string;
  }): string;
  exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult>;
  refreshTokens(account: DeviceSyncAccount): Promise<ProviderAuthTokens>;
  revokeAccess?(account: DeviceSyncAccount): Promise<void>;
  createScheduledJobs?(account: StoredDeviceSyncAccount, now: string): ProviderScheduleResult;
  verifyAndParseWebhook?(context: ProviderWebhookContext): Promise<ProviderWebhookResult>;
  executeJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult>;
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
}

export interface BeginConnectionResult {
  provider: string;
  state: string;
  expiresAt: string;
  authorizationUrl: string;
}

export interface HandleOAuthCallbackInput {
  provider: string;
  state?: string | null;
  code?: string | null;
  scope?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}

export interface CompleteConnectionResult {
  account: PublicDeviceSyncAccount;
  returnTo: string | null;
}

export interface HandleWebhookResult {
  accepted: boolean;
  duplicate: boolean;
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
