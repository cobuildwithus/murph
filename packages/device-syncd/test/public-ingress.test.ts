import assert from "node:assert/strict";
import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.js";
import { createDeviceSyncPublicIngress } from "../src/public-ingress.js";
import { createDeviceSyncRegistry } from "../src/registry.js";

import type {
  DeviceSyncProvider,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceRecord,
  OAuthStateRecord,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "../src/types.js";

class InMemoryPublicIngressStore implements DeviceSyncPublicIngressStore {
  private readonly oauthStates = new Map<string, OAuthStateRecord>();
  private readonly accounts = new Map<string, PublicDeviceSyncAccount>();
  private readonly accountsByProviderExternal = new Map<string, string>();
  private readonly webhookTraces = new Set<string>();
  lastRecordedWebhookTrace: DeviceSyncWebhookTraceRecord | null = null;
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

  recordWebhookTraceIfNew(input: DeviceSyncWebhookTraceRecord): boolean {
    const key = `${input.provider}:${input.traceId}`;

    if (this.webhookTraces.has(key)) {
      return false;
    }

    this.webhookTraces.add(key);
    this.lastRecordedWebhookTrace = input;
    return true;
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
    publicBaseUrl: "https://sync.healthybob.test/device-sync",
    allowedReturnOrigins: ["https://app.healthybob.test"],
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
    returnTo: "https://app.healthybob.test/settings/devices",
  });
  assert.match(begin.authorizationUrl, /^https:\/\/example\.test\/oauth\?state=/u);
  assert.match(begin.authorizationUrl, /redirect_uri=https%3A%2F%2Fsync\.healthybob\.test%2Fdevice-sync%2Foauth%2Fdemo%2Fcallback/u);

  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.externalAccountId, "demo-abc");
  assert.equal(connected.account.provider, "demo");
  assert.equal(connected.returnTo, "https://app.healthybob.test/settings/devices");
  assert.deepEqual(connectionEvents, [
    {
      accountId: connected.account.id,
      initialJobs: 1,
    },
  ]);
});

test("public ingress deduplicates webhook traces and suppresses side effects for inactive accounts", async () => {
  const store = new InMemoryPublicIngressStore();
  const acceptedWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.healthybob.test/device-sync",
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
    hooks: {
      onWebhookAccepted({ account, webhook }) {
        acceptedWebhooks.push(`${account.id}:${webhook.eventType}`);
      },
    },
  });

  const begin = await ingress.startConnection({ provider: "demo" });
  const connected = await ingress.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const first = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.deepEqual(acceptedWebhooks, [`${connected.account.id}:demo.updated`]);

  const duplicate = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(acceptedWebhooks, [`${connected.account.id}:demo.updated`]);

  store.patchAccountStatus(connected.account.id, "disconnected");
  const inactiveProvider = createFakeProvider({
    async verifyAndParseWebhook() {
      return {
        externalAccountId: "demo-abc",
        eventType: "demo.deleted",
        traceId: "trace-2",
        jobs: [],
      };
    },
  });
  const inactiveIngress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.healthybob.test/device-sync",
    registry: createDeviceSyncRegistry([inactiveProvider]),
    store,
    hooks: {
      onWebhookAccepted() {
        acceptedWebhooks.push("should-not-run");
      },
    },
  });

  const inactive = await inactiveIngress.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(inactive.accepted, true);
  assert.equal(inactive.duplicate, false);
  assert.deepEqual(acceptedWebhooks, [`${connected.account.id}:demo.updated`]);
});

test("public ingress accepts unknown-account webhooks and reports them through the hook", async () => {
  const store = new InMemoryPublicIngressStore();
  const unknownWebhooks: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.healthybob.test/device-sync",
    registry: createDeviceSyncRegistry([
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            externalAccountId: "demo-missing",
            eventType: "demo.created",
            traceId: "trace-missing",
            jobs: [],
          };
        },
      }),
    ]),
    store,
    hooks: {
      onUnknownWebhook({ provider, externalAccountId, webhook }) {
        unknownWebhooks.push(`${provider.provider}:${externalAccountId}:${webhook.eventType}`);
      },
    },
  });

  const webhook = await ingress.handleWebhook("demo", new Headers(), Buffer.from("{}"));

  assert.equal(webhook.accepted, true);
  assert.equal(webhook.duplicate, false);
  assert.deepEqual(unknownWebhooks, ["demo:demo-missing:demo.created"]);
});

test("public ingress preserves callback redirect context on OAuth callback failures", async () => {
  const store = new InMemoryPublicIngressStore();
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.healthybob.test/device-sync",
    allowedReturnOrigins: ["https://app.healthybob.test"],
    registry: createDeviceSyncRegistry([createFakeProvider()]),
    store,
  });

  const begin = await ingress.startConnection({
    provider: "demo",
    returnTo: "https://app.healthybob.test/settings/devices",
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
      error.details?.provider === "demo" &&
      error.details?.returnTo === "https://app.healthybob.test/settings/devices",
  );
});

test("public ingress stores webhook receipt timestamps using ingestion time, not provider event time", async () => {
  const store = new InMemoryPublicIngressStore();
  const observedAcceptedAt: string[] = [];
  const ingress = createDeviceSyncPublicIngress({
    publicBaseUrl: "https://sync.healthybob.test/device-sync",
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
      onWebhookAccepted({ now }) {
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
