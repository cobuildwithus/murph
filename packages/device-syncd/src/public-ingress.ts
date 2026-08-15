import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { sanitizeHostedRuntimeErrorText } from "./hosted-runtime.ts";
import {
  isDeviceSyncConnectionSetupPending,
  isDeviceSyncSourceAdmitted,
  isEstablishedDeviceSyncConnection,
} from "./public-account.ts";
import { resolveDeviceSyncProviderCredentialPolicy } from "./provider-credential-policy.ts";
import { resolvePublicProviderDefaultScopes } from "./public-provider-descriptor-shared.ts";
import {
  normalizeConfiguredDeviceSyncJobInput,
} from "./provider-job-definitions.ts";
import {
  DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
  parsePreparedDeviceSyncWebhook,
  type PreparedDeviceSyncWebhookV1,
} from "./prepared-webhook.ts";
import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";
import { buildJunctionProviderSourceInstanceKey } from "./config/junction-connect-sources.ts";
import {
  addMilliseconds,
  generateStateCode,
  joinUrl,
  normalizeOriginList,
  normalizePublicBaseUrl,
  normalizeString,
  resolveRelativeOrAllowedOriginUrl,
  sanitizeStoredDeviceSyncMetadata,
  scopeWebhookTraceId,
  sha256Text,
  splitScopeList,
  toIsoTimestamp,
} from "./shared.ts";

import type {
  BeginConnectionResult,
  CompleteConnectionResult,
  DeviceAccountCredential,
  DeviceConnectionHandler,
  DeviceSyncAccountSetupPhase,
  DeviceSyncAccount,
  DeviceSyncIngressWebhook,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncPublicIngressConnectionEstablishedInput,
  DeviceSyncPublicIngressHooks,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookAcceptanceMode,
  DeviceWebhookHandler,
  DeviceSyncRegistry,
  HandleConnectionCallbackInput,
  HandleOAuthCallbackInput,
  HandleWebhookResult,
  MarkPublicDeviceSyncConnectionSetupFailedResult,
  OAuthStateConsumeClaim,
  ProviderConnectionResult,
  ProviderBeginConnectionResult,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  SdkSignInSessionResult,
  StartConnectionInput,
  UpsertPublicDeviceSyncConnectionInput,
  UpsertPublicDeviceSyncConnectionResult,
} from "./types.ts";

export interface CreateDeviceSyncPublicIngressInput {
  publicBaseUrl: string;
  allowedReturnOrigins?: string[];
  registry: DeviceSyncRegistry;
  store: DeviceSyncPublicIngressStore;
  sessionTtlMs?: number;
  hooks?: DeviceSyncPublicIngressHooks;
  log?: DeviceSyncLogger;
}

function resolveDefinitivePreProviderOAuthCallbackError(
  provider: DeviceSyncProvider,
  query: URLSearchParams,
): ReturnType<typeof deviceSyncError> | null {
  if (resolveDeviceProviderConnectionDescriptor(provider.descriptor).kind !== "oauth2") {
    return null;
  }
  if (normalizeString(query.get("error")) !== undefined) {
    return deviceSyncError({
      code: "OAUTH_CALLBACK_REJECTED",
      message: "OAuth authorization was denied or canceled.",
      retryable: false,
      httpStatus: 400,
    });
  }
  if (normalizeString(query.get("code")) === undefined) {
    return deviceSyncError({
      code: "OAUTH_CODE_MISSING",
      message: "OAuth callback is missing the authorization code.",
      retryable: false,
      httpStatus: 400,
    });
  }
  return null;
}

const WEBHOOK_TRACE_PROCESSING_TTL_MS = 5 * 60_000;
const SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY =
  "__murphSeededConnectionAccountId";
const SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY =
  "__murphSeededConnectionExternalAccountId";
const SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY =
  "__murphSeededConnectionSetupExpiresAt";
const SEEDED_CONNECTION_CONNECTED_AT_STATE_METADATA_KEY =
  "__murphSeededConnectionConnectedAt";
const LEGACY_SEEDED_CONNECTION_UPDATED_AT_STATE_METADATA_KEY =
  "__murphSeededConnectionUpdatedAt";
const CONNECT_SOURCE_ID_STATE_METADATA_KEY =
  "__murphConnectSourceId";
const CONNECT_TARGET_STATE_METADATA_KEY =
  "__murphConnectTarget";
const SOURCE_PROVIDER_SLUG_STATE_METADATA_KEY =
  "__murphSourceProviderSlug";

function toIngressWebhook(parsed: {
  acceptanceMode: DeviceSyncWebhookAcceptanceMode;
  eventType: string;
  jobs: DeviceSyncIngressWebhook["jobs"];
  occurredAt?: string;
  providerSentAt?: string;
  resourceCategory?: string | null;
  sourceProviderSlug?: string | null;
  dataSourceProviderSlug?: string | null;
}): DeviceSyncIngressWebhook {
  const resourceCategory = normalizeString(parsed.resourceCategory);
  const sourceProviderSlug = normalizeString(parsed.sourceProviderSlug);
  const dataSourceProviderSlug = normalizeString(parsed.dataSourceProviderSlug);

  return {
    acceptanceMode: parsed.acceptanceMode,
    eventType: parsed.eventType,
    jobs: [...parsed.jobs],
    ...(parsed.occurredAt ? { occurredAt: parsed.occurredAt } : {}),
    ...(parsed.providerSentAt ? { providerSentAt: parsed.providerSentAt } : {}),
    ...(resourceCategory ? { resourceCategory } : {}),
    ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
    ...(dataSourceProviderSlug ? { dataSourceProviderSlug } : {}),
  };
}

async function beginProviderConnection(
  provider: DeviceSyncProvider,
  input: Parameters<DeviceConnectionHandler["beginConnection"]>[0],
): Promise<ProviderBeginConnectionResult> {
  if (!provider.connectionHandler) {
    throw deviceSyncError({
      code: "CONNECTION_FLOW_NOT_SUPPORTED",
      message: `Device sync provider ${provider.provider} does not support connection start.`,
      retryable: false,
      httpStatus: 500,
    });
  }

  return provider.connectionHandler.beginConnection(input);
}

async function completeProviderConnection(
  provider: DeviceSyncProvider,
  input: Parameters<DeviceConnectionHandler["completeConnection"]>[0],
): Promise<ProviderConnectionResult> {
  if (!provider.connectionHandler) {
    throw deviceSyncError({
      code: "CONNECTION_CALLBACK_NOT_SUPPORTED",
      message: `Device sync provider ${provider.provider} does not support connection callbacks.`,
      retryable: false,
      httpStatus: 500,
    });
  }

  const connection = await provider.connectionHandler.completeConnection(input);
  const { tokens: _legacyTokens, ...connectionWithoutLegacyTokens } = connection;

  return {
    ...connectionWithoutLegacyTokens,
    credential: resolveProviderConnectionCredential(connection),
  };
}

function resolveProviderConnectionCredential(
  connection: ProviderConnectionResult,
): NonNullable<ProviderConnectionResult["credential"]> {
  const credential = readProviderConnectionCredential(connection);

  if (credential) {
    return credential;
  }

  throw deviceSyncError({
    code: "CONNECTION_CREDENTIAL_MISSING",
    message: "Device sync connection did not return account credentials.",
    retryable: false,
    httpStatus: 500,
  });
}

function readProviderConnectionCredential(
  connection: ProviderConnectionResult,
): DeviceAccountCredential | null {
  if (connection.credential && connection.tokens) {
    throw deviceSyncError({
      code: "CONNECTION_CREDENTIAL_AMBIGUOUS",
      message: "Device sync connection returned both credential and legacy token material.",
      retryable: false,
      httpStatus: 500,
    });
  }

  if (connection.credential) {
    return connection.credential;
  }

  if (connection.tokens) {
    return {
      kind: "oauth_tokens",
      tokens: connection.tokens,
    };
  }

  return null;
}

function validateProviderConnectionCredential(
  provider: DeviceSyncProvider,
  credential: DeviceAccountCredential,
): void {
  const credentialPolicy = resolveDeviceSyncProviderCredentialPolicy(provider);

  if (credential.kind !== credentialPolicy.kind) {
    throw deviceSyncError({
      code: "CONNECTION_CREDENTIAL_POLICY_MISMATCH",
      message: `Device sync provider ${provider.provider} returned ${credential.kind} credentials but is configured for ${credentialPolicy.kind}.`,
      retryable: false,
      httpStatus: 500,
    });
  }

  if (
    credential.kind === "provider_config"
    && credentialPolicy.kind === "provider_config"
    && credential.providerConfigKey !== credentialPolicy.providerConfigKey
  ) {
    throw deviceSyncError({
      code: "PROVIDER_CONFIG_KEY_MISMATCH",
      message: `Device sync provider ${provider.provider} returned an unexpected provider config key.`,
      retryable: false,
      httpStatus: 500,
    });
  }
}

function resolveAndValidateProviderConnectionCredential(
  provider: DeviceSyncProvider,
  connection: ProviderConnectionResult,
): DeviceAccountCredential {
  const credential = resolveProviderConnectionCredential(connection);
  validateProviderConnectionCredential(provider, credential);
  return credential;
}

function buildConnectionCallbackQuery(input: HandleConnectionCallbackInput): URLSearchParams {
  if (input.query) {
    return new URLSearchParams(input.query);
  }

  const query = new URLSearchParams();
  const add = (key: string, value: string | null | undefined): void => {
    const normalized = normalizeString(value);

    if (normalized) {
      query.set(key, normalized);
    }
  };

  add("state", input.state);
  add("code", input.code);
  add("scope", input.scope);
  add("error", input.error);
  add("error_description", input.errorDescription);
  return query;
}

function prepareConnectionCallback(input: HandleConnectionCallbackInput): {
  query: URLSearchParams;
  receivedAt: string;
  state: string;
} {
  const query = buildConnectionCallbackQuery(input);
  const state =
    normalizeString(input.state)
    ?? normalizeString(query.get("murph_state"))
    ?? normalizeString(query.get("state"));

  if (!state) {
    throw deviceSyncError({
      code: "OAUTH_STATE_MISSING",
      message: "Device connection callback is missing the state parameter.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return {
    query,
    receivedAt: toIsoTimestamp(new Date()),
    state,
  };
}

function buildConnectionStateMetadata(input: {
  providerMetadata: Record<string, unknown> | undefined;
  connectSourceId?: string | null;
  connectTarget?: string | null;
  sourceProviderSlug?: string | null;
}): Record<string, unknown> {
  const metadata = sanitizeConnectionStateMetadata(input.providerMetadata);
  const connectSourceId = normalizeString(input.connectSourceId);
  const connectTarget = normalizeString(input.connectTarget);
  const sourceProviderSlug = normalizeString(input.sourceProviderSlug);

  return {
    ...metadata,
    ...(connectSourceId ? { [CONNECT_SOURCE_ID_STATE_METADATA_KEY]: connectSourceId } : {}),
    ...(connectTarget ? { [CONNECT_TARGET_STATE_METADATA_KEY]: connectTarget } : {}),
    ...(sourceProviderSlug ? { [SOURCE_PROVIDER_SLUG_STATE_METADATA_KEY]: sourceProviderSlug } : {}),
  };
}

function buildProviderConnectionStateMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const providerMetadata = { ...metadata };
  delete providerMetadata.ownerId;
  delete providerMetadata[SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY];
  delete providerMetadata[SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY];
  delete providerMetadata[SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY];
  delete providerMetadata[SEEDED_CONNECTION_CONNECTED_AT_STATE_METADATA_KEY];
  delete providerMetadata[LEGACY_SEEDED_CONNECTION_UPDATED_AT_STATE_METADATA_KEY];
  delete providerMetadata[CONNECT_SOURCE_ID_STATE_METADATA_KEY];
  delete providerMetadata[CONNECT_TARGET_STATE_METADATA_KEY];
  delete providerMetadata[SOURCE_PROVIDER_SLUG_STATE_METADATA_KEY];
  return sanitizeConnectionStateMetadata(providerMetadata);
}

function sanitizeConnectionStateMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const metadata = sanitizeStoredDeviceSyncMetadata(value ?? {});
  delete metadata[SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY];
  delete metadata[SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY];
  delete metadata[SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY];
  delete metadata[SEEDED_CONNECTION_CONNECTED_AT_STATE_METADATA_KEY];
  delete metadata[LEGACY_SEEDED_CONNECTION_UPDATED_AT_STATE_METADATA_KEY];
  delete metadata[CONNECT_SOURCE_ID_STATE_METADATA_KEY];
  delete metadata[CONNECT_TARGET_STATE_METADATA_KEY];
  delete metadata[SOURCE_PROVIDER_SLUG_STATE_METADATA_KEY];

  for (const key of Object.keys(metadata)) {
    if (isBlockedConnectionStateMetadataKey(key)) {
      delete metadata[key];
    }
  }

  return metadata;
}

function isBlockedConnectionStateMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  if (normalized.includes("hash") || normalized.includes("blindindex")) {
    return false;
  }

  return normalized.includes("ownerid")
    || normalized.includes("user")
    || normalized.includes("clientid")
    || normalized.includes("accountid")
    || normalized.includes("secret")
    || normalized.includes("hmac")
    || normalized.includes("webhook");
}

function readSeededConnectionAccountId(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const value = metadata?.[SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY];
  return typeof value === "string" ? normalizeString(value) ?? null : null;
}

function readSeededConnectionExternalAccountId(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const value = metadata?.[SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY];
  return typeof value === "string" ? normalizeString(value) ?? null : null;
}

function readSeededConnectionSetupExpiresAt(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const value = metadata?.[SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY];
  return typeof value === "string" ? normalizeString(value) ?? null : null;
}

function readSeededConnectionConnectedAt(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const value = metadata?.[SEEDED_CONNECTION_CONNECTED_AT_STATE_METADATA_KEY];
  return typeof value === "string" ? normalizeString(value) ?? null : null;
}

function readConnectSourceId(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const value = metadata?.[CONNECT_SOURCE_ID_STATE_METADATA_KEY];
  return typeof value === "string" ? normalizeString(value) ?? null : null;
}

function readConnectTarget(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.[CONNECT_TARGET_STATE_METADATA_KEY];
  return typeof value === "string" ? normalizeString(value) ?? null : null;
}

function readSourceProviderSlug(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.[SOURCE_PROVIDER_SLUG_STATE_METADATA_KEY];
  return typeof value === "string" ? normalizeString(value) ?? null : null;
}

function setSeededConnectionStateMetadata(
  metadata: Record<string, unknown>,
  account: PublicDeviceSyncAccount,
): Record<string, unknown> {
  const setupExpiresAt = normalizeString(account.setupExpiresAt);

  return {
    ...metadata,
    [SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY]: account.id,
    [SEEDED_CONNECTION_CONNECTED_AT_STATE_METADATA_KEY]: account.connectedAt,
    ...(setupExpiresAt
      ? { [SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY]: setupExpiresAt }
      : {}),
  };
}

function resolveConnectionSetupPhase(
  connection: ProviderConnectionResult,
  connectionKind: PublicProviderDescriptor["connectionKind"],
): DeviceSyncAccountSetupPhase | null {
  if (Object.prototype.hasOwnProperty.call(connection, "setupPhase")) {
    const setupPhase = connection.setupPhase ?? null;
    return setupPhase === "pending_link" || setupPhase === "link_returned"
      ? "source_confirmed"
      : setupPhase;
  }

  return connectionKind === "external_link" ? "source_confirmed" : null;
}

function resolveConnectionSetupExpiresAt(input: {
  connection: ProviderConnectionResult;
  setupPhase: DeviceSyncAccountSetupPhase | null;
  seededSetupExpiresAt: string | null;
}): string | null {
  if (input.setupPhase !== "pending_link" && input.setupPhase !== "link_returned") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(input.connection, "setupExpiresAt")) {
    return input.connection.setupExpiresAt ?? null;
  }

  return input.seededSetupExpiresAt;
}

function shouldRunSdkConnectionEstablishedHook(existingAccount: PublicDeviceSyncAccount | null): boolean {
  return !existingAccount || !isEstablishedDeviceSyncConnection(existingAccount);
}

function sdkSignInReconnectRequired(): ReturnType<typeof deviceSyncError> {
  return deviceSyncError({
    code: "SDK_SIGN_IN_RECONNECT_REQUIRED",
    message: "Reconnect the device-sync provider before resuming SDK sign-in.",
    retryable: false,
    httpStatus: 409,
  });
}

function assertSeededConnectionExternalAccountMatches(input: {
  provider: DeviceSyncProvider;
  seededExternalAccountId: string | null;
  connection: ProviderConnectionResult;
}): void {
  if (
    input.seededExternalAccountId
    && input.connection.externalAccountId !== input.seededExternalAccountId
  ) {
    throw deviceSyncError({
      code: "CONNECTION_SEEDED_ACCOUNT_MISMATCH",
      message: `Device sync provider ${input.provider.provider} callback returned a different account than the seeded connection.`,
      retryable: false,
      httpStatus: 500,
    });
  }
}

function connectionFlowRequiresCallbackUrl(
  connectionKind: PublicProviderDescriptor["connectionKind"],
): boolean {
  return connectionKind === "oauth2" || connectionKind === "external_link";
}

function connectionSourceStartStaleError(): never {
  throw deviceSyncError({
    code: "CONNECTION_SOURCE_START_STALE",
    message: "Device source state changed while its connection link was starting. Retry.",
    retryable: true,
    httpStatus: 409,
  });
}

export class DeviceSyncPublicIngress {
  readonly publicBaseUrl: string;
  readonly allowedReturnOrigins: string[];
  readonly registry: DeviceSyncRegistry;

  private readonly store: DeviceSyncPublicIngressStore;
  private readonly sessionTtlMs: number;
  private readonly hooks: DeviceSyncPublicIngressHooks;
  private readonly logger: DeviceSyncLogger;

  constructor(input: CreateDeviceSyncPublicIngressInput) {
    this.publicBaseUrl = normalizePublicBaseUrl(input.publicBaseUrl);
    this.allowedReturnOrigins = normalizeOriginList(input.allowedReturnOrigins);
    this.registry = input.registry;
    this.store = input.store;
    this.sessionTtlMs = Math.max(60_000, input.sessionTtlMs ?? 15 * 60_000);
    this.hooks = input.hooks ?? {};
    this.logger = input.log ?? console;
  }

  private async runConnectionMutation<Result>(
    provider: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    return this.hooks.runConnectionMutation
      ? await this.hooks.runConnectionMutation({ provider }, operation)
      : await operation();
  }

  describeProviders(): PublicProviderDescriptor[] {
    return this.registry.list().map((provider) => this.describeProvider(provider));
  }

  describeProvider(providerName: string | DeviceSyncProvider): PublicProviderDescriptor {
    const provider = typeof providerName === "string" ? this.requireProvider(providerName) : providerName;
    const connection = resolveDeviceProviderConnectionDescriptor(provider.descriptor);
    const callbackPath = connection.callbackPath ?? null;
    const webhookPath = provider.descriptor.webhook?.path ?? null;

    return {
      provider: provider.provider,
      connectionKind: connection.kind,
      credentialPolicy: resolveDeviceSyncProviderCredentialPolicy(provider).kind,
      callbackPath,
      callbackUrl: callbackPath ? joinUrl(this.publicBaseUrl, callbackPath) : null,
      webhookPath,
      webhookUrl: webhookPath ? joinUrl(this.publicBaseUrl, webhookPath) : null,
      supportsWebhooks: Boolean(webhookPath && resolveProviderWebhookVerifier(provider)),
      defaultScopes: resolvePublicProviderDefaultScopes(provider.descriptor, connection),
    };
  }

  async startConnection(input: StartConnectionInput): Promise<BeginConnectionResult> {
    const provider = this.requireProvider(input.provider);
    return await this.runConnectionMutation(provider.provider, () =>
      this.startConnectionForProvider(provider, input)
    );
  }

  private async startConnectionForProvider(
    provider: DeviceSyncProvider,
    input: StartConnectionInput,
  ): Promise<BeginConnectionResult> {
    const now = toIsoTimestamp(new Date());
    const descriptor = this.describeProvider(provider);
    const returnTo = this.resolveReturnTo(input.returnTo ?? null);
    const state = generateStateCode();
    const expiresAt = addMilliseconds(now, this.sessionTtlMs);

    if (descriptor.connectionKind === "none") {
      throw deviceSyncError({
        code: "CONNECTION_FLOW_NOT_SUPPORTED",
        message: `Device sync provider ${provider.provider} does not support connection start.`,
        retryable: false,
        httpStatus: 500,
      });
    }

    if (!descriptor.callbackUrl && connectionFlowRequiresCallbackUrl(descriptor.connectionKind)) {
      throw deviceSyncError({
        code: "CONNECTION_CALLBACK_URL_REQUIRED",
        message: `Device sync provider ${provider.provider} requires a connection callback URL but does not define a callback path.`,
        retryable: false,
        httpStatus: 500,
      });
    }

    await this.store.deleteExpiredOAuthStates(now);
    const started = await beginProviderConnection(provider, {
      state,
      callbackUrl: descriptor.callbackUrl ?? "",
      publicBaseUrl: this.publicBaseUrl,
      scopes: descriptor.defaultScopes,
      now,
      ownerId: input.ownerId ?? null,
      sourceProviderSlug: input.sourceProviderSlug ?? null,
    });

    const sourceProviderSlug = normalizeString(input.sourceProviderSlug);
    let seededAccount: PublicDeviceSyncAccount | null = null;
    let reusedEstablishedJunctionAccount = false;
    if (started.connectionSeed) {
      validateProviderConnectionCredential(provider, started.connectionSeed.credential);
      seededAccount = await this.store.upsertConnection({
        ownerId: input.ownerId ?? null,
        provider: provider.provider,
        externalAccountId: started.connectionSeed.externalAccountId,
        displayName: started.connectionSeed.displayName ?? null,
        status: started.connectionSeed.status ?? "active",
        setupPhase: started.connectionSeed.setupPhase ?? "pending_link",
        setupExpiresAt: started.connectionSeed.setupExpiresAt ?? expiresAt,
        scopes: started.connectionSeed.scopes ?? started.scopes ?? descriptor.defaultScopes,
        credential: started.connectionSeed.credential,
        metadata: started.connectionSeed.metadata ?? {},
        existingAccountPolicy:
          provider.provider === "junction" && sourceProviderSlug !== null
            ? "preserve_established"
            : "replace",
        connectedAt: now,
        nextReconcileAt: started.connectionSeed.nextReconcileAt ?? null,
      });
      reusedEstablishedJunctionAccount =
        provider.provider === "junction"
        && sourceProviderSlug !== null
        && isEstablishedDeviceSyncConnection(seededAccount);
      const sourceInstanceKey = provider.provider === "junction" && sourceProviderSlug
        ? buildJunctionProviderSourceInstanceKey({
            connectionId: seededAccount.id,
            sourceProviderSlug,
          })
        : null;
      if (
        sourceInstanceKey
        && sourceProviderSlug
        && !(reusedEstablishedJunctionAccount && input.sourceLifecycleProof)
      ) {
        await this.store.upsertConnectionSource({
          connectionId: seededAccount.id,
          sourceInstanceKey,
          sourceProviderSlug,
          status: "disconnected",
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }

    let stateMetadata = buildConnectionStateMetadata({
      providerMetadata: started.stateMetadata,
      connectSourceId: input.connectSourceId ?? null,
      connectTarget: input.connectTarget ?? null,
      sourceProviderSlug: input.sourceProviderSlug ?? null,
    });
    if (seededAccount) {
      stateMetadata = setSeededConnectionStateMetadata(stateMetadata, seededAccount);
    }

    const requirePreparedSourceLifecycleCurrent = async () => {
      const proof = input.sourceLifecycleProof ?? null;
      if (!proof) {
        return;
      }
      if (
        !reusedEstablishedJunctionAccount
        || !seededAccount
        || !sourceProviderSlug
        || proof.connectionId !== seededAccount.id
        || normalizeString(proof.sourceProviderSlug) !== sourceProviderSlug
      ) {
        connectionSourceStartStaleError();
      }
      const sources = await this.store.listConnectionSources({
        connectionId: seededAccount.id,
        sourceProviderSlug,
      });
      const source = sources.find(
        (candidate) => candidate.sourceInstanceKey === proof.sourceInstanceKey,
      );
      if (
        !source
        || source.lastSeenAt !== proof.lastSeenAt
        || source.lastErrorCode !== null
        || source.status !== "disconnected"
      ) {
        connectionSourceStartStaleError();
      }
    };

    try {
      await requirePreparedSourceLifecycleCurrent();
      await this.store.createOAuthState({
        state,
        provider: provider.provider,
        returnTo,
        ownerId: input.ownerId ?? null,
        createdAt: now,
        expiresAt,
        metadata: stateMetadata,
      });
      await requirePreparedSourceLifecycleCurrent();
    } catch (error) {
      if (seededAccount && !reusedEstablishedJunctionAccount) {
        await this.markSeededConnectionSetupFailed(
          provider,
          seededAccount.id,
          seededAccount.connectedAt,
          null,
          input.ownerId ?? null,
          now,
          error,
        );
      }
      throw error;
    }

    return {
      provider: provider.provider,
      state,
      expiresAt,
      authorizationUrl: started.authorizationUrl,
    };
  }

  async handleOAuthCallback(input: HandleOAuthCallbackInput): Promise<CompleteConnectionResult> {
    return this.handleConnectionCallback(input);
  }

  /**
   * Ensures an established device-sync account for a mobile SDK sign-in and
   * mints the provider's short-lived SDK sign-in token.
   *
   * This reuses the exact established-connection persistence the Link/OAuth
   * callback uses: `store.upsertConnection` is keyed on
   * (provider, externalAccountId), so an owner with a prior Link connection
   * resolves to the same account row instead of a duplicate, and webhook
   * ingestion (`getConnectionByExternalAccount`) can accept SDK-driven
   * webhooks immediately instead of orphan-delaying them. The sign-in token
   * is minted only after the account exists, is returned exactly once, and is
   * never logged or persisted.
   */
  async createSdkSignInSession(input: {
    provider: string;
    ownerId: string;
  }): Promise<SdkSignInSessionResult> {
    const provider = this.requireProvider(input.provider);
    return await this.runConnectionMutation(provider.provider, () =>
      this.createSdkSignInSessionForProvider(provider, input)
    );
  }

  /**
   * Mints an SDK sign-in token for one exact established account without
   * ensuring, creating, or reactivating provider lifecycle state.
   */
  async resumeSdkSignInSession(input: {
    accountId: string;
    provider: string;
    ownerId: string;
  }): Promise<SdkSignInSessionResult> {
    const provider = this.requireProvider(input.provider);
    return await this.runConnectionMutation(provider.provider, () =>
      this.resumeSdkSignInSessionForProvider(provider, input)
    );
  }

  private async resumeSdkSignInSessionForProvider(
    provider: DeviceSyncProvider,
    input: {
      accountId: string;
      provider: string;
      ownerId: string;
    },
  ): Promise<SdkSignInSessionResult> {
    const handler = provider.sdkConnectionHandler;
    if (!handler) {
      throw deviceSyncError({
        code: "SDK_SIGN_IN_NOT_SUPPORTED",
        message: `Device sync provider ${provider.provider} does not support SDK sign-in sessions.`,
        retryable: false,
        httpStatus: 500,
      });
    }

    const ownerId = normalizeString(input.ownerId);
    if (!ownerId) {
      throw deviceSyncError({
        code: "CONNECTION_OWNER_REQUIRED",
        message: "SDK sign-in sessions must be initiated by an authenticated user.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const accountId = normalizeString(input.accountId);
    const account = accountId
      ? await this.store.getConnectionById(accountId)
      : null;
    if (
      !account
      || account.provider !== provider.provider
      || !isEstablishedDeviceSyncConnection(account)
      || !(await this.connectionBelongsToOwner(account.id, ownerId))
    ) {
      throw sdkSignInReconnectRequired();
    }

    const token = await handler.createSignInToken({
      externalAccountId: account.externalAccountId,
    });

    // A disconnect can race a provider token mint. Re-read before returning
    // so a token minted during that race is never handed to the companion.
    const currentAccount = await this.store.getConnectionById(account.id);
    if (
      !currentAccount
      || currentAccount.provider !== provider.provider
      || currentAccount.externalAccountId !== account.externalAccountId
      || !isEstablishedDeviceSyncConnection(currentAccount)
      || !(await this.connectionBelongsToOwner(currentAccount.id, ownerId))
    ) {
      throw sdkSignInReconnectRequired();
    }

    return {
      account: currentAccount,
      signInToken: token.signInToken,
      environment: token.environment,
    };
  }

  private async createSdkSignInSessionForProvider(
    provider: DeviceSyncProvider,
    input: {
      provider: string;
      ownerId: string;
    },
  ): Promise<SdkSignInSessionResult> {
    const ensured = await this.ensureSdkConnectionForProvider(provider, input);
    const token = await ensured.handler.createSignInToken({
      externalAccountId: ensured.connection.externalAccountId,
    });

    return {
      account: ensured.account,
      signInToken: token.signInToken,
      environment: token.environment,
    };
  }

  private async ensureSdkConnectionForProvider(
    provider: DeviceSyncProvider,
    input: {
      provider: string;
      ownerId: string;
    },
  ): Promise<{
    account: PublicDeviceSyncAccount;
    connection: ProviderConnectionResult;
    handler: NonNullable<DeviceSyncProvider["sdkConnectionHandler"]>;
  }> {
    const handler = provider.sdkConnectionHandler;

    if (!handler) {
      throw deviceSyncError({
        code: "SDK_SIGN_IN_NOT_SUPPORTED",
        message: `Device sync provider ${provider.provider} does not support SDK sign-in sessions.`,
        retryable: false,
        httpStatus: 500,
      });
    }

    const ownerId = normalizeString(input.ownerId);
    if (!ownerId) {
      throw deviceSyncError({
        code: "CONNECTION_OWNER_REQUIRED",
        message: "SDK sign-in sessions must be initiated by an authenticated user.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const now = toIsoTimestamp(new Date());
    const descriptor = this.describeProvider(provider);
    const connection = await handler.ensureConnection({ ownerId, now });
    const initialJobs = connection.initialJobs?.map((job) =>
      normalizeConfiguredDeviceSyncJobInput(provider.provider, job, "sdk sign-in")
    );
    const setupPhase = resolveConnectionSetupPhase(connection, descriptor.connectionKind);
    const existingAccount = await this.store.getConnectionByExternalAccount(
      provider.provider,
      connection.externalAccountId,
    );
    const canReuseExistingAccount = existingAccount
      ? await this.canReuseEstablishedSdkConnection(existingAccount, ownerId)
      : false;

    let account: PublicDeviceSyncAccount;
    let previousAccount = existingAccount;
    if (canReuseExistingAccount && existingAccount) {
      account = existingAccount;
    } else {
      const persisted = await this.upsertConnectionWithPrevious({
        ownerId,
        provider: provider.provider,
        externalAccountId: connection.externalAccountId,
        displayName: connection.displayName ?? null,
        status: "active",
        setupPhase,
        setupExpiresAt: resolveConnectionSetupExpiresAt({
          connection,
          setupPhase,
          seededSetupExpiresAt: null,
        }),
        scopes: connection.scopes?.length
          ? [...connection.scopes]
          : [...descriptor.defaultScopes],
        credential: resolveAndValidateProviderConnectionCredential(provider, connection),
        metadata: connection.metadata ?? {},
        existingAccountPolicy: "preserve_established",
        connectedAt: now,
        nextReconcileAt: connection.nextReconcileAt ?? null,
      });
      account = persisted.account;
      previousAccount = persisted.previousAccount;
    }

    if (!canReuseExistingAccount && shouldRunSdkConnectionEstablishedHook(previousAccount)) {
      try {
        await this.runSdkConnectionEstablishedHook({
          account,
          connection: {
            ...connection,
            ...(initialJobs ? { initialJobs } : {}),
          },
          provider,
          now,
        });
      } catch (error) {
        await this.cleanupPersistedOAuthConnection(
          provider,
          account,
          connection,
          now,
          error,
        );
        throw error;
      }
    }

    return {
      account,
      connection,
      handler,
    };
  }

  private async upsertConnectionWithPrevious(
    input: UpsertPublicDeviceSyncConnectionInput,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    const upsertConnectionWithPrevious = this.store.upsertConnectionWithPrevious;
    if (upsertConnectionWithPrevious) {
      return await upsertConnectionWithPrevious.call(this.store, input);
    }

    const previousAccount = await this.store.getConnectionByExternalAccount(
      input.provider,
      input.externalAccountId,
    );
    const account = await this.store.upsertConnection(input);
    return { account, previousAccount };
  }

  private async canReuseEstablishedSdkConnection(
    account: PublicDeviceSyncAccount,
    ownerId: string,
  ): Promise<boolean> {
    if (!isEstablishedDeviceSyncConnection(account)) {
      return false;
    }

    return await this.connectionBelongsToOwner(account.id, ownerId);
  }

  private async connectionBelongsToOwner(
    accountId: string,
    ownerId: string,
  ): Promise<boolean> {
    const getConnectionOwnerId = this.store.getConnectionOwnerId;
    return getConnectionOwnerId
      ? await getConnectionOwnerId.call(this.store, accountId) === ownerId
      : false;
  }

  private async runSdkConnectionEstablishedHook(
    input: DeviceSyncPublicIngressConnectionEstablishedInput,
  ): Promise<void> {
    await this.hooks.onConnectionEstablished?.(input);
  }

  async handleConnectionCallback(input: HandleConnectionCallbackInput): Promise<CompleteConnectionResult> {
    const provider = this.requireProvider(input.provider);
    const callback = prepareConnectionCallback(input);
    return await this.runConnectionMutation(provider.provider, () =>
      this.handleConnectionCallbackForProvider(provider, input, callback)
    );
  }

  private async handleConnectionCallbackForProvider(
    provider: DeviceSyncProvider,
    input: HandleConnectionCallbackInput,
    callback: ReturnType<typeof prepareConnectionCallback>,
  ): Promise<CompleteConnectionResult> {
    const now = callback.receivedAt;
    const descriptor = this.describeProvider(provider);
    const callbackQuery = callback.query;
    const state = callback.state;

    const expectedOwnerId = normalizeString(input.expectedOwnerId);
    const preProviderError = resolveDefinitivePreProviderOAuthCallbackError(
      provider,
      callbackQuery,
    );
    const stateResult = preProviderError
      ? await this.store.discardUnconsumedOAuthState(
          state,
          now,
          provider.provider,
          expectedOwnerId ?? undefined,
        )
      : await this.store.consumeOAuthState(
          state,
          now,
          provider.provider,
          expectedOwnerId ?? undefined,
        );

    if (stateResult.status === "missing") {
      throw deviceSyncError({
        code: "OAUTH_STATE_INVALID",
        message: "OAuth state is invalid or expired.",
        retryable: false,
        httpStatus: 400,
      });
    }

    if (stateResult.status === "provider_mismatch") {
      throw deviceSyncError({
        code: "OAUTH_PROVIDER_MISMATCH",
        message: `OAuth state belongs to provider ${stateResult.provider}, not ${provider.provider}.`,
        retryable: false,
        httpStatus: 400,
      });
    }

    if (stateResult.status === "owner_mismatch") {
      throw deviceSyncError({
        code: "OAUTH_STATE_OWNER_MISMATCH",
        message: "OAuth state belongs to a different Murph session.",
        retryable: false,
        httpStatus: 403,
      });
    }

    if (stateResult.status === "replayed") {
      // Browsers deliver callback navigations at-least-once (refresh, tab
      // restore, provider completion-page retries); the earlier delivery owns
      // the outcome, so redelivery must not redo the connection work. The
      // attached context lets transports send the user back into the app,
      // where connection truth is rendered from the store.
      throw attachOAuthCallbackContext(
        deviceSyncError({
          code: "OAUTH_STATE_REPLAYED",
          message: "OAuth callback state was already handled by an earlier delivery.",
          retryable: false,
          httpStatus: 409,
        }),
        {
          connectSourceId: readConnectSourceId(stateResult.record.metadata),
          connectTarget: readConnectTarget(stateResult.record.metadata),
          provider: provider.provider,
          returnTo: this.sanitizeStoredReturnTo(stateResult.record.returnTo ?? null),
        },
      );
    }

    if (stateResult.status === "recovery_required") {
      throw attachOAuthCallbackContext(
        deviceSyncError({
          code: "OAUTH_CALLBACK_RECOVERY_REQUIRED",
          message: "This provider connection did not finish safely. Remove Murph access in the provider account before deleting your Murph account, or contact support.",
          retryable: false,
          httpStatus: 409,
        }),
        {
          connectSourceId: readConnectSourceId(stateResult.record.metadata),
          connectTarget: readConnectTarget(stateResult.record.metadata),
          provider: provider.provider,
          returnTo: this.sanitizeStoredReturnTo(stateResult.record.returnTo ?? null),
        },
      );
    }

    if (stateResult.status === "discarded") {
      const callbackError = normalizeString(callbackQuery.get("error"));
      if (callbackError) {
        this.logger.warn?.("OAuth callback was rejected by the provider.", {
          provider: provider.provider,
          callbackError,
        });
      }
      throw attachOAuthCallbackContext(preProviderError!, {
        connectSourceId: readConnectSourceId(stateResult.record.metadata),
        connectTarget: readConnectTarget(stateResult.record.metadata),
        provider: provider.provider,
        returnTo: this.sanitizeStoredReturnTo(stateResult.record.returnTo ?? null),
      });
    }

    const stateRecord = stateResult.record;
    const returnTo = this.sanitizeStoredReturnTo(stateRecord.returnTo ?? null);
    const seededAccountId = readSeededConnectionAccountId(stateRecord.metadata);
    let seededExternalAccountId = readSeededConnectionExternalAccountId(stateRecord.metadata);
    const seededSetupExpiresAt = readSeededConnectionSetupExpiresAt(stateRecord.metadata);
    const seededConnectedAt = seededAccountId
      ? readSeededConnectionConnectedAt(stateRecord.metadata) ?? stateRecord.createdAt
      : null;
    const connectSourceId = readConnectSourceId(stateRecord.metadata);
    const connectTarget = readConnectTarget(stateRecord.metadata);
    const sourceProviderSlug = readSourceProviderSlug(stateRecord.metadata);
    const callbackContext = {
      connectSourceId,
      connectTarget,
      provider: provider.provider,
      returnTo,
    };
    let connection: ProviderConnectionResult | null = null;
    let account: PublicDeviceSyncAccount | null = null;
    let connectionPersisted = false;
    let providerWorkStarted = false;
    let reusedEstablishedJunctionAccount = false;
    let seededAccount: PublicDeviceSyncAccount | null = null;

    try {
      seededAccount = seededAccountId ? await this.store.getConnectionById(seededAccountId) : null;

    if (seededAccount && seededAccount.provider !== provider.provider) {
      throw attachOAuthCallbackContext(
        deviceSyncError({
          code: "CONNECTION_SEEDED_ACCOUNT_MISMATCH",
          message: "Device sync connection callback referenced a seeded account for another provider.",
          retryable: false,
          httpStatus: 400,
        }),
        callbackContext,
      );
    }

    if (seededAccountId && !seededAccount) {
      throw attachOAuthCallbackContext(
        deviceSyncError({
          code: "CONNECTION_SEEDED_ACCOUNT_MISMATCH",
          message: "Device sync connection callback referenced an unexpected seeded account.",
          retryable: false,
          httpStatus: 400,
        }),
        callbackContext,
      );
    }

    if (seededAccount?.status === "disconnected") {
      throw attachOAuthCallbackContext(
        deviceSyncError({
          code: "CONNECTION_ALREADY_DISCONNECTED",
          message: "Device sync connection callback was received after the seeded account was disconnected.",
          retryable: false,
          httpStatus: 409,
        }),
        callbackContext,
      );
    }

    if (seededAccount && seededAccount.connectedAt !== seededConnectedAt) {
      throw attachOAuthCallbackContext(
        deviceSyncError({
          code: "CONNECTION_SEEDED_ACCOUNT_CHANGED",
          message: "Device sync connection changed after this connection flow started.",
          retryable: false,
          httpStatus: 409,
        }),
        callbackContext,
      );
    }

    seededExternalAccountId = seededAccount?.externalAccountId ?? seededExternalAccountId ?? null;
    reusedEstablishedJunctionAccount =
      provider.provider === "junction"
      && sourceProviderSlug !== null
      && seededAccount !== null
      && isEstablishedDeviceSyncConnection(seededAccount);

    if (seededExternalAccountId) {
      seededAccount ??= await this.store.getConnectionByExternalAccount(
        provider.provider,
        seededExternalAccountId,
      );

      if (seededAccount?.status === "disconnected") {
        throw attachOAuthCallbackContext(
          deviceSyncError({
            code: "CONNECTION_ALREADY_DISCONNECTED",
            message: "Device sync connection callback was received after the seeded account was disconnected.",
            retryable: false,
            httpStatus: 409,
          }),
          callbackContext,
        );
      }
    }

      if (!descriptor.callbackUrl && connectionFlowRequiresCallbackUrl(descriptor.connectionKind)) {
        throw deviceSyncError({
          code: "CONNECTION_CALLBACK_URL_REQUIRED",
          message: `Device sync provider ${provider.provider} requires a connection callback URL but does not define a callback path.`,
          retryable: false,
          httpStatus: 500,
        });
      }

      const callbackError = normalizeString(callbackQuery.get("error"));
      if (callbackError && resolveDeviceProviderConnectionDescriptor(provider.descriptor).kind === "oauth2") {
        this.logger.warn?.("OAuth callback was rejected by the provider.", {
          provider: provider.provider,
          callbackError,
        });
      }

      const grantedScopes = splitScopeList(input.scope ?? callbackQuery.get("scope"));
      providerWorkStarted = true;
      connection = await completeProviderConnection(provider, {
        callbackUrl: descriptor.callbackUrl ?? "",
        state,
        stateMetadata: buildProviderConnectionStateMetadata(stateRecord.metadata ?? {}),
        seededExternalAccountId,
        sourceProviderSlug,
        query: callbackQuery,
        now,
        grantedScopes,
      });
      assertSeededConnectionExternalAccountMatches({
        provider,
        seededExternalAccountId,
        connection,
      });
      if (seededAccountId) {
        const currentSeededAccount = await this.store.getConnectionById(seededAccountId);
        if (currentSeededAccount?.status === "disconnected") {
          throw deviceSyncError({
            code: "CONNECTION_ALREADY_DISCONNECTED",
            message: "Device sync connection callback was received after the seeded account was disconnected.",
            retryable: false,
            httpStatus: 409,
          });
        }
      }
      const initialJobs = connection.initialJobs?.map((job) =>
        normalizeConfiguredDeviceSyncJobInput(provider.provider, job, "oauth callback")
      );

      const ownerId = normalizeString(stateRecord.ownerId);
      const setupPhase = resolveConnectionSetupPhase(connection, descriptor.connectionKind);

      account = await this.store.upsertConnection({
        ownerId,
        provider: provider.provider,
        externalAccountId: connection.externalAccountId,
        displayName: connection.displayName ?? null,
        status: "active",
        setupPhase,
        setupExpiresAt: resolveConnectionSetupExpiresAt({
          connection,
          setupPhase,
          seededSetupExpiresAt,
        }),
        scopes: connection.scopes?.length
          ? [...connection.scopes]
          : grantedScopes.length > 0
            ? [...grantedScopes]
            : [...descriptor.defaultScopes],
        credential: resolveAndValidateProviderConnectionCredential(provider, connection),
        metadata: connection.metadata ?? {},
        existingAccountPolicy: reusedEstablishedJunctionAccount
          ? "preserve_established"
          : "replace",
        existingAccountGuard: seededAccountId
          ? {
              expectedAccountId: seededAccountId,
              expectedConnectedAt: seededConnectedAt!,
              rejectIfDisconnected: true,
            }
          : null,
        connectedAt: now,
        nextReconcileAt: connection.nextReconcileAt ?? null,
        oauthClaim: {
          state,
          consumedAt: stateResult.consumedAt,
        },
      });
      connectionPersisted = true;

      const establishment = await this.hooks.onConnectionEstablished?.({
        account,
        connectionStartedAt: stateRecord.createdAt,
        ...(connectSourceId ? { connectSourceId } : {}),
        ...(connectTarget ? { connectTarget } : {}),
        ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
        connection: {
          ...connection,
          ...(initialJobs ? { initialJobs } : {}),
        },
        provider,
        now,
      } satisfies DeviceSyncPublicIngressConnectionEstablishedInput);

      if (
        provider.provider === "junction"
        && sourceProviderSlug
        && (
          !establishment
          || establishment.sourceAdmissionCommitted !== true
        )
      ) {
        throw deviceSyncError({
          code: "CONNECTION_SOURCE_ADMISSION_NOT_COMMITTED",
          message: "Device connection completion did not commit the requested source. Start the connection again.",
          retryable: false,
          httpStatus: 409,
        });
      }

      return {
        account,
        returnTo,
        ...(connectSourceId ? { connectSourceId } : {}),
        ...(connectTarget ? { connectTarget } : {}),
        ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
      };
    } catch (error) {
      if (reusedEstablishedJunctionAccount) {
        // Never apply account-wide cleanup to a source-scoped Link attempt.
        // Provider completion precedes hosted source admission, so a rejected
        // obsolete Link can have recreated the exact provider registration.
        // The hosted hook owns source-epoch-aware target cleanup; it is the
        // only safe place to remove that registration without touching the
        // established parent or a newer accepted source epoch.
        const cleanupAccount = account ?? seededAccount;
        if (connection && cleanupAccount && sourceProviderSlug) {
          try {
            await this.hooks.onConnectionSourceAdmissionRejected?.({
              account: cleanupAccount,
              connectionStartedAt: stateRecord.createdAt,
              sourceProviderSlug,
              provider,
              now,
            });
          } catch (cleanupError) {
            throw attachOAuthCallbackContext(cleanupError, callbackContext);
          }
        }
      } else if (connection) {
        try {
          if (connectionPersisted && account) {
            await this.cleanupPersistedOAuthConnection(
              provider,
              account,
              connection,
              now,
              error,
            );
          } else if (isSeededAccountDisconnectedGuardError(error)) {
            if (!await this.ensureFailedOAuthConnectionCleanupOwnership(
              provider,
              connection,
              stateRecord.ownerId ?? null,
              now,
              { state, consumedAt: stateResult.consumedAt },
            )) {
              throw createOAuthSetupCleanupOwnershipError(error);
            }
          } else if (seededAccountId) {
            await this.markSeededConnectionSetupFailed(
              provider,
              seededAccountId,
              seededConnectedAt,
              connection,
              stateRecord.ownerId ?? null,
              now,
              error,
              { state, consumedAt: stateResult.consumedAt },
            );
          } else {
            if (!await this.ensureFailedOAuthConnectionCleanupOwnership(
              provider,
              connection,
              stateRecord.ownerId ?? null,
              now,
              { state, consumedAt: stateResult.consumedAt },
            )) {
              throw createOAuthSetupCleanupOwnershipError(error);
            }
          }
        } catch (cleanupError) {
          throw attachOAuthCallbackContext(cleanupError, callbackContext);
        }
      } else if (seededAccountId) {
        try {
          await this.markSeededConnectionSetupFailed(
            provider,
            seededAccountId,
            seededConnectedAt,
            null,
            stateRecord.ownerId ?? null,
            now,
            error,
            { state, consumedAt: stateResult.consumedAt },
          );
        } catch (cleanupError) {
          throw attachOAuthCallbackContext(cleanupError, callbackContext);
        }
      }

      if (
        !connection
        && !seededAccountId
        && (
          !providerWorkStarted
          || provider.provider === "junction"
        )
        && !await this.store.resolveOAuthStateWithoutProviderAuthority({
          state,
          consumedAt: stateResult.consumedAt,
        })
      ) {
        throw attachOAuthCallbackContext(
          createOAuthSetupCleanupOwnershipError(error),
          callbackContext,
        );
      }

      throw attachOAuthCallbackContext(error, callbackContext);
    }
  }

  async prepareWebhookForDurableEnqueue(
    providerName: string,
    headers: Headers,
    rawBody: Buffer,
    receivedAt: Date,
  ): Promise<PreparedDeviceSyncWebhookV1> {
    return this.prepareWebhook(
      providerName,
      headers,
      rawBody,
      receivedAt,
    );
  }

  async handleWebhook(
    providerName: string,
    headers: Headers,
    rawBody: Buffer,
    receivedAt: Date = new Date(),
  ): Promise<HandleWebhookResult> {
    return this.handlePreparedWebhook(
      await this.prepareWebhook(providerName, headers, rawBody, receivedAt),
    );
  }

  async handlePreparedWebhook(
    value: PreparedDeviceSyncWebhookV1,
  ): Promise<HandleWebhookResult> {
    const prepared = parsePreparedDeviceSyncWebhook(value);
    // Provider registration remains live authority. The prepared event freezes
    // only the authenticated envelope interpretation, never whether Murph
    // still recognizes and permits this provider at dequeue.
    const now = prepared.receivedAt;
    const traceId = prepared.traceId;
    const claimToken = generateStateCode();
    const claimedAt = toIsoTimestamp(new Date());
    const webhook = toIngressWebhook({
      ...prepared,
      jobs: prepared.jobs,
    });

    const claimWebhookTrace = () => this.store.claimWebhookTrace({
      provider: prepared.provider,
      traceId,
      claimedAt,
      claimToken,
      externalAccountId: prepared.externalAccountId,
      eventType: webhook.eventType,
      receivedAt: now,
      processingExpiresAt: addMilliseconds(claimedAt, WEBHOOK_TRACE_PROCESSING_TTL_MS),
    });

    const webhookSourceProviderSlug = normalizeString(webhook.sourceProviderSlug);

    const traceClaim = await claimWebhookTrace();

    if (traceClaim === "processed") {
      return {
        accepted: true,
        duplicate: true,
        provider: prepared.provider,
        eventType: webhook.eventType,
        traceId,
      };
    }

    if (traceClaim === "processing") {
      throw deviceSyncError({
        code: "WEBHOOK_TRACE_IN_PROGRESS",
        message: "Webhook delivery is already being processed. Retry later.",
        retryable: true,
        httpStatus: 503,
      });
    }

    // Queue delay can outlive a provider registration. The prepared meaning is
    // already authenticated, so a removed provider is a terminal authority
    // loss rather than a reason to retain encrypted work forever.
    const provider = this.registry.get(prepared.provider);
    if (!provider) {
      await completeClaimedWebhookTrace(this.store, prepared.provider, traceId, claimToken);
      return {
        accepted: true,
        duplicate: false,
        provider: prepared.provider,
        eventType: webhook.eventType,
        traceId,
      };
    }

    let account;
    try {
      account = await this.store.getConnectionByExternalAccount(
        provider.provider,
        prepared.externalAccountId,
      );
    } catch (error) {
      await this.store.releaseWebhookTrace(provider.provider, traceId, claimToken);
      throw error;
    }

    if (!account) {
      const unknownWebhookLogContext: Record<string, unknown> = {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(prepared.externalAccountId),
        eventType: webhook.eventType,
        traceId,
        acceptanceMode: webhook.acceptanceMode,
        unknownAccountAction: prepared.unknownAccountAction ?? "retry",
        unknownWebhookHookConfigured: Boolean(this.hooks.onUnknownWebhook),
      };
      if (prepared.externalAccountDiagnostic) {
        unknownWebhookLogContext.externalAccountDiagnostic = prepared.externalAccountDiagnostic;
      }

      const shouldAcceptUnknownWebhook =
        prepared.unknownAccountAction === "accept"
        && webhook.acceptanceMode === "level_dirty_hint";

      this.logger.warn?.(
        shouldAcceptUnknownWebhook
          ? "Accepting orphan webhook for unknown device sync account."
          : "Delaying webhook for unknown device sync account.",
        unknownWebhookLogContext,
      );

      if (shouldAcceptUnknownWebhook) {
        try {
          await this.hooks.onUnknownWebhook?.({
            provider,
            traceId,
            webhook: {
              ...webhook,
              jobs: [],
            },
            externalAccountId: prepared.externalAccountId,
            now,
          });
          await completeClaimedWebhookTrace(this.store, provider.provider, traceId, claimToken);
        } catch (error) {
          this.logger.warn?.(
            "Failed to run unknown device sync webhook hook; releasing orphan trace for retry.",
            unknownWebhookLogContext,
          );
          await this.store.releaseWebhookTrace(provider.provider, traceId, claimToken);
          throw error;
        }

        return {
          accepted: true,
          duplicate: false,
          orphaned: true,
          provider: provider.provider,
          eventType: webhook.eventType,
          traceId,
        };
      }

      await this.store.releaseWebhookTrace(provider.provider, traceId, claimToken);

      throw deviceSyncError({
        code: "WEBHOOK_ACCOUNT_NOT_READY",
        message: "Webhook account is not connected yet. Retry later.",
        retryable: true,
        httpStatus: 503,
      });
    }

    let sourceAdmissionDeferred = false;
    try {
      // A dirty row proves only that import invalidation is queued. Await exact-
      // source lifecycle work before dirty coalescing can complete this trace.
      if (webhookSourceProviderSlug) {
        const matchingSources = await this.store.listConnectionSources({
          connectionId: account.id,
          sourceProviderSlug: webhookSourceProviderSlug,
        });
        if (
          matchingSources.length > 0
          && !isDeviceSyncSourceAdmitted(matchingSources, webhookSourceProviderSlug)
        ) {
          const sourceObservation = await this.hooks.onConnectionSourceObserved?.({
            account,
            eventType: webhook.eventType,
            sourceProviderSlug: webhookSourceProviderSlug,
            provider,
            now,
          });
          sourceAdmissionDeferred = Boolean(
            sourceObservation
            && "sourceAdmissionDeferred" in sourceObservation
            && sourceObservation.sourceAdmissionDeferred === true
            && this.hooks.onWebhookAccepted,
          );
          if (
            sourceObservation
            && "sourceRegistrationRemoved" in sourceObservation
            && sourceObservation.sourceRegistrationRemoved === true
          ) {
            await completeClaimedWebhookTrace(this.store, provider.provider, traceId, claimToken);
            return {
              accepted: true,
              duplicate: false,
              provider: provider.provider,
              eventType: webhook.eventType,
              traceId,
            };
          }
          if (
            account.status === "active"
            && !isDeviceSyncConnectionSetupPending(account)
            && (
              !sourceObservation
              || !("sourceAdmissionCommitted" in sourceObservation)
              || sourceObservation.sourceAdmissionCommitted !== true
            )
            && !(
              sourceObservation
              && "sourceAdmissionDeferred" in sourceObservation
              && sourceObservation.sourceAdmissionDeferred === true
            )
          ) {
            throw deviceSyncError({
              code: "WEBHOOK_SOURCE_NOT_READY",
              message: "Device source setup must finish before its webhook can be accepted.",
              retryable: true,
              httpStatus: 503,
            });
          }
        }
      }

      if (
        account.status === "active"
        && !isDeviceSyncConnectionSetupPending(account)
        && webhook.acceptanceMode === "level_dirty_hint"
      ) {
        const alreadySatisfied = await this.hooks.onLevelDirtyWebhookAlreadySatisfied?.({
          account,
          traceId,
          webhook,
          provider,
          now,
        });
        if (alreadySatisfied?.accepted === true) {
          await completeClaimedWebhookTrace(this.store, provider.provider, traceId, claimToken);
          return {
            accepted: true,
            duplicate: false,
            provider: provider.provider,
            eventType: webhook.eventType,
            traceId,
          };
        }
      }
    } catch (error) {
      await this.store.releaseWebhookTrace(provider.provider, traceId, claimToken);
      throw error;
    }

    if (
      account.status === "active"
      && isDeviceSyncConnectionSetupPending(account)
      && !sourceAdmissionDeferred
    ) {
      this.logger.warn?.("Delaying webhook side effects until device sync setup is confirmed.", {
        provider: provider.provider,
        accountId: account.id,
        eventType: webhook.eventType,
        traceId,
      });
      await this.store.releaseWebhookTrace(provider.provider, traceId, claimToken);
      throw deviceSyncError({
        code: "WEBHOOK_ACCOUNT_NOT_READY",
        message: "Device sync setup must finish before webhook side effects can be accepted.",
        retryable: true,
        httpStatus: 503,
      });
    }

    switch (account.status) {
      case "active":
        break;
      case "reauthorization_required":
        this.logger.warn?.("Delaying webhook side effects for device sync account awaiting reauthorization.", {
          provider: provider.provider,
          accountId: account.id,
          status: account.status,
          eventType: webhook.eventType,
          traceId,
        });
        await this.store.releaseWebhookTrace(provider.provider, traceId, claimToken);
        throw deviceSyncError({
          code: "WEBHOOK_ACCOUNT_NOT_READY",
          message: "Device sync account must be reconnected before webhook side effects can be accepted.",
          retryable: true,
          httpStatus: 503,
        });
      case "disconnected":
        this.logger.warn?.("Ignoring webhook side effects for disconnected device sync account.", {
          provider: provider.provider,
          accountId: account.id,
          status: account.status,
          eventType: webhook.eventType,
          traceId,
        });
        await completeClaimedWebhookTrace(this.store, provider.provider, traceId, claimToken);

        return {
          accepted: true,
          duplicate: false,
          provider: provider.provider,
          eventType: webhook.eventType,
          traceId,
        };
    }

    const onWebhookAccepted = this.hooks.onWebhookAccepted;
    let receiptStateOwned = false;

    try {
      const acceptedResult = await onWebhookAccepted?.({
        account,
        claimToken,
        sourceAdmissionDeferred,
        traceId,
        webhook,
        provider,
        now,
      });
      receiptStateOwned = acceptedResult?.receiptStateOwned === true;

      if (!onWebhookAccepted) {
        await completeClaimedWebhookTrace(this.store, provider.provider, traceId, claimToken);
      } else if (acceptedResult?.webhookTraceCompleted !== true) {
        throw deviceSyncError({
          code: "WEBHOOK_TRACE_COMPLETION_REQUIRED",
          message: "Webhook acceptance must complete the claimed trace before returning.",
          retryable: true,
          httpStatus: 503,
        });
      }
    } catch (error) {
      await this.store.releaseWebhookTrace(provider.provider, traceId, claimToken);
      throw error;
    }

    try {
      if (!receiptStateOwned) {
        await this.store.markWebhookReceived(account.id, now);
      }
    } catch (error) {
      this.logger.warn?.("Failed to record last webhook receipt time after durable acceptance.", {
        provider: provider.provider,
        accountId: account.id,
        eventType: webhook.eventType,
        traceId,
        failureCode: "DEVICE_SYNC_WEBHOOK_RECEIPT_TIMESTAMP_RECORD_FAILED",
        error: summarizePublicIngressError(error),
      });
    }

    // Connection-scoped receipt time cannot show that one source went quiet
    // while a sibling on the same connection kept delivering, so record the
    // arrival against the source the provider named. Like the receipt stamp,
    // this runs after durable acceptance and never fails the webhook.
    const dataSourceProviderSlug = webhook.dataSourceProviderSlug ?? null;
    if (dataSourceProviderSlug && !receiptStateOwned) {
      try {
        await this.store.markConnectionSourceDataReceived({
          connectionId: account.id,
          now,
          sourceProviderSlug: dataSourceProviderSlug,
        });
      } catch (error) {
        this.logger.warn?.("Failed to record source data arrival after durable acceptance.", {
          provider: provider.provider,
          accountId: account.id,
          eventType: webhook.eventType,
          traceId,
          failureCode: "DEVICE_SYNC_SOURCE_DATA_ARRIVAL_RECORD_FAILED",
          error: summarizePublicIngressError(error),
        });
      }
    }

    return {
      accepted: true,
      duplicate: false,
      provider: provider.provider,
      eventType: webhook.eventType,
      traceId,
    };
  }

  private async prepareWebhook(
    providerName: string,
    headers: Headers,
    rawBody: Buffer,
    receivedAt: Date,
  ): Promise<PreparedDeviceSyncWebhookV1> {
    const provider = this.requireProvider(providerName);
    const verifyAndParseWebhook = resolveProviderWebhookVerifier(provider);

    if (!provider.descriptor.webhook?.path || !verifyAndParseWebhook) {
      throw deviceSyncError({
        code: "WEBHOOKS_NOT_SUPPORTED",
        message: `Device sync provider ${provider.provider} does not accept webhooks.`,
        retryable: false,
        httpStatus: 404,
      });
    }

    const now = toIsoTimestamp(receivedAt);
    const parsed = await verifyAndParseWebhook({
      headers,
      rawBody,
      now,
    });
    const jobs = parsed.jobs.map((job) =>
      normalizeConfiguredDeviceSyncJobInput(provider.provider, job, "webhook")
    );
    const traceId = scopeWebhookTraceId(
      provider.provider,
      parsed.externalAccountId,
      parsed.traceId,
    );

    return parsePreparedDeviceSyncWebhook({
      ...parsed,
      jobs,
      provider: provider.provider,
      receivedAt: now,
      schema: DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
      traceId,
    });
  }

  private requireProvider(providerName: string): DeviceSyncProvider {
    const provider = this.registry.get(providerName);

    if (!provider) {
      throw deviceSyncError({
        code: "PROVIDER_NOT_REGISTERED",
        message: `Device sync provider ${providerName} is not registered.`,
        retryable: false,
        httpStatus: 404,
      });
    }

    return provider;
  }

  private resolveReturnTo(candidate: string | null): string | null {
    const resolved = resolveRelativeOrAllowedOriginUrl(candidate, this.publicBaseUrl, this.allowedReturnOrigins);

    if (candidate && !resolved) {
      throw deviceSyncError({
        code: "RETURN_TO_INVALID",
        message: "returnTo must be a relative path or an allowed origin URL.",
        retryable: false,
        httpStatus: 400,
      });
    }

    return resolved;
  }

  private sanitizeStoredReturnTo(candidate: string | null): string | null {
    const resolved = resolveRelativeOrAllowedOriginUrl(candidate, this.publicBaseUrl, this.allowedReturnOrigins);

    if (candidate && !resolved) {
      this.logger.warn?.("Discarding invalid persisted OAuth returnTo state.");
      return null;
    }

    return resolved;
  }

  private async revokeStoredOAuthCleanupAccount(
    provider: DeviceSyncProvider,
    account: DeviceSyncAccount,
  ): Promise<boolean> {
    const revokeAccess = provider.connectionHandler?.revokeAccess;

    if (!revokeAccess || account.credential.kind !== "oauth_tokens") {
      return true;
    }

    try {
      await revokeAccess(account);
      return true;
    } catch (error) {
      this.logger.warn?.("Failed to revoke provider access after OAuth callback setup failed.", {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(account.externalAccountId),
        failureCode: "DEVICE_SYNC_OAUTH_SETUP_FAILURE_REVOKE_FAILED",
        error: summarizePublicIngressError(error),
      });
      return false;
    }
  }

  private async cleanupPersistedOAuthConnection(
    provider: DeviceSyncProvider,
    account: PublicDeviceSyncAccount,
    connection: ProviderConnectionResult,
    now: string,
    error: unknown,
  ): Promise<void> {
    const failure = summarizeOAuthSetupFailure(error);
    let markResult: MarkPublicDeviceSyncConnectionSetupFailedResult;
    try {
      markResult = await this.store.markConnectionSetupFailed({
        accountId: account.id,
        expectedConnectedAt: account.connectedAt,
        now,
        code: failure.code,
        message: failure.message,
      });
    } catch (markError) {
      this.logger.warn?.("Failed to mark OAuth connection setup failure after persistence.", {
        provider: provider.provider,
        accountId: account.id,
        externalAccountIdHash: hashExternalAccountIdForLogs(connection.externalAccountId),
        failureCode: "DEVICE_SYNC_OAUTH_SETUP_FAILURE_RECORD_FAILED",
        error: summarizePublicIngressError(markError),
      });
      const durableAccount = await this.store.getConnectionById(account.id);
      if (durableAccount) {
        return;
      }
      throw deviceSyncError({
        code: "OAUTH_SETUP_CLEANUP_FAILED",
        message: "OAuth connection setup failed after persistence, and cleanup ownership could not be confirmed.",
        httpStatus: 503,
        retryable: true,
        details: {
          accountId: account.id,
          setupFailureCode: failure.code,
        },
        cause: markError,
      });
    }

    if (!markResult.account) {
      throw deviceSyncError({
        code: "OAUTH_SETUP_CLEANUP_FAILED",
        message: "OAuth connection setup failed after persistence, and stored-token cleanup could not confirm the account.",
        httpStatus: 500,
        details: {
          accountId: account.id,
          setupFailureCode: failure.code,
        },
      });
    }

    if (markResult.blockedByRefreshLease) {
      return;
    }
    if (!markResult.applied || markResult.oauthTokenVersion === null) {
      return;
    }
    const cleanupAccount = await this.store.getOAuthCleanupAccount({
      accountId: account.id,
      expectedConnectedAt: account.connectedAt,
      expectedTokenVersion: markResult.oauthTokenVersion,
    });
    if (
      cleanupAccount
      && await this.revokeStoredOAuthCleanupAccount(provider, cleanupAccount)
    ) {
      await this.store.clearOAuthCredentialAfterConfirmedRevoke({
        accountId: account.id,
        expectedConnectedAt: account.connectedAt,
        expectedTokenVersion: markResult.oauthTokenVersion,
        now,
      });
    }
  }

  private async markSeededConnectionSetupFailed(
    provider: DeviceSyncProvider,
    accountId: string,
    expectedConnectedAt: string | null,
    connection: ProviderConnectionResult | null,
    ownerId: string | null,
    now: string,
    error: unknown,
    oauthClaim?: OAuthStateConsumeClaim,
  ): Promise<void> {
    const failure = summarizeOAuthSetupFailure(error);

    if (
      !connection
      && oauthClaim
      && isSeededAccountDisconnectedGuardError(error)
    ) {
      if (await this.store.resolveOAuthStateWithoutProviderAuthority(oauthClaim)) {
        return;
      }
      throw createOAuthSetupCleanupOwnershipError(error);
    }

    if (
      connection
      && readProviderConnectionCredential(connection)?.kind === "oauth_tokens"
    ) {
      if (!await this.ensureFailedOAuthConnectionCleanupOwnership(
        provider,
        connection,
        ownerId,
        now,
        oauthClaim,
      )) {
        throw deviceSyncError({
          code: "CONNECTION_SETUP_CLEANUP_FAILED",
          message: "Seeded device sync setup failed, and provider cleanup ownership could not be persisted.",
          httpStatus: 503,
          retryable: true,
          details: {
            accountId,
            setupFailureCode: failure.code,
          },
        });
      }
      oauthClaim = undefined;
    }

    let markResult: MarkPublicDeviceSyncConnectionSetupFailedResult;
    try {
      markResult = await this.store.markConnectionSetupFailed({
        accountId,
        expectedConnectedAt,
        now,
        code: failure.code,
        message: failure.message,
        oauthClaim,
      });
    } catch (markError) {
      this.logger.warn?.("Failed to mark seeded device sync connection setup failure.", {
        provider: provider.provider,
        accountId,
        failureCode: "DEVICE_SYNC_SEEDED_CONNECTION_SETUP_FAILURE_RECORD_FAILED",
        error: summarizePublicIngressError(markError),
      });
      throw deviceSyncError({
        code: "CONNECTION_SETUP_CLEANUP_FAILED",
        message: "Seeded device sync connection setup failed, and setup failure could not be recorded.",
        httpStatus: 500,
        details: {
          accountId,
          setupFailureCode: failure.code,
        },
        cause: markError,
      });
    }

    if (!markResult.account) {
      if (
        oauthClaim
        && await this.store.resolveOAuthStateWithoutProviderAuthority(oauthClaim)
      ) {
        return;
      }
      throw deviceSyncError({
        code: "CONNECTION_SETUP_CLEANUP_FAILED",
        message: "Seeded device sync connection setup failed, and its exact callback claim could not be resolved.",
        httpStatus: 503,
        retryable: true,
        details: {
          accountId,
          setupFailureCode: failure.code,
        },
      });
    }
    if (!markResult.applied && oauthClaim) {
      const resolved = await this.store.resolveOAuthStateWithoutProviderAuthority(oauthClaim);
      if (!resolved) {
        throw deviceSyncError({
          code: "CONNECTION_SETUP_CLEANUP_FAILED",
          message: "Seeded device sync callback claim changed before setup failure resolved.",
          httpStatus: 503,
          retryable: true,
          details: {
            accountId,
            setupFailureCode: failure.code,
          },
        });
      }
    }
  }

  private async ensureFailedOAuthConnectionCleanupOwnership(
    provider: DeviceSyncProvider,
    connection: ProviderConnectionResult,
    ownerId: string | null,
    now: string,
    oauthClaim?: OAuthStateConsumeClaim,
  ): Promise<boolean> {
    if (readProviderConnectionCredential(connection)?.kind !== "oauth_tokens") {
      return oauthClaim
        ? this.store.resolveOAuthStateWithoutProviderAuthority(oauthClaim)
        : true;
    }
    const ownership = await this.persistFailedOAuthConnectionCleanupOwner(
      provider,
      connection,
      ownerId,
      now,
      oauthClaim,
    );
    if (!ownership) {
      return false;
    }
    const markResult = await this.store.markConnectionSetupFailed({
      accountId: ownership.account.id,
      code: "OAUTH_SETUP_FAILED",
      expectedConnectedAt: ownership.account.connectedAt,
      message: "OAuth callback setup failed before connection establishment completed.",
      now,
    });
    if (markResult.blockedByRefreshLease) {
      return true;
    }
    if (!markResult.applied || markResult.oauthTokenVersion === null) {
      return true;
    }
    const cleanupAccount = await this.store.getOAuthCleanupAccount({
      accountId: ownership.account.id,
      expectedConnectedAt: ownership.account.connectedAt,
      expectedTokenVersion: markResult.oauthTokenVersion,
    });
    if (
      cleanupAccount
      && await this.revokeStoredOAuthCleanupAccount(provider, cleanupAccount)
    ) {
      await this.store.clearOAuthCredentialAfterConfirmedRevoke({
        accountId: ownership.account.id,
        expectedConnectedAt: ownership.account.connectedAt,
        expectedTokenVersion: markResult.oauthTokenVersion,
        now,
      });
    }
    return true;
  }

  private async persistFailedOAuthConnectionCleanupOwner(
    provider: DeviceSyncProvider,
    connection: ProviderConnectionResult,
    ownerId: string | null,
    now: string,
    oauthClaim?: OAuthStateConsumeClaim,
  ): Promise<{
    account: PublicDeviceSyncAccount;
  } | null> {
    try {
      const credential = resolveAndValidateProviderConnectionCredential(provider, connection);
      const account = await this.store.upsertConnection({
        cleanupOwnership: "oauth_provider_revoke",
        connectedAt: now,
        credential,
        displayName: connection.displayName ?? null,
        existingAccountPolicy: "replace",
        externalAccountId: connection.externalAccountId,
        metadata: connection.metadata ?? {},
        nextReconcileAt: null,
        ownerId,
        provider: provider.provider,
        scopes: [...(connection.scopes ?? [])],
        setupExpiresAt: null,
        setupPhase: "failed",
        status: "reauthorization_required",
        oauthClaim,
      });
      return { account };
    } catch (error) {
      this.logger.warn?.("Failed to persist provider cleanup ownership after OAuth setup failure.", {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(connection.externalAccountId),
        failureCode: "DEVICE_SYNC_OAUTH_CLEANUP_OWNER_PERSIST_FAILED",
        error: summarizePublicIngressError(error),
      });
      return null;
    }
  }
}

function isSeededAccountDisconnectedGuardError(error: unknown): boolean {
  return isDeviceSyncError(error) && error.code === "CONNECTION_ALREADY_DISCONNECTED";
}

async function completeClaimedWebhookTrace(
  store: DeviceSyncPublicIngressStore,
  provider: string,
  traceId: string,
  claimToken: string,
): Promise<void> {
  const completed = await store.completeWebhookTrace(provider, traceId, claimToken);
  if (!completed) {
    throw deviceSyncError({
      code: "WEBHOOK_TRACE_CLAIM_LOST",
      message: "Webhook trace claim was lost before durable acceptance completed.",
      retryable: true,
      httpStatus: 503,
    });
  }
}

export function createDeviceSyncPublicIngress(input: CreateDeviceSyncPublicIngressInput): DeviceSyncPublicIngress {
  return new DeviceSyncPublicIngress(input);
}

function hashExternalAccountIdForLogs(value: string): string {
  return sha256Text(value);
}

function summarizePublicIngressError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = toPlainRecord(error.cause);
    return {
      category: isDeviceSyncError(error) ? "device_sync_error" : "unexpected_error",
      ...(isDeviceSyncError(error) ? { code: error.code } : {}),
      name: error.name,
      message: sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]",
      ...(cause?.message
        ? { cause: sanitizeHostedRuntimeErrorText(String(cause.message)) ?? "[redacted]" }
        : {}),
      ...(cause?.code
        ? { causeCode: sanitizeHostedRuntimeErrorText(String(cause.code))?.replace(/\s+/gu, "_") ?? "[redacted]" }
        : {}),
      ...(cause?.name
        ? { causeName: sanitizeHostedRuntimeErrorText(String(cause.name))?.replace(/\s+/gu, "_") ?? "[redacted]" }
        : {}),
    };
  }

  return {
    category: "non_error_throw",
    value: sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]",
  };
}

function toPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function summarizeOAuthSetupFailure(error: unknown): { code: string; message: string } {
  const code = isDeviceSyncError(error) ? error.code : "OAUTH_SETUP_FAILED";
  const rawMessage = error instanceof Error ? error.message : String(error);

  return {
    code,
    message: sanitizeHostedRuntimeErrorText(rawMessage) ?? "OAuth connection setup failed.",
  };
}

function createOAuthSetupCleanupOwnershipError(cause: unknown) {
  return deviceSyncError({
    code: "OAUTH_SETUP_CLEANUP_FAILED",
    message: "OAuth connection setup failed, and cleanup ownership could not be confirmed.",
    httpStatus: 503,
    retryable: true,
    cause,
  });
}

function attachOAuthCallbackContext(
  error: unknown,
  context: {
    connectSourceId: string | null;
    connectTarget: string | null;
    provider: string;
    returnTo: string | null;
  },
): unknown {
  if (!isDeviceSyncError(error)) {
    return error;
  }

  return deviceSyncError({
    code: error.code,
    message: sanitizeHostedRuntimeErrorText(error.message) ?? "Request failed.",
    retryable: error.retryable,
    httpStatus: error.httpStatus,
    accountStatus: error.accountStatus,
    details: {
      ...(error.details ?? {}),
      ...(context.connectSourceId ? { connectSourceId: context.connectSourceId } : {}),
      ...(context.connectTarget ? { connectTarget: context.connectTarget } : {}),
      provider: context.provider,
      returnTo: context.returnTo,
    },
    cause: error.cause,
  });
}

function resolveProviderWebhookVerifier(
  provider: DeviceSyncProvider,
): DeviceWebhookHandler["verifyAndParseWebhook"] | undefined {
  return provider.webhookHandler?.verifyAndParseWebhook;
}

export { DeviceSyncError, deviceSyncError, isDeviceSyncError } from "./errors.ts";
export { createDeviceSyncRegistry } from "./registry.ts";
export { toRedactedPublicDeviceSyncAccount } from "./public-account.ts";
export { sanitizeStoredDeviceSyncMetadata } from "./shared.ts";
export { resolveDeviceSyncWebhookPreflightResponse } from "./webhook-verification.ts";
export { createOuraDeviceSyncProvider } from "./providers/oura.ts";
export type { OuraDeviceSyncProviderConfig } from "./config/provider-types.ts";
export { createWhoopDeviceSyncProvider } from "./providers/whoop.ts";
export type { WhoopDeviceSyncProviderConfig } from "./config/provider-types.ts";
export { createStravaDeviceSyncProvider, resolveStravaWebhookPreflightResponse } from "./providers/strava.ts";
export type { StravaDeviceSyncProviderConfig } from "./config/provider-types.ts";
export { normalizeJunctionResourceName, readJunctionWebhookResourceName } from "./junction-resources.ts";
export {
  DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES,
  DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED,
} from "./types.ts";
export type {
  BeginConnectionResult,
  ClaimDeviceSyncWebhookTraceInput,
  CompleteConnectionResult,
  ConsumeOAuthStateResult,
  DeviceConnectionHandler,
  DeviceSdkConnectionHandler,
  DeviceSdkSignInToken,
  DeviceSyncAccount,
  DeviceSyncAccountStatus,
  DeviceSyncIngressWebhook,
  DeviceSyncJobInput,
  DeviceSyncProvider,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookAcceptanceMode,
  DeviceSyncWebhookPreflightResponse,
  DeviceSyncPublicIngressWebhookAcceptedResult,
  DeviceSyncRegistry,
  DeviceSyncWebhookTraceClaimResult,
  HandleConnectionCallbackInput,
  HandleWebhookResult,
  MarkPublicDeviceSyncConnectionSetupFailedInput,
  OAuthStateRecord,
  ProviderAuthTokens,
  ProviderConnectionResult,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  SdkSignInSessionResult,
  UpsertPublicDeviceSyncConnectionInput,
  UpsertPublicDeviceSyncConnectionResult,
} from "./types.ts";
