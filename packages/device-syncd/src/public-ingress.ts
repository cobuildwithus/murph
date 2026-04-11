import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
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
  toIsoTimestamp,
} from "./shared.ts";

import type {
  BeginConnectionResult,
  CompleteConnectionResult,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncPublicIngressConnectionEstablishedInput,
  DeviceSyncPublicIngressHooks,
  DeviceSyncPublicIngressStore,
  DeviceSyncRegistry,
  HandleOAuthCallbackInput,
  HandleWebhookResult,
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

    const stateRecord = await this.store.consumeOAuthState(state, now);

    if (!stateRecord) {
      throw deviceSyncError({
        code: "OAUTH_STATE_INVALID",
        message: "OAuth state is invalid or expired.",
        retryable: false,
        httpStatus: 400,
      });
    }

    try {
      if (stateRecord.provider !== provider.provider) {
        throw deviceSyncError({
          code: "OAUTH_PROVIDER_MISMATCH",
          message: `OAuth state belongs to provider ${stateRecord.provider}, not ${provider.provider}.`,
          retryable: false,
          httpStatus: 400,
        });
      }

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

      const grantedScopes = normalizeString(input.scope)
        ? input.scope!
            .split(/\s+/u)
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [];

      const connection = await provider.exchangeAuthorizationCode(
        {
          callbackUrl: descriptor.callbackUrl,
          state,
          now,
          grantedScopes,
        },
        code,
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

      await this.hooks.onConnectionEstablished?.({
        account,
        connection,
        provider,
        now,
      } satisfies DeviceSyncPublicIngressConnectionEstablishedInput);

      return {
        account,
        returnTo: stateRecord.returnTo ?? null,
      };
    } catch (error) {
      throw attachOAuthCallbackContext(error, {
        provider: provider.provider,
        returnTo: stateRecord.returnTo ?? null,
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
    const durableTraceId = scopeWebhookTraceId(
      provider.provider,
      parsed.externalAccountId,
      parsed.traceId,
    );

    const traceClaim = await this.store.claimWebhookTrace({
      provider: provider.provider,
      traceId: durableTraceId,
      externalAccountId: parsed.externalAccountId,
      eventType: parsed.eventType,
      receivedAt: now,
      payload: parsed.payload,
      processingExpiresAt: addMilliseconds(now, WEBHOOK_TRACE_PROCESSING_TTL_MS),
    });

    if (traceClaim === "processed") {
      return {
        accepted: true,
        duplicate: true,
        provider: provider.provider,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
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
      this.logger.warn?.("Ignoring webhook for unknown device sync account.", {
        provider: provider.provider,
        externalAccountIdHash: hashExternalAccountIdForLogs(parsed.externalAccountId),
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      });

      try {
        await this.hooks.onUnknownWebhook?.({
          provider,
          webhook: parsed,
          externalAccountId: parsed.externalAccountId,
          now,
        });
        await this.store.completeWebhookTrace(provider.provider, durableTraceId);
      } catch (error) {
        await this.store.releaseWebhookTrace(provider.provider, durableTraceId);
        throw error;
      }

      return {
        accepted: true,
        duplicate: false,
        provider: provider.provider,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      };
    }

    if (account.status !== "active") {
      this.logger.warn?.("Ignoring webhook side effects for non-active device sync account.", {
        provider: provider.provider,
        accountId: account.id,
        status: account.status,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      });
      await this.store.completeWebhookTrace(provider.provider, durableTraceId);

      return {
        accepted: true,
        duplicate: false,
        provider: provider.provider,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      };
    }

    try {
      await this.hooks.onWebhookAccepted?.({
        account,
        durableTraceId,
        webhook: parsed,
        provider,
        now,
      });

      if (!this.hooks.onWebhookAccepted) {
        await this.store.completeWebhookTrace(provider.provider, durableTraceId);
      }
    } catch (error) {
      await this.store.releaseWebhookTrace(provider.provider, durableTraceId);
      throw error;
    }

    try {
      await this.store.markWebhookReceived(account.id, now);
    } catch (error) {
      this.logger.warn?.("Failed to record last webhook receipt time after durable acceptance.", {
        provider: provider.provider,
        accountId: account.id,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      accepted: true,
      duplicate: false,
      provider: provider.provider,
      eventType: parsed.eventType,
      traceId: parsed.traceId,
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
}

export function createDeviceSyncPublicIngress(input: CreateDeviceSyncPublicIngressInput): DeviceSyncPublicIngress {
  return new DeviceSyncPublicIngress(input);
}

function hashExternalAccountIdForLogs(value: string): string {
  return sha256Text(value);
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
    message: error.message,
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
export { resolveDeviceSyncWebhookVerificationResponse } from "./webhook-verification.ts";
export { createGarminDeviceSyncProvider } from "./providers/garmin.ts";
export type { GarminDeviceSyncProviderConfig } from "./providers/garmin.ts";
export { createOuraDeviceSyncProvider } from "./providers/oura.ts";
export type { OuraDeviceSyncProviderConfig } from "./providers/oura.ts";
export { createWhoopDeviceSyncProvider } from "./providers/whoop.ts";
export type { WhoopDeviceSyncProviderConfig } from "./providers/whoop.ts";
export type {
  BeginConnectionResult,
  ClaimDeviceSyncWebhookTraceInput,
  CompleteConnectionResult,
  DeviceSyncAccount,
  DeviceSyncAccountStatus,
  DeviceSyncJobInput,
  DeviceSyncProvider,
  DeviceSyncPublicIngressStore,
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
