import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { sanitizeHostedRuntimeErrorText } from "./hosted-runtime.ts";
import {
  normalizeConfiguredDeviceSyncJobInput,
  resolveDeviceSyncProviderCredentialPolicy,
} from "./config/provider-manifests.ts";
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
  DeviceSyncAccountSetupPhase,
  DeviceSyncAccount,
  DeviceSyncIngressWebhook,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncPublicIngressConnectionEstablishedInput,
  DeviceSyncPublicIngressHooks,
  DeviceSyncPublicIngressStore,
  DeviceSyncRegistry,
  HandleConnectionCallbackInput,
  HandleOAuthCallbackInput,
  HandleWebhookResult,
  ProviderAuthTokens,
  ProviderConnectionResult,
  ProviderBeginConnectionResult,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  StartConnectionInput,
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

function toIngressWebhook(parsed: {
  eventType: string;
  jobs: DeviceSyncIngressWebhook["jobs"];
  occurredAt?: string;
  resourceCategory?: string | null;
}): DeviceSyncIngressWebhook {
  const resourceCategory = normalizeString(parsed.resourceCategory);

  return {
    eventType: parsed.eventType,
    jobs: [...parsed.jobs],
    ...(parsed.occurredAt ? { occurredAt: parsed.occurredAt } : {}),
    ...(resourceCategory ? { resourceCategory } : {}),
  };
}

async function beginProviderConnection(
  provider: DeviceSyncProvider,
  input: Parameters<NonNullable<DeviceSyncProvider["beginConnection"]>>[0],
): Promise<ProviderBeginConnectionResult> {
  if (provider.beginConnection) {
    return provider.beginConnection(input);
  }

  if (!provider.buildConnectUrl) {
    throw deviceSyncError({
      code: "CONNECTION_FLOW_NOT_SUPPORTED",
      message: `Device sync provider ${provider.provider} does not support connection start.`,
      retryable: false,
      httpStatus: 500,
    });
  }

  return {
    authorizationUrl: provider.buildConnectUrl({
      state: input.state,
      callbackUrl: input.callbackUrl,
      scopes: input.scopes,
      now: input.now,
    }),
  };
}

async function completeProviderConnection(
  provider: DeviceSyncProvider,
  input: Parameters<NonNullable<DeviceSyncProvider["completeConnection"]>>[0],
): Promise<ProviderConnectionResult> {
  if (provider.completeConnection) {
    return provider.completeConnection(input);
  }

  if (!provider.exchangeAuthorizationCode) {
    throw deviceSyncError({
      code: "CONNECTION_CALLBACK_NOT_SUPPORTED",
      message: `Device sync provider ${provider.provider} does not support connection callbacks.`,
      retryable: false,
      httpStatus: 500,
    });
  }

  const callbackError = normalizeString(input.query.get("error"));

  if (callbackError) {
    throw deviceSyncError({
      code: "OAUTH_CALLBACK_REJECTED",
      message: "OAuth authorization was denied or canceled.",
      retryable: false,
      httpStatus: 400,
    });
  }

  const code = normalizeString(input.query.get("code"));

  if (!code) {
    throw deviceSyncError({
      code: "OAUTH_CODE_MISSING",
      message: "OAuth callback is missing the authorization code.",
      retryable: false,
      httpStatus: 400,
    });
  }

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: input.callbackUrl,
      state: input.state,
      now: input.now,
      grantedScopes: input.grantedScopes,
    },
    code,
  );
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
  ownerId: string | null | undefined;
  providerMetadata: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const metadata = sanitizeConnectionStateMetadata(input.providerMetadata);

  const ownerId = normalizeString(input.ownerId);
  if (ownerId) {
    metadata.ownerId = ownerId;
  }

  return metadata;
}

function buildProviderConnectionStateMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const providerMetadata = { ...metadata };
  delete providerMetadata.ownerId;
  delete providerMetadata[SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY];
  delete providerMetadata[SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY];
  delete providerMetadata[SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY];
  return sanitizeConnectionStateMetadata(providerMetadata);
}

function sanitizeConnectionStateMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const metadata = sanitizeStoredDeviceSyncMetadata(value ?? {});
  delete metadata[SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY];
  delete metadata[SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY];
  delete metadata[SEEDED_CONNECTION_SETUP_EXPIRES_AT_STATE_METADATA_KEY];

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

function setSeededConnectionStateMetadata(
  metadata: Record<string, unknown>,
  account: PublicDeviceSyncAccount,
): Record<string, unknown> {
  const setupExpiresAt = normalizeString(account.setupExpiresAt);

  return {
    ...metadata,
    [SEEDED_CONNECTION_ACCOUNT_ID_STATE_METADATA_KEY]: account.id,
    [SEEDED_CONNECTION_EXTERNAL_ACCOUNT_ID_STATE_METADATA_KEY]: account.externalAccountId,
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
    return connection.setupPhase ?? null;
  }

  return connectionKind === "external_link" ? "link_returned" : null;
}

function resolveConnectionSetupExpiresAt(input: {
  connection: ProviderConnectionResult;
  setupPhase: DeviceSyncAccountSetupPhase | null;
  seededSetupExpiresAt: string | null;
}): string | null {
  if (Object.prototype.hasOwnProperty.call(input.connection, "setupExpiresAt")) {
    return input.connection.setupExpiresAt ?? null;
  }

  return input.setupPhase === "pending_link" || input.setupPhase === "link_returned"
    ? input.seededSetupExpiresAt
    : null;
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
  readonly store: DeviceSyncPublicIngressStore;

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
      supportsWebhooks: Boolean(webhookPath && provider.verifyAndParseWebhook),
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
      ownerId: input.ownerId,
      providerMetadata: started.stateMetadata,
    });
    if (seededAccount) {
      stateMetadata = setSeededConnectionStateMetadata(stateMetadata, seededAccount);
    }

    try {
      await this.store.createOAuthState({
        state,
        provider: provider.provider,
        returnTo,
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

    const stateResult = await this.store.consumeOAuthState(state, now, provider.provider);

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

    const stateRecord = stateResult.record;
    const returnTo = this.sanitizeStoredReturnTo(stateRecord.returnTo ?? null);
    const seededAccountId = readSeededConnectionAccountId(stateRecord.metadata);
    const seededExternalAccountId = readSeededConnectionExternalAccountId(stateRecord.metadata);
    const seededSetupExpiresAt = readSeededConnectionSetupExpiresAt(stateRecord.metadata);
    let connection: ProviderConnectionResult | null = null;
    let account: PublicDeviceSyncAccount | null = null;
    let connectionPersisted = false;

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
      const initialJobs = connection.initialJobs?.map((job) =>
        normalizeConfiguredDeviceSyncJobInput(provider.provider, job, "oauth callback")
      );

      const ownerId =
        typeof stateRecord.metadata?.ownerId === "string" ? normalizeString(stateRecord.metadata.ownerId) : null;
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
        connectedAt: now,
        nextReconcileAt: connection.nextReconcileAt ?? null,
      });
      connectionPersisted = true;

      await this.hooks.onConnectionEstablished?.({
        account,
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
      };
    } catch (error) {
      if (connection) {
        try {
          if (connectionPersisted && account) {
            await this.cleanupPersistedOAuthConnection(provider, account, connection, now, error);
          } else if (seededAccountId) {
            await this.markSeededConnectionSetupFailed(provider, seededAccountId, connection, now, error);
          } else {
            await this.cleanupFailedOAuthConnection(provider, connection, now);
          }
        } catch (cleanupError) {
          throw attachOAuthCallbackContext(cleanupError, {
            provider: provider.provider,
            returnTo,
          });
        }
      } else if (seededAccountId) {
        try {
          await this.markSeededConnectionSetupFailed(provider, seededAccountId, null, now, error);
        } catch (cleanupError) {
          throw attachOAuthCallbackContext(cleanupError, {
            provider: provider.provider,
            returnTo,
          });
        }
      }

      throw attachOAuthCallbackContext(error, {
        provider: provider.provider,
        returnTo,
      });
    }
  }

  async handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult> {
    const provider = this.requireProvider(providerName);

    if (!provider.descriptor.webhook?.path || !provider.verifyAndParseWebhook) {
      throw deviceSyncError({
        code: "WEBHOOKS_NOT_SUPPORTED",
        message: `Device sync provider ${provider.provider} does not accept webhooks.`,
        retryable: false,
        httpStatus: 404,
      });
    }

    const now = toIsoTimestamp(new Date());
    const parsed = await provider.verifyAndParseWebhook({
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
    const webhook = toIngressWebhook({
      ...parsed,
      jobs,
    });

    const traceClaim = await this.store.claimWebhookTrace({
      provider: provider.provider,
      traceId,
      externalAccountId: parsed.externalAccountId,
      eventType: webhook.eventType,
      receivedAt: now,
      processingExpiresAt: addMilliseconds(now, WEBHOOK_TRACE_PROCESSING_TTL_MS),
    });

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

    const account = await this.store.getConnectionByExternalAccount(provider.provider, parsed.externalAccountId);

    if (!account) {
      this.logger.warn?.("Delaying webhook for unknown device sync account.", {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(parsed.externalAccountId),
        eventType: webhook.eventType,
        traceId,
      });

      try {
        await this.hooks.onUnknownWebhook?.({
          provider,
          traceId,
          webhook,
          externalAccountId: parsed.externalAccountId,
          now,
        });
      } finally {
        await this.store.releaseWebhookTrace(provider.provider, traceId);
      }

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
        await this.store.releaseWebhookTrace(provider.provider, traceId);
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
        await this.store.completeWebhookTrace(provider.provider, traceId);

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
        traceId,
        webhook,
        provider,
        now,
      });

      if (!onWebhookAccepted) {
        await this.store.completeWebhookTrace(provider.provider, traceId);
      } else if (acceptedResult?.webhookTraceCompleted !== true) {
        throw deviceSyncError({
          code: "WEBHOOK_TRACE_COMPLETION_REQUIRED",
          message: "Webhook acceptance must complete the claimed trace before returning.",
          retryable: true,
          httpStatus: 503,
        });
      }
    } catch (error) {
      await this.store.releaseWebhookTrace(provider.provider, traceId);
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
        error: sanitizeHostedRuntimeErrorText(
          error instanceof Error ? error.message : String(error),
        ) ?? "[redacted]",
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
        error: summarizePublicIngressError(error),
      });
      return;
    }

    if (!provider.revokeAccess || credential?.kind !== "oauth_tokens") {
      return;
    }

    try {
      await provider.revokeAccess(buildPendingOAuthCleanupAccount(provider.provider, connection, now));
    } catch (error) {
      this.logger.warn?.("Failed to revoke provider access after OAuth callback setup failed.", {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(connection.externalAccountId),
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
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
  };
}

function summarizePublicIngressError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]",
    };
  }

  return {
    value: sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]",
  };
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
      provider: context.provider,
      returnTo: context.returnTo,
    },
    cause: error.cause,
  });
}

export { DeviceSyncError, deviceSyncError, isDeviceSyncError } from "./errors.ts";
export { createDeviceSyncRegistry } from "./registry.ts";
export { toRedactedPublicDeviceSyncAccount } from "./public-account.ts";
export { sanitizeStoredDeviceSyncMetadata } from "./shared.ts";
export { resolveDeviceSyncWebhookPreflightResponse } from "./webhook-verification.ts";
export { createGarminDeviceSyncProvider } from "./providers/garmin.ts";
export type { GarminDeviceSyncProviderConfig } from "./providers/garmin.ts";
export { createOuraDeviceSyncProvider } from "./providers/oura.ts";
export type { OuraDeviceSyncProviderConfig } from "./providers/oura.ts";
export { createWhoopDeviceSyncProvider } from "./providers/whoop.ts";
export type { WhoopDeviceSyncProviderConfig } from "./providers/whoop.ts";
export { createStravaDeviceSyncProvider, resolveStravaWebhookPreflightResponse } from "./providers/strava.ts";
export type { StravaDeviceSyncProviderConfig } from "./providers/strava.ts";
export {
  DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES,
  DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED,
} from "./types.ts";
export type {
  BeginConnectionResult,
  ClaimDeviceSyncWebhookTraceInput,
  CompleteConnectionResult,
  ConsumeOAuthStateResult,
  DeviceSyncAccount,
  DeviceSyncAccountStatus,
  DeviceSyncIngressWebhook,
  DeviceSyncJobInput,
  DeviceSyncProvider,
  DeviceSyncPublicIngressStore,
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
  UpsertPublicDeviceSyncConnectionInput,
} from "./types.ts";
