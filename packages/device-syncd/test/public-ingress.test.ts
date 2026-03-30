import assert from "node:assert/strict";
import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
import { createDeviceSyncPublicIngress } from "../src/public-ingress.ts";
import { createDeviceSyncRegistry } from "../src/registry.ts";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncProvider,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceRecord,
  OAuthStateRecord,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "../src/types.ts";

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
          payload: input.payload,
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
        payload: input.payload,
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
): void {
  store.completeWebhookTrace(account.provider, traceId);
}

function createFakeProvider(overrides: Partial<DeviceSyncProvider> = {}): DeviceSyncProvider {
  const baseProvider: DeviceSyncProvider = {
    provider: "demo",
    callbackPath: "/oauth/demo/callback",
    webhookPath: "/webhooks/demo",
    defaultScopes: ["offline", "read:data"],
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
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.example.test/device-sync",
    allowedReturnOrigins: ["https://app.example.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
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
});

test("public ingress processes an unknown-account retry exactly once after the account exists", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
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
      onWebhookAccepted({ account, webhook }) {
        completeWebhookAcceptDurably(store, account, webhook.traceId);
        acceptedWebhooks.push(`${account.id}:${webhook.eventType}`);
      },
      onUnknownWebhook({ provider, externalAccountId, webhook }) {
        unknownWebhooks.push(`${provider.provider}:${externalAccountId}:${webhook.traceId}`);
      },
    },
  });

  const first = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.deepEqual(acceptedWebhooks, []);
  assert.deepEqual(unknownWebhooks, ["demo:demo-late:trace-late"]);
  assert.equal(store.lastRecordedWebhookTrace, null);

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "late",
  });

  const retry = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, false);
  assert.deepEqual(acceptedWebhooks, [`${connected.account.id}:demo.updated`]);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, "trace-late");

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(acceptedWebhooks, [`${connected.account.id}:demo.updated`]);
});

test("public ingress processes an inactive-account retry exactly once after reactivation", async () => {
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
      onWebhookAccepted({ account, webhook }) {
        completeWebhookAcceptDurably(store, account, webhook.traceId);
        acceptedWebhooks.push(`${account.id}:${webhook.traceId}`);
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
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.deepEqual(acceptedWebhooks, []);
  assert.equal(store.lastRecordedWebhookTrace, null);

  store.patchAccountStatus(connected.account.id, "active");

  const retry = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, false);
  assert.deepEqual(acceptedWebhooks, [`${connected.account.id}:trace-inactive`]);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, "trace-inactive");

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(acceptedWebhooks, [`${connected.account.id}:trace-inactive`]);
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
      onWebhookAccepted({ account, webhook }) {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("transient enqueue failure");
        }

        completeWebhookAcceptDurably(store, account, webhook.traceId);
        successes += 1;
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
  assert.equal(store.lastRecordedWebhookTrace?.traceId, "trace-retryable");

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.duplicate, true);
  assert.equal(attempts, 2);
  assert.equal(successes, 1);
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
      async onWebhookAccepted({ account, webhook }) {
        acceptedCalls += 1;
        releaseProcessing?.();
        await processingGate;
        completeWebhookAcceptDurably(store, account, webhook.traceId);
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

  unblockProcessing?.();
  const firstResult = await firstWebhook;

  assert.equal(firstResult.accepted, true);
  assert.equal(firstResult.duplicate, false);
  assert.equal(acceptedCalls, 1);
  assert.equal(store.lastRecordedWebhookTrace?.traceId, "trace-overlap");

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(acceptedCalls, 1);
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
      onWebhookAccepted({ account, webhook, now }) {
        completeWebhookAcceptDurably(store, account, webhook.traceId);
        observedAcceptedAt.push(now);
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
      onWebhookAccepted({ account, webhook }) {
        completeWebhookAcceptDurably(store, account, webhook.traceId);
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
