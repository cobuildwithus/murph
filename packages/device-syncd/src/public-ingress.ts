import { deviceSyncError } from "./errors.js";
import {
  addMilliseconds,
  generateStateCode,
  joinUrl,
  normalizeOriginList,
  normalizePublicBaseUrl,
  normalizeString,
  resolveRelativeOrAllowedOriginUrl,
  toIsoTimestamp,
} from "./shared.js";

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
} from "./types.js";

export interface CreateDeviceSyncPublicIngressInput {
  publicBaseUrl: string;
  allowedReturnOrigins?: string[];
  registry: DeviceSyncRegistry;
  store: DeviceSyncPublicIngressStore;
  sessionTtlMs?: number;
  hooks?: DeviceSyncPublicIngressHooks;
  log?: DeviceSyncLogger;
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
    const webhookPath = provider.webhookPath ?? null;

    return {
      provider: provider.provider,
      callbackPath: provider.callbackPath,
      callbackUrl: joinUrl(this.publicBaseUrl, provider.callbackPath),
      webhookPath,
      webhookUrl: webhookPath ? joinUrl(this.publicBaseUrl, webhookPath) : null,
      supportsWebhooks: Boolean(webhookPath && provider.verifyAndParseWebhook),
      defaultScopes: [...provider.defaultScopes],
    };
  }

  startConnection(input: StartConnectionInput): BeginConnectionResult {
    const now = toIsoTimestamp(new Date());
    const provider = this.requireProvider(input.provider);
    const descriptor = this.describeProvider(provider);
    const returnTo = this.resolveReturnTo(input.returnTo ?? null);
    const state = generateStateCode();
    const expiresAt = addMilliseconds(now, this.sessionTtlMs);

    this.store.deleteExpiredOAuthStates(now);
    this.store.createOAuthState({
      state,
      provider: provider.provider,
      returnTo,
      createdAt: now,
      expiresAt,
      metadata: {},
    });

    return {
      provider: provider.provider,
      state,
      expiresAt,
      authorizationUrl: provider.buildConnectUrl({
        state,
        callbackUrl: descriptor.callbackUrl,
        scopes: provider.defaultScopes,
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

    const stateRecord = this.store.consumeOAuthState(state, now);

    if (!stateRecord) {
      throw deviceSyncError({
        code: "OAUTH_STATE_INVALID",
        message: "OAuth state is invalid or expired.",
        retryable: false,
        httpStatus: 400,
      });
    }

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
      throw deviceSyncError({
        code: "OAUTH_CALLBACK_REJECTED",
        message: normalizeString(input.errorDescription) ?? `OAuth authorization failed: ${callbackError}`,
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
        now,
        grantedScopes,
      },
      code,
    );

    const account = this.store.upsertConnection({
      provider: provider.provider,
      externalAccountId: connection.externalAccountId,
      displayName: connection.displayName ?? null,
      scopes: connection.scopes?.length
        ? [...connection.scopes]
        : grantedScopes.length > 0
          ? [...grantedScopes]
          : [...provider.defaultScopes],
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
  }

  async handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult> {
    const provider = this.requireProvider(providerName);

    if (!provider.webhookPath || !provider.verifyAndParseWebhook) {
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

    if (parsed.traceId) {
      const inserted = this.store.recordWebhookTraceIfNew({
        provider: provider.provider,
        traceId: parsed.traceId,
        externalAccountId: parsed.externalAccountId,
        eventType: parsed.eventType,
        receivedAt: parsed.occurredAt ?? now,
        payload: parsed.payload,
      });

      if (!inserted) {
        return {
          accepted: true,
          duplicate: true,
          provider: provider.provider,
          eventType: parsed.eventType,
          traceId: parsed.traceId,
        };
      }
    }

    const account = this.store.getConnectionByExternalAccount(provider.provider, parsed.externalAccountId);

    if (!account) {
      this.logger.warn?.("Ignoring webhook for unknown device sync account.", {
        provider: provider.provider,
        externalAccountId: parsed.externalAccountId,
        eventType: parsed.eventType,
      });

      await this.hooks.onUnknownWebhook?.({
        provider,
        webhook: parsed,
        externalAccountId: parsed.externalAccountId,
        now,
      });

      return {
        accepted: true,
        duplicate: false,
        provider: provider.provider,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      };
    }

    this.store.markWebhookReceived(account.id, parsed.occurredAt ?? now);

    if (account.status !== "active") {
      this.logger.warn?.("Ignoring webhook side effects for non-active device sync account.", {
        provider: provider.provider,
        accountId: account.id,
        status: account.status,
        eventType: parsed.eventType,
      });

      return {
        accepted: true,
        duplicate: false,
        provider: provider.provider,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      };
    }

    await this.hooks.onWebhookAccepted?.({
      account,
      webhook: parsed,
      provider,
      now,
    });

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
