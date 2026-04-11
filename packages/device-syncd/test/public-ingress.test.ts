import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
import { createDeviceSyncPublicIngress } from "../src/public-ingress.ts";
import { createDeviceSyncRegistry } from "../src/registry.ts";
import { scopeWebhookTraceId, sha256Text } from "../src/shared.ts";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncProvider,
  DeviceSyncPublicIngressStore,
  DeviceSyncPublicIngressWebhookAcceptedInput,
  DeviceSyncPublicIngressWebhookAcceptedResult,
  DeviceSyncWebhookTraceRecord,
  OAuthStateRecord,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "../src/types.ts";
import { DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED } from "../src/types.ts";

class InMemoryPublicIngressStore implements DeviceSyncPublicIngressStore {
  private readonly oauthStates = new Map<string, OAuthStateRecord>();
  private readonly accounts = new Map<string, PublicDeviceSyncAccount>();
  private readonly accountsByProviderExternal = new Map<string, string>();
  private readonly webhookTraces = new Map<
    string,
    {
      expiresAt: string | null;
      record: DeviceSyncWebhookTraceRecord;
      status: DeviceSyncWebhookTraceClaimResult | "stored";
    }
  >();
  lastRecordedWebhookTrace: DeviceSyncWebhookTraceRecord | null = null;
  completedWebhookTraceCalls = 0;
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

  consumeOAuthState(state: string, now: string): OAuthStateRecord | null {
    const record = this.oauthStates.get(state) ?? null;
    this.oauthStates.delete(state);

    if (!record || Date.parse(record.expiresAt) <= Date.parse(now)) {
      return null;
    }

    return record;
  }

  upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): PublicDeviceSyncAccount {
    const key = `${input.provider}:${input.externalAccountId}`;
    const existingId = this.accountsByProviderExternal.get(key) ?? null;
    const existing = existingId ? this.accounts.get(existingId) ?? null : null;
    const now = input.connectedAt;
    const id = existing?.id ?? `acct_${String(++this.accountCounter).padStart(2, "0")}`;
    const record: PublicDeviceSyncAccount = {
      id,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      displayName: input.displayName ?? null,
      status: input.status ?? "active",
      scopes: [...(input.scopes ?? [])],
      accessTokenExpiresAt: input.tokens.accessTokenExpiresAt ?? null,
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

  getConnectionByExternalAccount(provider: string, externalAccountId: string): PublicDeviceSyncAccount | null {
    const id = this.accountsByProviderExternal.get(`${provider}:${externalAccountId}`) ?? null;
    return id ? (this.accounts.get(id) ?? null) : null;
  }

  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult {
    const key = `${input.provider}:${input.traceId}`;
    const existing = this.webhookTraces.get(key);

    if (!existing) {
      this.webhookTraces.set(key, {
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

  completeWebhookTrace(provider: string, traceId: string): void {
    this.completedWebhookTraceCalls += 1;
    const key = `${provider}:${traceId}`;
    const existing = this.webhookTraces.get(key);

    if (!existing || existing.status !== "processing") {
      return;
    }

    this.lastRecordedWebhookTrace = existing.record;
    this.webhookTraces.set(key, {
      expiresAt: null,
      record: existing.record,
      status: "stored",
    });
  }

  releaseWebhookTrace(provider: string, traceId: string): void {
    const key = `${provider}:${traceId}`;
    const existing = this.webhookTraces.get(key);

    if (!existing || existing.status !== "processing") {
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

function completeWebhookAcceptDurably(
  store: InMemoryPublicIngressStore,
  account: PublicDeviceSyncAccount,
  traceId: string,
): DeviceSyncPublicIngressWebhookAcceptedResult {
  store.completeWebhookTrace(account.provider, traceId);
  return DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED;
}

function requireCallback(callback: (() => void) | null, message: string): () => void {
  assert.ok(callback, message);
  return callback;
}

function readRecordedWebhookTrace(store: InMemoryPublicIngressStore): DeviceSyncWebhookTraceRecord | null {
  return store.lastRecordedWebhookTrace;
}

function createFakeProvider(overrides: Partial<DeviceSyncProvider> = {}): DeviceSyncProvider {
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
    buildConnectUrl(context) {
      return `https://example.test/oauth?state=${context.state}&redirect_uri=${encodeURIComponent(context.callbackUrl)}`;
    },
    async exchangeAuthorizationCode(_context, code) {
      return {
        externalAccountId: `demo-${code}`,
        displayName: `Demo ${code}`,
        scopes: ["offline", "read:data"],
        metadata: {
          connectedBy: code,
        },
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
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
    async refreshTokens() {
      return {
        accessToken: "access-token-2",
      };
    },
    async verifyAndParseWebhook() {
      return {
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
      };
    },
    async executeJob() {
      return {};
    },
  };

  return {
    ...baseProvider,
    ...overrides,
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
              accessToken: "access-token",
              refreshToken: "refresh-token",
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

test("public ingress describes providers and rejects providers without OAuth callbacks", () => {
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
        callbackPath: "/oauth/demo/callback",
        callbackUrl: "https://sync.example.test/device-sync/oauth/demo/callback",
        webhookPath: "/webhooks/demo",
        webhookUrl: "https://sync.example.test/device-sync/webhooks/demo",
        supportsWebhooks: true,
        defaultScopes: ["offline", "read:data"],
      },
    ],
  );
  assert.throws(
    () => descriptorOnlyIngress.describeProvider(descriptorOnlyProvider),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "OAUTH_NOT_SUPPORTED"
      && error.httpStatus === 500,
  );
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
              accessToken: "access-token",
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

test("public ingress leaves unknown-account webhook traces retryable and reruns unknown hooks", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
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
  assert.deepEqual(unknownWebhooks, [
    `demo:demo-late:${expectedScopedTraceId}`,
    `demo:demo-late:${expectedScopedTraceId}`,
  ]);
  assert.equal(store.completedWebhookTraceCalls, 0);
  assert.equal(store.lastRecordedWebhookTrace, null);
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
      onWebhookAccepted({ account, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        acceptedWebhooks.push(`${account.id}:${traceId}`);
        return completeWebhookAcceptDurably(store, account, traceId);
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
      onWebhookAccepted({ account, traceId }) {
        acceptedWebhooks.push(account.id);
        return completeWebhookAcceptDurably(store, account, traceId);
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
      onWebhookAccepted({ account, traceId }) {
        acceptedWebhooks.push(account.id);
        return completeWebhookAcceptDurably(store, account, traceId);
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
      onWebhookAccepted({ account, traceId }) {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("transient enqueue failure");
        }

        successes += 1;
        return completeWebhookAcceptDurably(store, account, traceId);
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
        errorDescription: "Bearer very-secret-token",
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
      async onWebhookAccepted({ account, traceId, webhook }) {
        acceptedCalls += 1;
        releaseProcessing?.();
        await processingGate;
        assert.equal("traceId" in webhook, false);
        return completeWebhookAcceptDurably(store, account, traceId);
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
      onWebhookAccepted({ account, traceId }) {
        attempts += 1;
        return completeWebhookAcceptDurably(store, account, traceId);
      },
    },
  });

  Object.defineProperty(ingress, "hooks", {
    configurable: true,
    value: {
      onWebhookAccepted({ account, traceId }: DeviceSyncPublicIngressWebhookAcceptedInput) {
        attempts += 1;

        if (attempts > 1) {
          return completeWebhookAcceptDurably(store, account, traceId);
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
      error.details?.provider === "demo" &&
      error.details?.returnTo === "https://app.example.test/settings/devices",
  );
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
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-late",
            eventType: "demo.updated",
            traceId: "trace-release-on-error",
            jobs: [],
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
      onWebhookAccepted({ account, traceId, webhook, now }) {
        assert.equal("traceId" in webhook, false);
        observedAcceptedAt.push(now);
        return completeWebhookAcceptDurably(store, account, traceId);
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
      onWebhookAccepted({ account, traceId, webhook }) {
        assert.equal("traceId" in webhook, false);
        return completeWebhookAcceptDurably(store, account, traceId);
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
