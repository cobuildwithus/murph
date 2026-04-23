import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { sanitizeHostedRuntimeErrorText } from "./hosted-runtime.ts";
import { normalizeConfiguredDeviceSyncJobInput } from "./config/provider-manifests.ts";
import {
  addMilliseconds,
  generateStateCode,
  joinUrl,
  normalizeOriginList,
  normalizePublicBaseUrl,
  normalizeString,
  resolveRelativeOrAllowedOriginUrl,
  scopeWebhookTraceId,
  sha256Text,
  splitScopeList,
  toIsoTimestamp,
} from "./shared.ts";

import type {
  BeginConnectionResult,
  CompleteConnectionResult,
  DeviceSyncAccount,
  DeviceSyncIngressWebhook,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncPublicIngressConnectionEstablishedInput,
  DeviceSyncPublicIngressHooks,
  DeviceSyncPublicIngressStore,
  DeviceSyncRegistry,
  HandleOAuthCallbackInput,
  HandleWebhookResult,
  ProviderConnectionResult,
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
    const callbackPath = provider.descriptor.oauth?.callbackPath;
    const webhookPath = provider.descriptor.webhook?.path ?? null;

    if (!callbackPath) {
      throw deviceSyncError({
        code: "OAUTH_NOT_SUPPORTED",
        message: `Device sync provider ${provider.provider} does not define an OAuth callback path.`,
        retryable: false,
        httpStatus: 500,
      });
    }

    return {
      provider: provider.provider,
      callbackPath,
      callbackUrl: joinUrl(this.publicBaseUrl, callbackPath),
      webhookPath,
      webhookUrl: webhookPath ? joinUrl(this.publicBaseUrl, webhookPath) : null,
      supportsWebhooks: Boolean(webhookPath && provider.verifyAndParseWebhook),
      defaultScopes: [...(provider.descriptor.oauth?.defaultScopes ?? [])],
    };
  }

  async startConnection(input: StartConnectionInput): Promise<BeginConnectionResult> {
    const now = toIsoTimestamp(new Date());
    const provider = this.requireProvider(input.provider);
    const descriptor = this.describeProvider(provider);
    const returnTo = this.resolveReturnTo(input.returnTo ?? null);
    const state = generateStateCode();
    const expiresAt = addMilliseconds(now, this.sessionTtlMs);

    await this.store.deleteExpiredOAuthStates(now);
    await this.store.createOAuthState({
      state,
      provider: provider.provider,
      returnTo,
      createdAt: now,
      expiresAt,
      metadata: input.ownerId ? { ownerId: input.ownerId } : {},
    });

    return {
      provider: provider.provider,
      state,
      expiresAt,
      authorizationUrl: provider.buildConnectUrl({
        state,
        callbackUrl: descriptor.callbackUrl,
        scopes: descriptor.defaultScopes,
        now,
      }),
    };
  }

  async handleOAuthCallback(input: HandleOAuthCallbackInput): Promise<CompleteConnectionResult> {
    const provider = this.requireProvider(input.provider);
    const now = toIsoTimestamp(new Date());
    const descriptor = this.describeProvider(provider);
    const state = normalizeString(input.state);

    if (!state) {
      throw deviceSyncError({
        code: "OAUTH_STATE_MISSING",
        message: "OAuth callback is missing the state parameter.",
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
    let connection: ProviderConnectionResult | null = null;
    let connectionPersisted = false;

    try {
      const callbackError = normalizeString(input.error);

      if (callbackError) {
        this.logger.warn?.("OAuth callback was rejected by the provider.", {
          provider: provider.provider,
          callbackError,
        });

        throw deviceSyncError({
          code: "OAUTH_CALLBACK_REJECTED",
          message: "OAuth authorization was denied or canceled.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const code = normalizeString(input.code);

      if (!code) {
        throw deviceSyncError({
          code: "OAUTH_CODE_MISSING",
          message: "OAuth callback is missing the authorization code.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const grantedScopes = splitScopeList(input.scope);

      connection = await provider.exchangeAuthorizationCode(
        {
          callbackUrl: descriptor.callbackUrl,
          state,
          now,
          grantedScopes,
        },
        code,
      );
      const initialJobs = connection.initialJobs?.map((job) =>
        normalizeConfiguredDeviceSyncJobInput(provider.provider, job, "oauth callback")
      );

      const ownerId =
        typeof stateRecord.metadata?.ownerId === "string" ? normalizeString(stateRecord.metadata.ownerId) : null;

      const account = await this.store.upsertConnection({
        ownerId,
        provider: provider.provider,
        externalAccountId: connection.externalAccountId,
        displayName: connection.displayName ?? null,
        scopes: connection.scopes?.length
          ? [...connection.scopes]
          : grantedScopes.length > 0
            ? [...grantedScopes]
            : [...descriptor.defaultScopes],
        tokens: connection.tokens,
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
      if (connection && !connectionPersisted) {
        await this.cleanupFailedOAuthConnection(provider, connection, now);
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
    if (!provider.revokeAccess) {
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
  return {
    id: `pending-oauth:${provider}:${connection.externalAccountId}`,
    provider,
    externalAccountId: connection.externalAccountId,
    disconnectGeneration: 0,
    displayName: connection.displayName ?? null,
    status: "active",
    scopes: [...(connection.scopes ?? [])],
    accessTokenExpiresAt: connection.tokens.accessTokenExpiresAt ?? null,
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
    accessToken: connection.tokens.accessToken,
    refreshToken: connection.tokens.refreshToken ?? null,
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
  HandleWebhookResult,
  OAuthStateRecord,
  ProviderAuthTokens,
  ProviderConnectionResult,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  UpsertPublicDeviceSyncConnectionInput,
} from "./types.ts";
