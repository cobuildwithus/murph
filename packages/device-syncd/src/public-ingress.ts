import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { sanitizeHostedRuntimeErrorText } from "./hosted-runtime.ts";
import { resolveDeviceSyncProviderCredentialPolicy } from "./provider-credential-policy.ts";
import {
  normalizeConfiguredDeviceSyncJobInput,
} from "./provider-job-definitions.ts";
import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";
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
  ProviderAuthTokens,
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

const WEBHOOK_TRACE_PROCESSING_TTL_MS = 5 * 60_000;
const SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY =
  "__murphSeededConnectionAccountId";
const SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY =
  "__murphSeededConnectionExternalAccountId";
const SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY =
  "__murphSeededConnectionSetupExpiresAt";
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
  resourceCategory?: string | null;
}): DeviceSyncIngressWebhook {
  const resourceCategory = normalizeString(parsed.resourceCategory);

  return {
    acceptanceMode: parsed.acceptanceMode,
    eventType: parsed.eventType,
    jobs: [...parsed.jobs],
    ...(parsed.occurredAt ? { occurredAt: parsed.occurredAt } : {}),
    ...(resourceCategory ? { resourceCategory } : {}),
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

function requireConnectionOAuthTokens(connection: ProviderConnectionResult): ProviderAuthTokens {
  const credential = resolveProviderConnectionCredential(connection);

  if (credential.kind !== "oauth_tokens") {
    throw deviceSyncError({
      code: "OAUTH_TOKENS_REQUIRED",
      message: "This connection cleanup path requires OAuth token credentials.",
      retryable: false,
      httpStatus: 500,
    });
  }

  return credential.tokens;
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

function isEstablishedSdkConnection(account: PublicDeviceSyncAccount): boolean {
  return account.status === "active" && account.setupPhase === "source_confirmed";
}

function shouldRunSdkConnectionEstablishedHook(existingAccount: PublicDeviceSyncAccount | null): boolean {
  return !existingAccount || !isEstablishedSdkConnection(existingAccount);
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
      defaultScopes: [...(connection.defaultScopes ?? [])],
    };
  }

  async startConnection(input: StartConnectionInput): Promise<BeginConnectionResult> {
    const now = toIsoTimestamp(new Date());
    const provider = this.requireProvider(input.provider);
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

    let seededAccount: PublicDeviceSyncAccount | null = null;
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
        connectedAt: now,
        nextReconcileAt: started.connectionSeed.nextReconcileAt ?? null,
      });
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

    try {
      await this.store.createOAuthState({
        state,
        provider: provider.provider,
        returnTo,
        ownerId: input.ownerId ?? null,
        createdAt: now,
        expiresAt,
        metadata: stateMetadata,
      });
    } catch (error) {
      if (seededAccount) {
        await this.markSeededConnectionSetupFailed(provider, seededAccount.id, null, now, error);
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
        reuseEstablishedConnection: true,
        connectedAt: now,
        nextReconcileAt: connection.nextReconcileAt ?? null,
      });
      account = persisted.account;
      previousAccount = persisted.previousAccount;
    }

    if (!canReuseExistingAccount && shouldRunSdkConnectionEstablishedHook(previousAccount)) {
      await this.runSdkConnectionEstablishedHook({
        account,
        connection: {
          ...connection,
          ...(initialJobs ? { initialJobs } : {}),
        },
        provider,
        now,
      });
    }

    const token = await handler.createSignInToken({
      externalAccountId: connection.externalAccountId,
    });

    return {
      account,
      signInToken: token.signInToken,
      environment: token.environment,
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
    if (!isEstablishedSdkConnection(account)) {
      return false;
    }

    const getConnectionOwnerId = this.store.getConnectionOwnerId;
    if (!getConnectionOwnerId) {
      return false;
    }

    return await getConnectionOwnerId.call(this.store, account.id) === ownerId;
  }

  private async runSdkConnectionEstablishedHook(
    input: DeviceSyncPublicIngressConnectionEstablishedInput,
  ): Promise<void> {
    try {
      await this.hooks.onConnectionEstablished?.(input);
    } catch (error) {
      this.logger.warn?.("Device sync SDK sign-in established hook failed; continuing token mint.", {
        provider: input.provider.provider,
        accountId: input.account.id,
        externalAccountIdHash: hashExternalAccountIdForLogs(input.connection.externalAccountId),
        failureCode: "DEVICE_SYNC_SDK_SIGN_IN_ESTABLISHED_HOOK_FAILED",
        error: summarizePublicIngressError(error),
      });
    }
  }

  async handleConnectionCallback(input: HandleConnectionCallbackInput): Promise<CompleteConnectionResult> {
    const provider = this.requireProvider(input.provider);
    const now = toIsoTimestamp(new Date());
    const descriptor = this.describeProvider(provider);
    const callbackQuery = buildConnectionCallbackQuery(input);
    const state =
      normalizeString(input.state)
      ?? normalizeString(callbackQuery.get("murph_state"))
      ?? normalizeString(callbackQuery.get("state"));

    if (!state) {
      throw deviceSyncError({
        code: "OAUTH_STATE_MISSING",
        message: "Device connection callback is missing the state parameter.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const expectedOwnerId = normalizeString(input.expectedOwnerId);
    const stateResult = await this.store.consumeOAuthState(
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

    const stateRecord = stateResult.record;
    const returnTo = this.sanitizeStoredReturnTo(stateRecord.returnTo ?? null);
    const seededAccountId = readSeededConnectionAccountId(stateRecord.metadata);
    let seededExternalAccountId = readSeededConnectionExternalAccountId(stateRecord.metadata);
    const seededSetupExpiresAt = readSeededConnectionSetupExpiresAt(stateRecord.metadata);
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

    let seededAccount = seededAccountId ? await this.store.getConnectionById(seededAccountId) : null;

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

    seededExternalAccountId = seededAccount?.externalAccountId ?? seededExternalAccountId ?? null;

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

    try {
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
      connection = await completeProviderConnection(provider, {
        callbackUrl: descriptor.callbackUrl ?? "",
        state,
        stateMetadata: buildProviderConnectionStateMetadata(stateRecord.metadata ?? {}),
        seededExternalAccountId,
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
        existingAccountGuard: seededAccountId
          ? {
              expectedAccountId: seededAccountId,
              rejectIfDisconnected: true,
            }
          : null,
        connectedAt: now,
        nextReconcileAt: connection.nextReconcileAt ?? null,
      });
      connectionPersisted = true;

      await this.hooks.onConnectionEstablished?.({
        account,
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

      return {
        account,
        returnTo,
        ...(connectSourceId ? { connectSourceId } : {}),
        ...(connectTarget ? { connectTarget } : {}),
        ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
      };
    } catch (error) {
      if (connection) {
        try {
          if (connectionPersisted && account) {
            await this.cleanupPersistedOAuthConnection(provider, account, connection, now, error);
          } else if (isSeededAccountDisconnectedGuardError(error)) {
            await this.cleanupFailedOAuthConnection(provider, connection, now);
          } else if (seededAccountId) {
            await this.markSeededConnectionSetupFailed(provider, seededAccountId, connection, now, error);
          } else {
            await this.cleanupFailedOAuthConnection(provider, connection, now);
          }
        } catch (cleanupError) {
          throw attachOAuthCallbackContext(cleanupError, callbackContext);
        }
      } else if (seededAccountId) {
        try {
          await this.markSeededConnectionSetupFailed(provider, seededAccountId, null, now, error);
        } catch (cleanupError) {
          throw attachOAuthCallbackContext(cleanupError, callbackContext);
        }
      }

      throw attachOAuthCallbackContext(error, callbackContext);
    }
  }

  async handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult> {
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

    const now = toIsoTimestamp(new Date());
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
    const claimToken = generateStateCode();
    const webhook = toIngressWebhook({
      ...parsed,
      jobs,
    });

    const claimWebhookTrace = () => this.store.claimWebhookTrace({
      provider: provider.provider,
      traceId,
      claimToken,
      externalAccountId: parsed.externalAccountId,
      eventType: webhook.eventType,
      receivedAt: now,
      processingExpiresAt: addMilliseconds(now, WEBHOOK_TRACE_PROCESSING_TTL_MS),
    });

    const account = await this.store.getConnectionByExternalAccount(provider.provider, parsed.externalAccountId);

    if (account?.status === "active" && webhook.acceptanceMode === "level_dirty_hint") {
      // Only provider-declared level hints can be satisfied by committed dirty state.
      // Exact webhook work must pass through trace claim and durable acceptance.
      const alreadySatisfied = await this.hooks.onLevelDirtyWebhookAlreadySatisfied?.({
        account,
        traceId,
        webhook,
        provider,
        now,
      });

      if (alreadySatisfied?.accepted === true) {
        return {
          accepted: true,
          duplicate: false,
          provider: provider.provider,
          eventType: webhook.eventType,
          traceId,
        };
      }
    }

    const traceClaim = await claimWebhookTrace();

    if (traceClaim === "processed") {
      return {
        accepted: true,
        duplicate: true,
        provider: provider.provider,
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

    if (!account) {
      const unknownWebhookLogContext: Record<string, unknown> = {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(parsed.externalAccountId),
        eventType: webhook.eventType,
        traceId,
        acceptanceMode: webhook.acceptanceMode,
        unknownAccountAction: parsed.unknownAccountAction ?? "retry",
        unknownWebhookHookConfigured: Boolean(this.hooks.onUnknownWebhook),
      };
      if (parsed.externalAccountDiagnostic) {
        unknownWebhookLogContext.externalAccountDiagnostic = parsed.externalAccountDiagnostic;
      }

      const shouldAcceptUnknownWebhook =
        parsed.unknownAccountAction === "accept"
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
            externalAccountId: parsed.externalAccountId,
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

    try {
      const acceptedResult = await onWebhookAccepted?.({
        account,
        claimToken,
        traceId,
        webhook,
        provider,
        now,
      });

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
      await this.store.markWebhookReceived(account.id, now);
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

    return {
      accepted: true,
      duplicate: false,
      provider: provider.provider,
      eventType: webhook.eventType,
      traceId,
    };
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

  private async cleanupFailedOAuthConnection(
    provider: DeviceSyncProvider,
    connection: ProviderConnectionResult,
    now: string,
  ): Promise<void> {
    let credential: DeviceAccountCredential | null;
    try {
      credential = readProviderConnectionCredential(connection);
    } catch (error) {
      this.logger.warn?.("Skipping provider access revocation after invalid callback credential material.", {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(connection.externalAccountId),
        failureCode: "DEVICE_SYNC_INVALID_CALLBACK_CREDENTIAL_REVOKE_SKIPPED",
        error: summarizePublicIngressError(error),
      });
      return;
    }

    const revokeAccess = provider.connectionHandler?.revokeAccess;

    if (!revokeAccess || credential?.kind !== "oauth_tokens") {
      return;
    }

    try {
      await revokeAccess(buildPendingOAuthCleanupAccount(provider.provider, connection, now));
    } catch (error) {
      this.logger.warn?.("Failed to revoke provider access after OAuth callback setup failed.", {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(connection.externalAccountId),
        failureCode: "DEVICE_SYNC_OAUTH_SETUP_FAILURE_REVOKE_FAILED",
        error: summarizePublicIngressError(error),
      });
    }
  }

  private async cleanupPersistedOAuthConnection(
    provider: DeviceSyncProvider,
    account: PublicDeviceSyncAccount,
    connection: ProviderConnectionResult,
    now: string,
    error: unknown,
  ): Promise<void> {
    await this.cleanupFailedOAuthConnection(provider, connection, now);

    const failure = summarizeOAuthSetupFailure(error);
    let markedAccount: PublicDeviceSyncAccount | null;
    try {
      markedAccount = await this.store.markConnectionSetupFailed({
        accountId: account.id,
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
      throw deviceSyncError({
        code: "OAUTH_SETUP_CLEANUP_FAILED",
        message: "OAuth connection setup failed after persistence, and stored-token cleanup did not complete.",
        httpStatus: 500,
        details: {
          accountId: account.id,
          setupFailureCode: failure.code,
        },
        cause: markError,
      });
    }

    if (!markedAccount) {
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
  }

  private async markSeededConnectionSetupFailed(
    provider: DeviceSyncProvider,
    accountId: string,
    connection: ProviderConnectionResult | null,
    now: string,
    error: unknown,
  ): Promise<void> {
    if (connection) {
      await this.cleanupFailedOAuthConnection(provider, connection, now);
    }

    const failure = summarizeOAuthSetupFailure(error);
    let markedAccount: PublicDeviceSyncAccount | null;
    try {
      markedAccount = await this.store.markConnectionSetupFailed({
        accountId,
        now,
        code: failure.code,
        message: failure.message,
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

    if (!markedAccount) {
      throw deviceSyncError({
        code: "CONNECTION_SETUP_CLEANUP_FAILED",
        message: "Seeded device sync connection setup failed, and setup failure could not confirm the account.",
        httpStatus: 500,
        details: {
          accountId,
          setupFailureCode: failure.code,
        },
      });
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

function buildPendingOAuthCleanupAccount(
  provider: string,
  connection: ProviderConnectionResult,
  now: string,
): DeviceSyncAccount {
  const tokens = requireConnectionOAuthTokens(connection);

  return {
    id: `pending-oauth:${provider}:${connection.externalAccountId}`,
    provider,
    externalAccountId: connection.externalAccountId,
    disconnectGeneration: 0,
    displayName: connection.displayName ?? null,
    status: "active",
    setupPhase: null,
    setupExpiresAt: null,
    scopes: [...(connection.scopes ?? [])],
    accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
    metadata: { ...(connection.metadata ?? {}) },
    connectedAt: now,
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: connection.nextReconcileAt ?? null,
    createdAt: now,
    updatedAt: now,
    credential: {
      kind: "oauth_tokens",
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      },
    },
  };
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
export type { OuraDeviceSyncProviderConfig } from "./providers/oura.ts";
export { createWhoopDeviceSyncProvider } from "./providers/whoop.ts";
export type { WhoopDeviceSyncProviderConfig } from "./providers/whoop.ts";
export { createStravaDeviceSyncProvider, resolveStravaWebhookPreflightResponse } from "./providers/strava.ts";
export type { StravaDeviceSyncProviderConfig } from "./providers/strava.ts";
export { normalizeJunctionResourceName, readJunctionWebhookResourceName } from "./providers/junction.ts";
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
