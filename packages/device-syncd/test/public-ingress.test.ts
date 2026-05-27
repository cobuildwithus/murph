import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { DeviceSyncError, deviceSyncError } from "../src/errors.ts";
import { createDeviceSyncPublicIngress } from "../src/public-ingress.ts";
import { createDeviceSyncRegistry } from "../src/registry.ts";
import { scopeWebhookTraceId, sha256Text } from "../src/shared.ts";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  ConsumeOAuthStateResult,
  DeviceConnectionHandler,
  DeviceJobExecutor,
  DeviceSyncIngressWebhook,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncProvider,
  DeviceSyncPublicIngressConnectionEstablishedInput,
  DeviceSyncPublicIngressStore,
  DeviceSyncPublicIngressWebhookAcceptedInput,
  DeviceSyncPublicIngressWebhookAcceptedResult,
  DeviceSyncWebhookTraceRecord,
  DeviceWebhookHandler,
  OAuthStateRecord,
  ProviderAuthTokens,
  ProviderConnectionResult,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "../src/types.ts";
import {
  DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED,
  classifyDeviceSyncWebhookAcceptanceMode,
  getDeviceSyncAccountOAuthTokens,
} from "../src/types.ts";

class InMemoryPublicIngressStore implements DeviceSyncPublicIngressStore {
  private readonly oauthStates = new Map<string, OAuthStateRecord>();
  private readonly accounts = new Map<string, PublicDeviceSyncAccount>();
  private readonly accountsByProviderExternal = new Map<string, string>();
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
  claimWebhookTraceCalls = 0;
  completedWebhookTraceCalls = 0;
  markConnectionSetupFailedError: Error | null = null;
  private accountCounter = 0;

  deleteExpiredOAuthStates(now: string): number {
    let deleted = 0;

    for (const [state, record] of this.oauthStates.entries()) {
      if (Date.parse(record.expiresAt) <= Date.parse(now)) {
        this.oauthStates.delete(state);
        deleted += 1;
      }
    }

    return deleted;
  }

  createOAuthState(input: OAuthStateRecord): OAuthStateRecord {
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

    if (!record || Date.parse(record.expiresAt) <= Date.parse(now)) {
      this.oauthStates.delete(state);
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

    this.oauthStates.delete(state);
    return {
      status: "consumed",
      record,
    };
  }

  hasOAuthState(state: string): boolean {
    return this.oauthStates.has(state);
  }

  peekOAuthState(state: string): OAuthStateRecord | null {
    return this.oauthStates.get(state) ?? null;
  }

  upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount {
    const key = `${input.provider}:${input.externalAccountId}`;
    const existingId = this.accountsByProviderExternal.get(key) ?? null;
    const existing = existingId ? this.accounts.get(existingId) ?? null : null;
    assertExistingAccountGuard(existing, input.existingAccountGuard ?? null);

    const now = input.connectedAt;
    const id = existing?.id ?? `acct_${String(++this.accountCounter).padStart(2, "0")}`;
    const tokens = readOAuthCredentialTokens(input);
    const setupPhase = Object.prototype.hasOwnProperty.call(input, "setupPhase")
      ? input.setupPhase ?? null
      : existing?.setupPhase ?? null;
    const setupExpiresAt = Object.prototype.hasOwnProperty.call(input, "setupExpiresAt")
      ? input.setupExpiresAt ?? null
      : existing?.setupExpiresAt ?? null;

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
      metadata: { ...(input.metadata ?? {}) },
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
    this.accountsByProviderExternal.set(key, id);
    return record;
  }

  markConnectionSetupFailed(input: {
    accountId: string;
    code: string;
    message: string;
    now: string;
  }): PublicDeviceSyncAccount | null {
    if (this.markConnectionSetupFailedError) {
      throw this.markConnectionSetupFailedError;
    }

    const existing = this.accounts.get(input.accountId) ?? null;
    if (!existing) {
      return null;
    }

    const record: PublicDeviceSyncAccount = {
      ...existing,
      accessTokenExpiresAt: null,
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
    return record;
  }

  getConnectionByExternalAccount(provider: string, externalAccountId: string): PublicDeviceSyncAccount | null {
    const id = this.accountsByProviderExternal.get(`${provider}:${externalAccountId}`) ?? null;
    return id ? (this.accounts.get(id) ?? null) : null;
  }

  getConnectionById(accountId: string): PublicDeviceSyncAccount | null {
    return this.accounts.get(accountId) ?? null;
  }

  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult {
    this.claimWebhookTraceCalls += 1;
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

    if (existing.expiresAt && Date.parse(existing.expiresAt) > Date.parse(input.receivedAt)) {
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
}

function completeWebhookAcceptDurably(
  store: InMemoryPublicIngressStore,
  account: PublicDeviceSyncAccount,
  traceId: string,
  claimToken: string,
): DeviceSyncPublicIngressWebhookAcceptedResult {
  store.completeWebhookTrace(account.provider, traceId, claimToken);
  return DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED;
}

function requireCallback(callback: (() => void) | null, message: string): () => void {
  assert.ok(callback, message);
  return callback;
}

function readRecordedWebhookTrace(store: InMemoryPublicIngressStore): DeviceSyncWebhookTraceRecord | null {
  return store.lastRecordedWebhookTrace;
}

type FakeProviderOverrides = Partial<DeviceSyncProvider> & {
  beginConnection?: DeviceConnectionHandler["beginConnection"];
  completeConnection?: DeviceConnectionHandler["completeConnection"];
  buildConnectUrl?: (input: {
    state: string;
    callbackUrl: string;
    scopes: string[];
    now: string;
  }) => string;
  exchangeAuthorizationCode?: (
    context: Parameters<DeviceConnectionHandler["completeConnection"]>[0] extends infer _Input
      ? {
          callbackUrl: string;
          state: string;
          now: string;
          grantedScopes: string[];
        }
      : never,
    code: string,
  ) => Promise<ProviderConnectionResult>;
  refreshTokens?: DeviceConnectionHandler["refreshTokens"];
  revokeAccess?: DeviceConnectionHandler["revokeAccess"];
  createScheduledJobs?: DeviceJobExecutor["createScheduledJobs"];
  verifyAndParseWebhook?: (
    context: Parameters<NonNullable<DeviceWebhookHandler["verifyAndParseWebhook"]>>[0],
  ) => Promise<Omit<Awaited<ReturnType<NonNullable<DeviceWebhookHandler["verifyAndParseWebhook"]>>>, "acceptanceMode"> & {
    acceptanceMode?: "level_dirty_hint" | "durable_webhook_work";
  }>;
  executeJob?: DeviceJobExecutor["executeJob"];
};

function createFakeProvider(overrides: FakeProviderOverrides = {}): DeviceSyncProvider {
  const defaultBuildConnectUrl: NonNullable<FakeProviderOverrides["buildConnectUrl"]> = (context) =>
    `https://example.test/oauth?state=${context.state}&redirect_uri=${encodeURIComponent(context.callbackUrl)}`;
  const defaultExchangeAuthorizationCode: NonNullable<FakeProviderOverrides["exchangeAuthorizationCode"]> =
    async (_context, code) => ({
      externalAccountId: `demo-${code}`,
      displayName: `Demo ${code}`,
      scopes: ["offline", "read:data"],
      metadata: {
        connectedBy: code,
      },
      tokens: {
        accessToken: "<REDACTED_ACCESS_TOKEN>",
        refreshToken: "<REDACTED_REFRESH_TOKEN>",
      } satisfies ProviderAuthTokens,
      initialJobs: [
        {
          kind: "backfill",
          payload: {
            windowStart: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
      nextReconcileAt: "2026-03-24T00:00:00.000Z",
    });
  const defaultRefreshTokens: NonNullable<DeviceConnectionHandler["refreshTokens"]> = async () => ({
    accessToken: "<REDACTED_ACCESS_TOKEN_2>",
  });
  const defaultVerifyAndParseWebhook: DeviceWebhookHandler["verifyAndParseWebhook"] = async () => ({
    acceptanceMode: "durable_webhook_work",
    externalAccountId: "demo-abc",
    eventType: "demo.updated",
    traceId: "trace-1",
    jobs: [
      {
        kind: "resource",
        payload: {
          resourceId: "resource-1",
        },
      },
    ],
  });
  const defaultExecuteJob: DeviceJobExecutor["executeJob"] = async () => ({});
  const hasConnectionHandlerOverride = Object.hasOwn(overrides, "connectionHandler");
  const hasWebhookHandlerOverride = Object.hasOwn(overrides, "webhookHandler");
  const hasJobExecutorOverride = Object.hasOwn(overrides, "jobExecutor");
  const buildConnectUrl = Object.hasOwn(overrides, "buildConnectUrl")
    ? overrides.buildConnectUrl
    : defaultBuildConnectUrl;
  const exchangeAuthorizationCode = Object.hasOwn(overrides, "exchangeAuthorizationCode")
    ? overrides.exchangeAuthorizationCode
    : defaultExchangeAuthorizationCode;
  const refreshTokens = Object.hasOwn(overrides, "refreshTokens")
    ? overrides.refreshTokens
    : defaultRefreshTokens;
  const verifyAndParseWebhook = Object.hasOwn(overrides, "verifyAndParseWebhook")
    ? overrides.verifyAndParseWebhook
    : defaultVerifyAndParseWebhook;
  const executeJob = Object.hasOwn(overrides, "executeJob")
    ? overrides.executeJob
    : defaultExecuteJob;
  const createScheduledJobs = Object.hasOwn(overrides, "createScheduledJobs")
    ? overrides.createScheduledJobs
    : undefined;
  const {
    beginConnection,
    completeConnection,
    buildConnectUrl: _buildConnectUrl,
    exchangeAuthorizationCode: _exchangeAuthorizationCode,
    refreshTokens: _refreshTokens,
    revokeAccess,
    createScheduledJobs: _createScheduledJobs,
    verifyAndParseWebhook: _verifyAndParseWebhook,
    executeJob: _executeJob,
    ...providerOverrides
  } = overrides;
  const baseProvider: DeviceSyncProvider = {
    provider: "demo",
    descriptor: {
      provider: "demo",
      displayName: "Demo",
      transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
      oauth: {
        callbackPath: "/oauth/demo/callback",
        defaultScopes: ["offline", "read:data"],
      },
      webhook: {
        path: "/webhooks/demo",
        deliveryMode: "notification",
        supportsAdmin: false,
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
    ...(hasConnectionHandlerOverride
      ? { connectionHandler: providerOverrides.connectionHandler }
      : {
          connectionHandler: {
            beginConnection: beginConnection ?? (async (input) => ({
              authorizationUrl: buildConnectUrl
                ? buildConnectUrl({
                    state: input.state,
                    callbackUrl: input.callbackUrl,
                    scopes: input.scopes,
                    now: input.now,
                  })
                : "",
            })),
            completeConnection: completeConnection ?? (async (input) => {
              const callbackError = input.query.get("error")?.trim();
              if (callbackError) {
                throw deviceSyncError({
                  code: "OAUTH_CALLBACK_REJECTED",
                  message: "OAuth authorization was denied or canceled.",
                  retryable: false,
                  httpStatus: 400,
                });
              }
              const code = input.query.get("code") ?? "";
              if (!code) {
                throw deviceSyncError({
                  code: "OAUTH_CODE_MISSING",
                  message: "OAuth callback is missing the authorization code.",
                  retryable: false,
                  httpStatus: 400,
                });
              }
              if (!exchangeAuthorizationCode) {
                throw new Error("Fake provider exchangeAuthorizationCode is not configured.");
              }
              return exchangeAuthorizationCode({
                callbackUrl: input.callbackUrl,
                state: input.state,
                now: input.now,
                grantedScopes: input.grantedScopes,
              }, code);
            }),
            ...(refreshTokens ? { refreshTokens } : {}),
            ...(revokeAccess ? { revokeAccess } : {}),
          },
        }),
    ...(hasWebhookHandlerOverride
      ? { webhookHandler: providerOverrides.webhookHandler }
      : verifyAndParseWebhook
        ? {
            webhookHandler: {
              verifyAndParseWebhook: async (context) => {
                const parsed = await verifyAndParseWebhook(context);
                return {
                  ...parsed,
                  acceptanceMode: parsed.acceptanceMode
                    ?? classifyDeviceSyncWebhookAcceptanceMode(parsed.jobs),
                };
              },
            },
          }
        : {}),
    ...(hasJobExecutorOverride
      ? { jobExecutor: providerOverrides.jobExecutor }
      : {
          jobExecutor: {
            ...(createScheduledJobs ? { createScheduledJobs } : {}),
            executeJob: executeJob ?? defaultExecuteJob,
          },
        }),
  };

  return {
    ...baseProvider,
    ...providerOverrides,
  };
}

test("public ingress reuses shared OAuth callback logic independently of the local daemon", async () => {
  const store = new InMemoryPublicIngressStore();
  const connectionEvents: Array<{ accountId: string; initialJobs: number }> = [];
  const seenStates: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async exchangeAuthorizationCode(context, code) {
          seenStates.push(context.state);
          return {
            externalAccountId: `demo-${code}`,
            displayName: `Demo ${code}`,
            scopes: ["offline", "read:data"],
            metadata: {
              connectedBy: code,
            },
            tokens: {
              accessToken: "<REDACTED_ACCESS_TOKEN>",
              refreshToken: "<REDACTED_REFRESH_TOKEN>",
            } satisfies ProviderAuthTokens,
            initialJobs: [
              {
                kind: "backfill",
                payload: {
                  windowStart: "2026-01-01T00:00:00.000Z",
                },
              },
            ],
            nextReconcileAt: "2026-03-24T00:00:00.000Z",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished({ account, connection }) {
        connectionEvents.push({
          accountId: account.id,
          initialJobs: connection.initialJobs?.length ?? 0,
        });
      },
    },
  });

  const begin = await ingress.startConnection({
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });
  assert.match(begin.authorizationUrl, /^https:\/\/example\.test\/oauth\?state=/u);
  assert.match(begin.authorizationUrl, /redirect_uri=https%3A%2F%2Fsync\.example\.test%2Fdevice-sync%2Foauth%2Fdemo%2Fcallback/u);

  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.externalAccountId, "demo-abc");
  assert.equal(connected.account.provider, "demo");
  assert.equal(connected.returnTo, "https://app.example.test/settings/devices");
  assert.deepEqual(connectionEvents, [
    {
      accountId: connected.account.id,
      initialJobs: 1,
    },
  ]);
  assert.deepEqual(seenStates, [begin.state]);
});

test("public ingress describes providers with nullable callbacks and rejects unsupported connection starts", async () => {
  const descriptorOnlyProvider = createFakeProvider({
    provider: "descriptor-only",
    descriptor: {
      provider: "descriptor-only",
      displayName: "Descriptor Only",
      transportModes: ["scheduled_poll"],
      webhook: undefined,
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store: new InMemoryPublicIngressStore(),
  });
  const descriptorOnlyIngress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([descriptorOnlyProvider]),
    store: new InMemoryPublicIngressStore(),
  });

  assert.deepEqual(
    ingress.describeProviders(),
    [
      {
        provider: "demo",
        connectionKind: "oauth2",
        credentialPolicy: "oauth_tokens",
        callbackPath: "/oauth/demo/callback",
        callbackUrl: "https://sync.example.test/device-sync/oauth/demo/callback",
        webhookPath: "/webhooks/demo",
        webhookUrl: "https://sync.example.test/device-sync/webhooks/demo",
        supportsWebhooks: true,
        defaultScopes: ["offline", "read:data"],
      },
    ],
  );
  assert.deepEqual(
    descriptorOnlyIngress.describeProvider(descriptorOnlyProvider),
    {
      provider: "descriptor-only",
      connectionKind: "none",
      credentialPolicy: "none",
      callbackPath: null,
      callbackUrl: null,
      webhookPath: null,
      webhookUrl: null,
      supportsWebhooks: false,
      defaultScopes: [],
    },
  );
  await assert.rejects(
    () => descriptorOnlyIngress.startConnection({ provider: "descriptor-only" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_FLOW_NOT_SUPPORTED"
      && error.httpStatus === 500,
  );
});

test("public ingress rejects callback-required connection starts without callback paths", async () => {
  const provider = createFakeProvider({
    provider: "callback-required",
    descriptor: {
      provider: "callback-required",
      displayName: "Callback Required",
      transportModes: ["external_link"],
      connection: {
        kind: "external_link",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
    async beginConnection() {
      return {
        authorizationUrl: "https://provider.example/connect",
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "callback-required-account",
        credential: {
          kind: "none",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store: new InMemoryPublicIngressStore(),
  });

  assert.deepEqual(ingress.describeProvider(provider), {
    provider: "callback-required",
    connectionKind: "external_link",
    credentialPolicy: "none",
    callbackPath: null,
    callbackUrl: null,
    webhookPath: null,
    webhookUrl: null,
    supportsWebhooks: false,
    defaultScopes: [],
  });
  await assert.rejects(
    () => ingress.startConnection({ provider: "callback-required" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CALLBACK_URL_REQUIRED"
      && error.httpStatus === 500,
  );
});

test("public ingress persists validated provider-config connection seeds before external-link redirects", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          displayName: "Junction",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          metadata: {
            linkOutcome: "pending",
          },
        },
        stateMetadata: {
          clientUserIdHash: "client-hash-1",
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
    returnTo: "https://sync.example.test/settings/devices",
  });

  assert.equal(begin.authorizationUrl, `https://junction.example/link?murph_state=${begin.state}`);
  const account = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(account?.status, "active");
  assert.equal(account?.setupPhase, "pending_link");
  assert.ok(account?.setupExpiresAt);
  assert.equal(account?.accessTokenExpiresAt, null);
  assert.deepEqual(account?.metadata, {
    linkOutcome: "pending",
  });
  const stateRecord = store.peekOAuthState(begin.state);
  assert.equal(stateRecord?.ownerId, "<REDACTED_OWNER_ID>");
  assert.equal(Object.prototype.hasOwnProperty.call(stateRecord?.metadata ?? {}, "ownerId"), false);
  assert.equal(
    account ? Object.values(stateRecord?.metadata ?? {}).includes(account.id) : false,
    true,
  );
  assert.equal(Object.values(stateRecord?.metadata ?? {}).includes("external-account-1"), false);
});

test("public ingress completes external-link callbacks with sanitized state metadata and setup phase", async () => {
  const store = new InMemoryPublicIngressStore();
  let callbackStateMetadata: Record<string, unknown> | undefined;
  let callbackSeededExternalAccountId: string | null | undefined;
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          displayName: "Junction",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
        stateMetadata: {
          ownerId: "<REDACTED_OWNER_ID>",
          rawUserId: "<REDACTED_USER_ID>",
          junctionUserId: "<REDACTED_PROVIDER_USER_ID>",
          user: "<REDACTED_PROVIDER_USER_ID>",
          accessToken: "<REDACTED_ACCESS_TOKEN>",
          webhookSecret: "<REDACTED_WEBHOOK_SECRET>",
          clientId: "<REDACTED_CLIENT_ID>",
          clientUserId: "<REDACTED_CLIENT_USER_ID>",
          clientUserIdHash: "client-hash-1",
        },
      };
    },
    async completeConnection(input) {
      callbackStateMetadata = input.stateMetadata;
      callbackSeededExternalAccountId = input.seededExternalAccountId;
      return {
        externalAccountId: "external-account-1",
        displayName: "Junction",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
    returnTo: "https://sync.example.test/settings/devices",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(seeded?.setupExpiresAt);
  const completed = await ingress.handleConnectionCallback({
    provider: "junction",
    query: new URLSearchParams({
      murph_state: begin.state,
      result: "success",
    }),
  });

  assert.deepEqual(callbackStateMetadata, {
    clientUserIdHash: "client-hash-1",
  });
  assert.equal(callbackSeededExternalAccountId, "external-account-1");
  assert.equal(Object.prototype.hasOwnProperty.call(callbackStateMetadata ?? {}, "ownerId"), false);
  assert.equal(completed.account.setupPhase, "link_returned");
  assert.equal(completed.account.setupExpiresAt, seeded.setupExpiresAt);
  assert.equal(completed.account.externalAccountId, "external-account-1");
  assert.equal(Object.values(callbackStateMetadata ?? {}).includes(completed.account.id), false);
});

test("public ingress rejects external-link callbacks that do not match the seeded account", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-2",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(seeded?.setupPhase, "pending_link");

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_SEEDED_ACCOUNT_MISMATCH"
      && error.httpStatus === 500,
  );

  const failed = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(failed);
  assert.equal(failed.id, seeded?.id);
  assert.equal(failed.status, "reauthorization_required");
  assert.equal(failed.setupPhase, "failed");
  assert.equal(failed.lastErrorCode, "CONNECTION_SEEDED_ACCOUNT_MISMATCH");
  assert.equal(store.getConnectionByExternalAccount("junction", "external-account-2"), null);
});

test("public ingress rejects stale external-link callbacks after seeded accounts are disconnected", async () => {
  const store = new InMemoryPublicIngressStore();
  let completeCalls = 0;
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      completeCalls += 1;
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    returnTo: "/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
    ownerId: "<REDACTED_OWNER_ID>",
    connectSourceId: "garmin",
    connectTarget: "garmin",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(seeded);
  store.patchAccountStatus(seeded.id, "disconnected");

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "success",
        }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "CONNECTION_ALREADY_DISCONNECTED");
      assert.equal(error.httpStatus, 409);
      assert.equal(error.details?.connectSourceId, "garmin");
      assert.equal(error.details?.connectTarget, "garmin");
      assert.equal(error.details?.provider, "junction");
      assert.equal(
        error.details?.returnTo,
        "https://sync.example.test/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
      );
      assert.equal(Object.values(error.details ?? {}).includes(seeded.id), false);
      assert.equal(Object.values(error.details ?? {}).includes(seeded.externalAccountId), false);
      return true;
    },
  );

  const disconnected = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(disconnected?.status, "disconnected");
  assert.equal(disconnected?.setupPhase, "pending_link");
  assert.equal(completeCalls, 0);
});

test("public ingress rejects seeded callbacks that finish after the seeded account is disconnected", async () => {
  const store = new InMemoryPublicIngressStore();
  let completeCalls = 0;
  let resolveProviderCompletionStarted: (() => void) | null = null;
  let releaseProviderCompletion: () => void = () => {
    throw new Error("Provider completion release was not initialized.");
  };
  const providerCompletionStarted = new Promise<void>((resolve) => {
    resolveProviderCompletionStarted = resolve;
  });
  const providerCompletionRelease = new Promise<void>((resolve) => {
    releaseProviderCompletion = resolve;
  });
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    beginConnection: async (input) => ({
      authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
      connectionSeed: {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      },
    }),
    completeConnection: async () => {
      completeCalls += 1;
      resolveProviderCompletionStarted?.();
      await providerCompletionRelease;
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    returnTo: "/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
    ownerId: "<REDACTED_OWNER_ID>",
    connectSourceId: "garmin",
    connectTarget: "garmin",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(seeded);
  const callback = ingress.handleConnectionCallback({
    provider: "junction",
    query: new URLSearchParams({
      murph_state: begin.state,
      result: "success",
    }),
  });
  await providerCompletionStarted;
  store.patchAccountStatus(seeded.id, "disconnected");
  releaseProviderCompletion();

  await assert.rejects(
    () => callback,
    (error: unknown) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "CONNECTION_ALREADY_DISCONNECTED");
      assert.equal(error.httpStatus, 409);
      assert.equal(error.details?.connectSourceId, "garmin");
      assert.equal(error.details?.connectTarget, "garmin");
      assert.equal(error.details?.provider, "junction");
      return true;
    },
  );

  const disconnected = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(disconnected?.status, "disconnected");
  assert.equal(disconnected?.setupPhase, "pending_link");
  assert.equal(completeCalls, 1);
});

test("public ingress marks seeded external-link accounts failed when callbacks fail before upsert", async () => {
  const store = new InMemoryPublicIngressStore();
  const callbackError = new DeviceSyncError({
    code: "EXTERNAL_LINK_CALLBACK_FAILED",
    message: "External link callback could not be completed.",
    httpStatus: 400,
  });
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      throw callbackError;
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  const seeded = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.equal(seeded?.status, "active");
  assert.equal(seeded?.setupPhase, "pending_link");

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "failure",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "EXTERNAL_LINK_CALLBACK_FAILED"
      && error.httpStatus === 400,
  );

  const failed = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(failed);
  assert.equal(failed.id, seeded?.id);
  assert.equal(failed.status, "reauthorization_required");
  assert.equal(failed.setupPhase, "failed");
  assert.equal(failed.setupExpiresAt, null);
  assert.equal(failed.lastErrorCode, "EXTERNAL_LINK_CALLBACK_FAILED");
  assert.equal(failed.lastErrorMessage, "External link callback could not be completed.");
  assert.ok(failed.lastSyncErrorAt);
});

test("public ingress marks seeded external-link accounts failed when callback credentials violate policy", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection(input) {
      return {
        authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "unexpected-profile",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: begin.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "PROVIDER_CONFIG_KEY_MISMATCH"
      && error.httpStatus === 500,
  );

  const failed = store.getConnectionByExternalAccount("junction", "external-account-1");
  assert.ok(failed);
  assert.equal(failed.status, "reauthorization_required");
  assert.equal(failed.setupPhase, "failed");
  assert.equal(failed.lastErrorCode, "PROVIDER_CONFIG_KEY_MISMATCH");
});

test("public ingress rejects callback credentials that violate provider credential policy", async () => {
  const makeIngress = (connection: ProviderConnectionResult) => {
    const store = new InMemoryPublicIngressStore();
    const provider = createFakeProvider({
      provider: "junction",
      credentialPolicy: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      descriptor: {
        provider: "junction",
        displayName: "Junction",
        transportModes: ["external_link", "scheduled_poll"],
        connection: {
          kind: "external_link",
          callbackPath: "/connect/junction/callback",
        },
        normalization: {
          metricFamilies: ["activity"],
          snapshotParser: "schema",
        },
        sourcePriorityHints: {
          defaultPriority: 60,
          metricFamilies: {
            activity: 60,
          },
        },
      },
      async beginConnection(input) {
        return {
          authorizationUrl: `https://junction.example/link?murph_state=${input.state}`,
        };
      },
      async completeConnection() {
        return connection;
      },
    });
    return {
      ingress: createDeviceSyncPublicIngress({
        publicBaseUrl: "https://sync.example.test/device-sync",
        registry: createDeviceSyncRegistry([provider]),
        store,
      }),
      store,
    };
  };

  const wrongKey = makeIngress({
    externalAccountId: "external-account-1",
    credential: {
      kind: "provider_config",
      providerConfigKey: "other-profile",
    },
  });
  const wrongKeyState = await wrongKey.ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  await assert.rejects(
    () =>
      wrongKey.ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: wrongKeyState.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "PROVIDER_CONFIG_KEY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(wrongKey.store.getConnectionByExternalAccount("junction", "external-account-1"), null);

  const wrongKind = makeIngress({
    externalAccountId: "external-account-2",
    credential: {
      kind: "none",
    },
  });
  const wrongKindState = await wrongKind.ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  await assert.rejects(
    () =>
      wrongKind.ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: wrongKindState.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CREDENTIAL_POLICY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(wrongKind.store.getConnectionByExternalAccount("junction", "external-account-2"), null);

  const mixedCredential = makeIngress({
    externalAccountId: "external-account-3",
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    tokens: {
      accessToken: "<REDACTED_ACCESS_TOKEN>",
      refreshToken: "<REDACTED_REFRESH_TOKEN>",
    },
  });
  const mixedCredentialState = await mixedCredential.ingress.startConnection({
    provider: "junction",
    ownerId: "<REDACTED_OWNER_ID>",
  });
  await assert.rejects(
    () =>
      mixedCredential.ingress.handleConnectionCallback({
        provider: "junction",
        query: new URLSearchParams({
          murph_state: mixedCredentialState.state,
          result: "success",
        }),
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CREDENTIAL_AMBIGUOUS"
      && error.httpStatus === 500,
  );
  assert.equal(mixedCredential.store.getConnectionByExternalAccount("junction", "external-account-3"), null);
});

test("public ingress rejects provider-config connection seeds with the wrong provider config key", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "junction",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "junction",
      displayName: "Junction",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/junction/callback",
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 60,
        metricFamilies: {
          activity: 60,
        },
      },
    },
    async beginConnection() {
      return {
        authorizationUrl: "https://junction.example/link",
        connectionSeed: {
          externalAccountId: "external-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "other-profile",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "external-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  await assert.rejects(
    () => ingress.startConnection({ provider: "junction", ownerId: "<REDACTED_OWNER_ID>" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "PROVIDER_CONFIG_KEY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(store.getConnectionByExternalAccount("junction", "external-account-1"), null);
});

test("configured provider manifests own credential policy over provider instances", async () => {
  const store = new InMemoryPublicIngressStore();
  const provider = createFakeProvider({
    provider: "oura",
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      provider: "oura",
      displayName: "Fake Oura",
      transportModes: ["external_link", "scheduled_poll"],
      connection: {
        kind: "external_link",
        callbackPath: "/connect/oura/callback",
      },
      normalization: {
        metricFamilies: ["sleep"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 90,
        metricFamilies: {
          sleep: 90,
        },
      },
    },
    async beginConnection() {
      return {
        authorizationUrl: "https://oura.example/link",
        connectionSeed: {
          externalAccountId: "oura-account-1",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
        },
      };
    },
    async completeConnection() {
      return {
        externalAccountId: "oura-account-1",
        credential: {
          kind: "provider_config",
          providerConfigKey: "junction",
        },
      };
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([provider]),
    store,
  });

  await assert.rejects(
    () => ingress.startConnection({ provider: "oura", ownerId: "<REDACTED_OWNER_ID>" }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "CONNECTION_CREDENTIAL_POLICY_MISMATCH"
      && error.httpStatus === 500,
  );
  assert.equal(store.getConnectionByExternalAccount("oura", "oura-account-1"), null);
});

test("public ingress validates OAuth callback state ownership and required parameters", async () => {
  const alternateProvider = createFakeProvider({
    provider: "alt",
    descriptor: {
      provider: "alt",
      displayName: "Alt",
      transportModes: ["oauth_callback", "scheduled_poll"],
      oauth: {
        callbackPath: "/oauth/alt/callback",
        defaultScopes: ["offline", "read:alt"],
      },
      webhook: undefined,
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
  });
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider(),
      alternateProvider,
    ]),
    store: new InMemoryPublicIngressStore(),
  });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        code: "abc",
        state: "   ",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_STATE_MISSING"
      && error.httpStatus === 400,
  );

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        code: "abc",
        state: "missing-state",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_STATE_INVALID"
      && error.httpStatus === 400,
  );

  const mismatchedState = await ingress.startConnection({ provider: "demo" });
  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "alt",
        code: "abc",
        state: mismatchedState.state,
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_PROVIDER_MISMATCH"
      && error.httpStatus === 400,
  );

  const missingCodeState = await ingress.startConnection({ provider: "demo" });
  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: missingCodeState.state,
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_CODE_MISSING"
      && error.httpStatus === 400,
  );
});

test("public ingress falls back to granted scopes when the provider omits scopes", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async exchangeAuthorizationCode() {
          return {
            externalAccountId: "demo-abc",
            displayName: "Demo abc",
            metadata: {},
            tokens: {
              accessToken: "<REDACTED_ACCESS_TOKEN>",
            } satisfies ProviderAuthTokens,
          };
        },
      }),
    ]),
    store: new InMemoryPublicIngressStore(),
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
    scope: " offline   read:data  ",
  });

  assert.deepEqual(connected.account.scopes, ["offline", "read:data"]);
});

test("public ingress rejects webhook deliveries for providers without webhook handlers", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        descriptor: {
          provider: "demo",
          displayName: "Demo",
          transportModes: ["oauth_callback", "scheduled_poll"],
          oauth: {
            callbackPath: "/oauth/demo/callback",
            defaultScopes: ["offline", "read:data"],
          },
          webhook: undefined,
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: {
              activity: 50,
            },
          },
        },
        verifyAndParseWebhook: undefined,
      }),
    ]),
    store: new InMemoryPublicIngressStore(),
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOKS_NOT_SUPPORTED"
      && error.httpStatus === 404,
  );
});

test("public ingress leaves retryable unknown-account webhook traces retryable without running orphan hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownWebhooks: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const expectedExternalAccountHash = sha256Text("demo-late");
  const expectedClientUserHash = sha256Text("demo-client");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
            externalAccountDiagnostic: {
              selectedPath: "$.user_id",
              selectedExternalAccountIdHash: expectedExternalAccountHash,
              candidates: [
                {
                  kind: "external_account_id",
                  path: "$.user_id",
                  selected: true,
                  valueHash: expectedExternalAccountHash,
                },
                {
                  kind: "client_user_id",
                  path: "$.client_user_id",
                  selected: false,
                  valueHash: expectedClientUserHash,
                },
              ],
            },
            eventType: "demo.updated",
            traceId: "trace-late",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ provider, externalAccountId, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        unknownWebhooks.push(`${provider.provider}:${externalAccountId}:${traceId}`);
      },
    },
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-late", "trace-late");
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.deepEqual(unknownWebhooks, []);
  assert.equal(warnContexts.length, 2);
  assert.equal(warnContexts[0]?.externalAccountIdHash, expectedExternalAccountHash);
  assert.equal(warnContexts[0]?.unknownAccountAction, "retry");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
  assert.deepEqual(warnContexts[0]?.externalAccountDiagnostic, {
    selectedPath: "$.user_id",
    selectedExternalAccountIdHash: expectedExternalAccountHash,
    candidates: [
      {
        kind: "external_account_id",
        path: "$.user_id",
        selected: true,
        valueHash: expectedExternalAccountHash,
      },
      {
        kind: "client_user_id",
        path: "$.client_user_id",
        selected: false,
        valueHash: expectedClientUserHash,
      },
    ],
  });
  assert.equal(JSON.stringify(warnContexts).includes("demo-late"), false);
  assert.equal(JSON.stringify(warnContexts).includes("demo-client"), false);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
});

test("public ingress can complete verified unknown-account webhook traces without provider retries", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownCalls: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-race",
            eventType: "demo.updated",
            traceId: "trace-orphan",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ provider, externalAccountId, traceId }) {
        unknownCalls.push(`${provider.provider}:${externalAccountId}:${traceId}`);
      },
    },
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-race", "trace-orphan");
  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.deepEqual(result, {
    accepted: true,
    duplicate: false,
    orphaned: true,
    provider: "demo",
    eventType: "demo.updated",
    traceId: expectedScopedTraceId,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.orphaned, undefined);
  assert.deepEqual(unknownCalls, [`demo:demo-race:${expectedScopedTraceId}`]);
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
  assert.equal(warnContexts[0]?.externalAccountIdHash, sha256Text("demo-race"));
  assert.equal(JSON.stringify(warnContexts).includes("demo-race"), false);
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);
});

test("public ingress accepts provider-requested unknown-account webhooks without an orphan hook", async () => {
  const store = new InMemoryPublicIngressStore();
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-race",
            eventType: "demo.updated",
            traceId: "trace-orphan",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-race", "trace-orphan");
  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.deepEqual(result, {
    accepted: true,
    duplicate: false,
    orphaned: true,
    provider: "demo",
    eventType: "demo.updated",
    traceId: expectedScopedTraceId,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, false);
  assert.equal(warnContexts[0]?.externalAccountIdHash, sha256Text("demo-race"));
  assert.equal(JSON.stringify(warnContexts).includes("demo-race"), false);
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);
});

test("public ingress retries durable webhook work for unknown accounts even when provider asks to accept orphans", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownCalls: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "durable_webhook_work",
            externalAccountId: "demo-late",
            eventType: "demo.updated",
            traceId: "trace-durable-orphan",
            jobs: [
              {
                kind: "resource",
                payload: {
                  resourceId: "resource-1",
                  webhookDataJson: "{\"sample\":true}",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ traceId }) {
        unknownCalls.push(traceId);
      },
    },
    log: {
      warn(_message, context) {
        warnContexts.push(context ?? {});
      },
    },
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );

  assert.deepEqual(unknownCalls, []);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
  assert.equal(warnContexts[0]?.acceptanceMode, "durable_webhook_work");
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
});

test("public ingress passes only a stripped webhook summary into accepted hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedCalls: Array<{ traceId: string; webhook: DeviceSyncIngressWebhook }> = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-summary",
            occurredAt: "2026-04-11T12:59:00.000Z",
            resourceCategory: "  sleep  ",
            jobs: [
              {
                kind: "resource",
                payload: {
                  resourceId: "resource-1",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        acceptedCalls.push({ traceId, webhook });
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.traceId, scopeWebhookTraceId("demo", "demo-abc", "trace-summary"));
  assert.deepEqual(acceptedCalls, [
    {
      traceId: scopeWebhookTraceId("demo", "demo-abc", "trace-summary"),
      webhook: {
        acceptanceMode: "durable_webhook_work",
        eventType: "demo.updated",
        jobs: [
          {
            kind: "resource",
            payload: {
              resourceId: "resource-1",
            },
          },
        ],
        occurredAt: "2026-04-11T12:59:00.000Z",
        resourceCategory: "sleep",
      },
    },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(acceptedCalls[0]?.webhook ?? {}, "payload"), false);
});

test("public ingress passes the same stripped webhook summary into accepted orphan hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownCalls: Array<{ traceId: string; webhook: DeviceSyncIngressWebhook }> = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
            eventType: "demo.updated",
            traceId: "trace-summary-unknown",
            occurredAt: "2026-04-11T12:59:00.000Z",
            resourceCategory: "  sleep  ",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ traceId, webhook }) {
        unknownCalls.push({ traceId, webhook });
      },
    },
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.orphaned, true);
  assert.deepEqual(unknownCalls, [
    {
      traceId: scopeWebhookTraceId("demo", "demo-late", "trace-summary-unknown"),
      webhook: {
        acceptanceMode: "level_dirty_hint",
        eventType: "demo.updated",
        jobs: [],
        occurredAt: "2026-04-11T12:59:00.000Z",
        resourceCategory: "sleep",
      },
    },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(unknownCalls[0]?.webhook ?? {}, "payload"), false);
});

test("public ingress scopes durable webhook traces by external account while preserving same-account dedupe", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook({ rawBody }) {
          const parsed = JSON.parse(rawBody.toString("utf8")) as {
            externalAccountId: string;
            eventType: string;
            traceId: string;
          };
          return {
            externalAccountId: parsed.externalAccountId,
            eventType: parsed.eventType,
            traceId: parsed.traceId,
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        acceptedWebhooks.push(`${account.id}:${traceId}`);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const firstConnection = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: firstConnection.state,
    code: "a",
  });
  const secondConnection = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: secondConnection.state,
    code: "b",
  });

  const first = await ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from(JSON.stringify({
      externalAccountId: "demo-a",
      eventType: "demo.updated",
      traceId: "provider-event-1",
    })),
  );
  const second = await ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from(JSON.stringify({
      externalAccountId: "demo-b",
      eventType: "demo.updated",
      traceId: "provider-event-1",
    })),
  );
  const duplicate = await ingress.handleWebhook(
    "demo",
    new Headers(),
    Buffer.from(JSON.stringify({
      externalAccountId: "demo-a",
      eventType: "demo.updated",
      traceId: "provider-event-1",
    })),
  );

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.traceId, scopeWebhookTraceId("demo", "demo-a", "provider-event-1"));
  assert.equal(second.traceId, scopeWebhookTraceId("demo", "demo-b", "provider-event-1"));
  assert.equal(duplicate.traceId, first.traceId);
  assert.deepEqual(acceptedWebhooks, [
    `acct_01:${scopeWebhookTraceId("demo", "demo-a", "provider-event-1")}`,
    `acct_02:${scopeWebhookTraceId("demo", "demo-b", "provider-event-1")}`,
  ]);
});

test("public ingress accepts already-satisfied dirty hints before claiming exact trace ids", async () => {
  const store = new InMemoryPublicIngressStore();
  let alreadySatisfiedCalls = 0;
  let acceptedCalls = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "level_dirty_hint",
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-already-dirty",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onLevelDirtyWebhookAlreadySatisfied({ webhook }) {
        alreadySatisfiedCalls += 1;
        assert.equal(webhook.acceptanceMode, "level_dirty_hint");
        return { accepted: true };
      },
      onWebhookAccepted() {
        acceptedCalls += 1;
        throw new Error("already-satisfied webhook should not run accepted hook");
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.traceId, scopeWebhookTraceId("demo", "demo-abc", "trace-already-dirty"));
  assert.equal(alreadySatisfiedCalls, 1);
  assert.equal(acceptedCalls, 0);
  assert.equal(store.claimWebhookTraceCalls, 0);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.getConnectionByExternalAccount("demo", "demo-abc")?.lastWebhookAt, null);
});

test("public ingress does not use already-satisfied coalescing for durable webhook work", async () => {
  const store = new InMemoryPublicIngressStore();
  let alreadySatisfiedCalls = 0;
  let acceptedCalls = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "durable_webhook_work",
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-payload",
            jobs: [
              {
                kind: "resource",
                payload: {
                  webhookDataJson: "{\"sample\":true}",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onLevelDirtyWebhookAlreadySatisfied() {
        alreadySatisfiedCalls += 1;
        return { accepted: true };
      },
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        acceptedCalls += 1;
        assert.equal(webhook.acceptanceMode, "durable_webhook_work");
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(alreadySatisfiedCalls, 0);
  assert.equal(acceptedCalls, 1);
  assert.equal(store.claimWebhookTraceCalls, 1);
  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress marks disconnected-account webhook traces processed so delayed duplicates stay suppressed", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.deleted",
            traceId: "trace-inactive",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        acceptedWebhooks.push(account.id);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });
  store.patchAccountStatus(connected.account.id, "disconnected");

  const first = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-abc", "trace-inactive");
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.traceId, expectedScopedTraceId);
  assert.deepEqual(acceptedWebhooks, []);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.traceId, expectedScopedTraceId);
  assert.deepEqual(acceptedWebhooks, []);
  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress leaves reauthorization-required webhook traces retryable until the account is reconnected", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-reauthorization",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        acceptedWebhooks.push(account.id);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });
  store.patchAccountStatus(connected.account.id, "reauthorization_required");

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );

  assert.deepEqual(acceptedWebhooks, []);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
});

test("public ingress leaves the webhook trace retryable when the durable acceptance hook fails", async () => {
  const store = new InMemoryPublicIngressStore();
  let attempts = 0;
  let successes = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-retryable",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("transient enqueue failure");
        }

        successes += 1;
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await assert.rejects(() => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")), /transient enqueue failure/u);
  assert.equal(attempts, 1);
  assert.equal(successes, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);

  const retry = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, false);
  assert.equal(attempts, 2);
  assert.equal(successes, 1);
  const recordedRetryableTrace = readRecordedWebhookTrace(store);
  assert.ok(recordedRetryableTrace);
  assert.equal(recordedRetryableTrace.traceId, scopeWebhookTraceId("demo", "demo-abc", "trace-retryable"));

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.duplicate, true);
  assert.equal(attempts, 2);
  assert.equal(successes, 1);
});

test("public ingress does not stamp lastWebhookAt when durable acceptance fails", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-no-stamp",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted() {
        throw new Error("transient enqueue failure");
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await assert.rejects(() => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")), /transient enqueue failure/u);
  assert.equal(store.lastRecordedWebhookTrace, null);
  assert.equal(store.getConnectionByExternalAccount("demo", connected.account.externalAccountId)?.lastWebhookAt, null);
});

test("public ingress keeps accepted webhook traces when only receipt timestamp persistence fails", async () => {
  const store = new InMemoryPublicIngressStore();
  const warn = vi.fn();
  store.markWebhookReceived = () => {
    throw new Error("mark failed");
  };

  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-mark-failure",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    log: { warn },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const result = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.deepEqual(result, {
    accepted: true,
    duplicate: false,
    provider: "demo",
    eventType: "demo.updated",
    traceId: scopeWebhookTraceId("demo", "demo-abc", "trace-mark-failure"),
  });
  assert.equal(
    store.lastRecordedWebhookTrace?.traceId,
    scopeWebhookTraceId("demo", "demo-abc", "trace-mark-failure"),
  );
  assert.equal(store.completedWebhookTraceCalls, 1);
  assert.equal(warn.mock.calls.length, 1);
});

test("public ingress omits provider-supplied OAuth error descriptions from warning logs", async () => {
  const store = new InMemoryPublicIngressStore();
  const warn = vi.fn();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
    log: { warn },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        error: "access_denied",
        errorDescription: "<REDACTED_PROVIDER_ERROR_DESCRIPTION>",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError && error.code === "OAUTH_CALLBACK_REJECTED",
  );

  assert.equal(warn.mock.calls.length, 1);
  assert.deepEqual(warn.mock.calls[0]?.[1], {
    provider: "demo",
    callbackError: "access_denied",
  });
});

test("public ingress hashes unknown external account ids before logging them", async () => {
  const store = new InMemoryPublicIngressStore();
  const warn = vi.fn();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-unknown",
            eventType: "demo.updated",
            traceId: "trace-unknown-account",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    log: { warn },
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_ACCOUNT_NOT_READY"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.equal(warn.mock.calls.length, 1);
  assert.deepEqual(warn.mock.calls[0]?.[1], {
    provider: "demo",
    externalAccountIdHash: sha256Text("demo-unknown"),
    eventType: "demo.updated",
    traceId: scopeWebhookTraceId("demo", "demo-unknown", "trace-unknown-account"),
    acceptanceMode: "durable_webhook_work",
    unknownAccountAction: "retry",
    unknownWebhookHookConfigured: false,
  });
});

test("public ingress rejects overlapping active webhook deliveries until the first claim finishes", async () => {
  const store = new InMemoryPublicIngressStore();
  let acceptedCalls = 0;
  let releaseProcessing: (() => void) | null = null;
  const enteredProcessing = new Promise<void>((resolve) => {
    releaseProcessing = resolve;
  });
  let unblockProcessing: (() => void) | null = null;
  const processingGate = new Promise<void>((resolve) => {
    unblockProcessing = resolve;
  });

  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-overlap",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      async onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        acceptedCalls += 1;
        releaseProcessing?.();
        await processingGate;
        assert.equal("traceId" in webhook, false);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const firstWebhook = ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  await enteredProcessing;

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_TRACE_IN_PROGRESS"
      && error.httpStatus === 503
      && error.retryable === true,
  );

  requireCallback(unblockProcessing, "processing gate was not initialized")();
  const firstResult = await firstWebhook;
  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-abc", "trace-overlap");

  assert.equal(firstResult.accepted, true);
  assert.equal(firstResult.duplicate, false);
  assert.equal(firstResult.traceId, expectedScopedTraceId);
  assert.equal(acceptedCalls, 1);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, expectedScopedTraceId);

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.traceId, expectedScopedTraceId);
  assert.equal(acceptedCalls, 1);
});

test("public ingress releases claimed traces when the accepted hook returns without an explicit completion receipt", async () => {
  const store = new InMemoryPublicIngressStore();
  let attempts = 0;
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-missing-receipt",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId }) {
        attempts += 1;
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  Object.defineProperty(ingress, "hooks", {
    configurable: true,
    value: {
      onWebhookAccepted({ account, claimToken, traceId }: DeviceSyncPublicIngressWebhookAcceptedInput) {
        attempts += 1;

        if (attempts > 1) {
          return completeWebhookAcceptDurably(store, account, traceId, claimToken);
        }

        return undefined;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "WEBHOOK_TRACE_COMPLETION_REQUIRED"
      && error.httpStatus === 503
      && error.retryable === true,
  );
  assert.equal(attempts, 1);
  assert.equal(store.lastRecordedWebhookTrace, null);

  const retry = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  const expectedScopedTraceId = scopeWebhookTraceId("demo", "demo-abc", "trace-missing-receipt");

  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, false);
  assert.equal(retry.traceId, expectedScopedTraceId);
  assert.equal(attempts, 2);
  const recordedTrace = readRecordedWebhookTrace(store);
  assert.ok(recordedTrace);
  assert.equal(recordedTrace.traceId, expectedScopedTraceId);
});

test("public ingress preserves callback redirect context on OAuth callback failures", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
  });

  const begin = await ingress.startConnection({
    connectSourceId: "garmin",
    connectTarget: "garmin",
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        error: "access_denied",
        errorDescription: "The user canceled the OAuth flow.",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OAUTH_CALLBACK_REJECTED" &&
      error.message === "OAuth authorization was denied or canceled." &&
      error.details?.connectSourceId === "garmin" &&
      error.details?.connectTarget === "garmin" &&
      error.details?.provider === "demo" &&
      error.details?.returnTo === "https://app.example.test/settings/devices",
  );
});

test("public ingress passes connect source context to connection-established hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const connectionEvents: DeviceSyncPublicIngressConnectionEstablishedInput[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
    hooks: {
      onConnectionEstablished(event) {
        connectionEvents.push(event);
      },
    },
  });

  const begin = await ingress.startConnection({
    connectSourceId: "garmin",
    connectTarget: "garmin",
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });

  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connectionEvents.length, 1);
  assert.equal(connectionEvents[0]?.account.id, connected.account.id);
  assert.equal(connectionEvents[0]?.connectSourceId, "garmin");
  assert.equal(connectionEvents[0]?.connectTarget, "garmin");
});

test("public ingress best-effort revokes pending provider access when OAuth persistence fails", async () => {
  const persistError = new Error("persist failed before connection storage");
  const revokeCalls: Array<{ accessToken: string; externalAccountId: string }> = [];
  const warnEvents: Array<{ context?: Record<string, unknown>; message: string }> = [];

  class FailingUpsertStore extends InMemoryPublicIngressStore {
    override upsertConnection(_input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount {
      throw persistError;
    }
  }

  const store = new FailingUpsertStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          const tokens = getDeviceSyncAccountOAuthTokens(account);
          assert.ok(tokens);
          revokeCalls.push({
            accessToken: tokens.accessToken,
            externalAccountId: account.externalAccountId,
          });
          throw new Error("cleanup revoke failed");
        },
      }),
    ]),
    store,
    log: {
      warn(message, context) {
        warnEvents.push({
          context: context as Record<string, unknown> | undefined,
          message,
        });
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "abc",
      }),
    (error: unknown) => error === persistError,
  );

  assert.deepEqual(revokeCalls, [
    {
      accessToken: "<REDACTED_ACCESS_TOKEN>",
      externalAccountId: "demo-abc",
    },
  ]);
  assert.equal(warnEvents.length, 1);
  assert.equal(warnEvents[0]?.message, "Failed to revoke provider access after OAuth callback setup failed.");
  assert.deepEqual(warnEvents[0]?.context?.error, {
    message: "cleanup revoke failed",
    name: "Error",
  });
  assert.equal(warnEvents[0]?.context?.provider, "demo");
  assert.equal(store.hasOAuthState(begin.state), false);
  assert.equal(store.getConnectionByExternalAccount("demo", "demo-abc"), null);
});

test("public ingress revokes and marks setup failure after post-persistence OAuth hook failures", async () => {
  const store = new InMemoryPublicIngressStore();
  const revokeCalls: string[] = [];
  const hookError = new Error("post-persist hook failure");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          revokeCalls.push(account.externalAccountId);
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        throw hookError;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "persisted",
      }),
    (error: unknown) => error === hookError,
  );

  assert.deepEqual(revokeCalls, ["demo-persisted"]);
  assert.equal(store.hasOAuthState(begin.state), false);
  const storedAccount = store.getConnectionByExternalAccount("demo", "demo-persisted");
  assert.ok(storedAccount);
  assert.equal(storedAccount.id, "acct_01");
  assert.equal(storedAccount.status, "reauthorization_required");
  assert.equal(storedAccount.accessTokenExpiresAt, null);
  assert.equal(storedAccount.lastErrorCode, "OAUTH_SETUP_FAILED");
  assert.equal(storedAccount.lastErrorMessage, "post-persist hook failure");
  assert.ok(storedAccount.lastSyncErrorAt);
  assert.equal(storedAccount.nextReconcileAt, null);
});

test("public ingress surfaces persisted OAuth cleanup failures after post-persistence hook failures", async () => {
  const store = new InMemoryPublicIngressStore();
  const revokeCalls: string[] = [];
  const hookError = new Error("post-persist hook failure");
  store.markConnectionSetupFailedError = new Error("setup failure mark failed");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async revokeAccess(account) {
          revokeCalls.push(account.externalAccountId);
        },
      }),
    ]),
    store,
    hooks: {
      onConnectionEstablished() {
        throw hookError;
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "persisted",
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "OAUTH_SETUP_CLEANUP_FAILED");
      assert.equal(
        error.message,
        "OAuth connection setup failed after persistence, and stored-token cleanup did not complete.",
      );
      assert.deepEqual(error.details, {
        accountId: "acct_01",
        setupFailureCode: "OAUTH_SETUP_FAILED",
        provider: "demo",
        returnTo: null,
      });
      return true;
    },
  );

  assert.deepEqual(revokeCalls, ["demo-persisted"]);
  assert.equal(store.hasOAuthState(begin.state), false);
});

test("public ingress does not burn valid oauth state on provider mismatch", async () => {
  const store = new InMemoryPublicIngressStore();
  const whoopBase = createFakeProvider();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([
      createFakeProvider(),
      createFakeProvider({
        provider: "whoop",
        descriptor: {
          ...whoopBase.descriptor,
          displayName: "Whoop",
          oauth: {
            ...whoopBase.descriptor.oauth,
            callbackPath: "/oauth/whoop/callback",
            defaultScopes: ["offline", "read:data"],
          },
          provider: "whoop",
        },
      }),
    ]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "whoop",
        state: begin.state,
        code: "wrong-provider",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OAUTH_PROVIDER_MISMATCH" &&
      error.httpStatus === 400,
  );
  assert.equal(store.hasOAuthState(begin.state), true);

  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.provider, "demo");
  assert.equal(store.hasOAuthState(begin.state), false);
});

test("public ingress does not burn valid oauth state on owner mismatch", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
  });

  const begin = await ingress.startConnection({
    ownerId: "member_a",
    provider: "demo",
    returnTo: "https://app.example.test/settings/devices",
  });

  await assert.rejects(
    () =>
      ingress.handleConnectionCallback({
        expectedOwnerId: "member_b",
        provider: "demo",
        state: begin.state,
        code: "abc",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OAUTH_STATE_OWNER_MISMATCH" &&
      error.httpStatus === 403,
  );
  assert.equal(store.hasOAuthState(begin.state), true);

  const connected = await ingress.handleConnectionCallback({
    expectedOwnerId: "member_a",
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.provider, "demo");
  assert.equal(store.hasOAuthState(begin.state), false);
});

test("public ingress discards tampered persisted returnTo values before reuse", async () => {
  const store = new InMemoryPublicIngressStore();
  store.createOAuthState({
    state: "tampered-state",
    provider: "demo",
    returnTo: "javascript:alert(1)",
    metadata: {},
    createdAt: "2099-05-24T00:00:00.000Z",
    expiresAt: "2099-05-24T01:00:00.000Z",
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
  });

  try {
    const connected = await ingress.handleOAuthCallback({
      provider: "demo",
      state: "tampered-state",
      code: "abc",
    });

    assert.equal(connected.returnTo, null);
    assert.equal(warnSpy.mock.calls.length, 1);
  } finally {
    warnSpy.mockRestore();
  }
});

test("public ingress preserves non-device-sync callback errors without wrapping them", async () => {
  const expected = new Error("unexpected oauth exchange failure");
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async exchangeAuthorizationCode() {
          throw expected;
        },
      }),
    ]),
    store: new InMemoryPublicIngressStore(),
  });

  const begin = await ingress.startConnection({ provider: "demo" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "demo",
        state: begin.state,
        code: "abc",
      }),
    (error: unknown) => error === expected,
  );
});

test("public ingress rejects unknown providers before creating OAuth state", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store: new InMemoryPublicIngressStore(),
  });

  await assert.rejects(
    () => ingress.startConnection({ provider: "missing-provider" }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "PROVIDER_NOT_REGISTERED" &&
      error.httpStatus === 404,
  );
});

test("public ingress releases unknown-account webhook traces when the unknown hook fails", async () => {
  const store = new InMemoryPublicIngressStore();
  let unknownAttempts = 0;
  const warnMessages: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
            eventType: "demo.updated",
            traceId: "trace-release-on-error",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-04-10T00:00:00.000Z",
                  windowEnd: "2026-04-11T00:00:00.000Z",
                },
              },
            ],
            unknownAccountAction: "accept",
          };
        },
      }),
    ]),
    store,
    hooks: {
      async onUnknownWebhook() {
        unknownAttempts += 1;
        throw new Error("transient unknown-account hook failure");
      },
    },
    log: {
      warn(message, context) {
        warnMessages.push(message);
        warnContexts.push(context ?? {});
      },
    },
  });

  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    /transient unknown-account hook failure/u,
  );
  await assert.rejects(
    () => ingress.handleWebhook("demo", new Headers(), Buffer.from("{}")),
    /transient unknown-account hook failure/u,
  );

  assert.equal(unknownAttempts, 2);
  assert.equal(
    warnMessages.filter((message) =>
      message === "Failed to run unknown device sync webhook hook; releasing orphan trace for retry."
    ).length,
    2,
  );
  assert.equal(warnContexts[0]?.unknownAccountAction, "accept");
  assert.equal(warnContexts[0]?.unknownWebhookHookConfigured, true);
  assert.equal(warnContexts[0]?.externalAccountIdHash, sha256Text("demo-late"));
  assert.equal(JSON.stringify(warnContexts).includes("demo-late"), false);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
});

test("public ingress rejects protocol-relative, backslash-prefixed, and credential-bearing returnTo values", async () => {
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store: new InMemoryPublicIngressStore(),
  });

  for (const returnTo of [
    "//evil.test/steal",
    "/\\evil.test",
    "/settings\nsteal",
    "https://operator:secret@app.example.test/settings/devices",
  ]) {
    await assert.rejects(
      () =>
        ingress.startConnection({
          provider: "demo",
          returnTo,
        }),
      (error: unknown) =>
        error instanceof DeviceSyncError &&
        error.code === "RETURN_TO_INVALID" &&
        error.httpStatus === 400,
    );
  }
});

test("public ingress stores webhook receipt timestamps using ingestion time, not provider event time", async () => {
  const store = new InMemoryPublicIngressStore();
  const observedAcceptedAt: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-abc",
            eventType: "demo.updated",
            traceId: "trace-received-at",
            occurredAt: "2026-03-01T00:00:00.000Z",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook, now }) {
        assert.equal("traceId" in webhook, false);
        observedAcceptedAt.push(now);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(observedAcceptedAt.length, 1);
  assert.equal(store.lastRecordedWebhookTrace?.receivedAt, observedAcceptedAt[0]);
  assert.equal(store.getConnectionByExternalAccount("demo", "demo-abc")?.lastWebhookAt, observedAcceptedAt[0]);
  assert.notEqual(store.lastRecordedWebhookTrace?.receivedAt, "2026-03-01T00:00:00.000Z");
  assert.notEqual(
    store.getConnectionByExternalAccount("demo", connected.account.externalAccountId)?.lastWebhookAt,
    "2026-03-01T00:00:00.000Z",
  );
});

test("public ingress does not complete a claimed webhook trace twice when the durable hook already owns completion", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
    hooks: {
      onWebhookAccepted({ account, claimToken, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        return completeWebhookAcceptDurably(store, account, traceId, claimToken);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(store.completedWebhookTraceCalls, 1);
});

test("public ingress rejects built-in OAuth callback jobs that drift from the provider manifest", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        provider: "strava",
        descriptor: {
          provider: "strava",
          displayName: "Strava",
          transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
          oauth: {
            callbackPath: "/oauth/strava/callback",
            defaultScopes: ["activity:read"],
          },
          webhook: {
            path: "/webhooks/strava",
            deliveryMode: "notification",
            supportsAdmin: false,
          },
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: {
              activity: 50,
            },
          },
        },
        async exchangeAuthorizationCode(_context, code) {
          return {
            externalAccountId: `strava-${code}`,
            displayName: `Strava ${code}`,
            scopes: ["activity:read"],
            metadata: {},
            tokens: {
              accessToken: "<REDACTED_ACCESS_TOKEN>",
              refreshToken: "<REDACTED_REFRESH_TOKEN>",
            },
            initialJobs: [
              {
                kind: "backfill",
                payload: {
                  unexpected: true,
                },
              },
            ],
            nextReconcileAt: "2026-03-24T00:00:00.000Z",
          };
        },
      }),
    ]),
    store,
  });

  const begin = await ingress.startConnection({ provider: "strava" });

  await assert.rejects(
    () =>
      ingress.handleOAuthCallback({
        provider: "strava",
        state: begin.state,
        code: "abc",
      }),
    /not declared in the provider manifest/u,
  );

  assert.equal(store.getConnectionByExternalAccount("strava", "strava-abc"), null);
});

test("public ingress rejects built-in webhook jobs that drift from the provider manifest before durable trace claim", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        provider: "whoop",
        descriptor: {
          provider: "whoop",
          displayName: "WHOOP",
          transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
          oauth: {
            callbackPath: "/oauth/whoop/callback",
            defaultScopes: ["offline"],
          },
          webhook: {
            path: "/webhooks/whoop",
            deliveryMode: "notification",
            supportsAdmin: false,
          },
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: {
              activity: 50,
            },
          },
        },
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "whoop-abc",
            eventType: "sleep.updated",
            traceId: "trace-1",
            jobs: [
              {
                kind: "resource",
                payload: {
                  resourceId: 123,
                  resourceType: "sleep",
                },
              },
            ],
          };
        },
      }),
    ]),
    store,
  });

  await assert.rejects(
    () => ingress.handleWebhook("whoop", new Headers(), Buffer.from("{}")),
    /resourceId must be a string/u,
  );

  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(readRecordedWebhookTrace(store), null);
});
