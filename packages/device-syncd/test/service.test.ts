import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.ts";
import { createDeviceSyncService } from "../src/service.ts";
import { SqliteDeviceSyncStore } from "../src/store.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncImporterPort,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
  ProviderAuthTokens,
} from "../src/types.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function readUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function createWhoopWebhookHeaders(clientSecret: string, rawBody: Buffer, timestamp = Date.now().toString()): Headers {
  const signature = createHmac("sha256", clientSecret).update(Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody])).digest(
    "base64",
  );

  return new Headers({
    "x-whoop-signature": signature,
    "x-whoop-signature-timestamp": timestamp,
  });
}

function createFakeProvider(overrides: Partial<DeviceSyncProvider> = {}): DeviceSyncProvider {
  const baseProvider: DeviceSyncProvider = {
    provider: "demo",
    callbackPath: "/oauth/demo/callback",
    webhookPath: "/webhooks/demo",
    defaultScopes: ["offline", "read:data"],
    buildConnectUrl(context) {
      return `https://example.test/oauth?state=${context.state}`;
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
        },
        initialJobs: [
          {
            kind: "backfill",
            payload: {
              value: 1,
            },
          },
        ],
        nextReconcileAt: "2026-03-17T12:00:00.000Z",
      };
    },
    async refreshTokens(_account: DeviceSyncAccount): Promise<ProviderAuthTokens> {
      return {
        accessToken: "access-token-2",
        refreshToken: "refresh-token-2",
      };
    },
    createScheduledJobs(account, _now) {
      return {
        jobs: [
          {
            kind: "reconcile",
            dedupeKey: `reconcile:${account.id}`,
            payload: {
              mode: "scheduled",
            },
          },
        ],
        nextReconcileAt: "2026-03-18T00:00:00.000Z",
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
    async executeJob(context, job: DeviceSyncJobRecord) {
      await context.importSnapshot({
        accountId: context.account.externalAccountId,
        importedAt: context.now,
        resources: [
          {
            kind: job.kind,
            payload: job.payload,
          },
        ],
      });
      return {};
    },
  };

  return {
    ...baseProvider,
    ...overrides,
  };
}

test("device sync service connects, imports, and deduplicates webhook traces", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd");
  const imports: unknown[] = [];
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input);
      return {
        ok: true,
      };
    },
  };
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [createFakeProvider()],
    importer,
  });

  const begin = await service.startConnection({
    provider: "demo",
    returnTo: "/settings/devices",
  });
  assert.match(begin.authorizationUrl, /^https:\/\/example\.test\/oauth\?state=/);

  const connected = await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });
  assert.equal(connected.account.externalAccountId, "demo-abc");
  assert.equal(service.listAccounts().length, 1);

  await service.runWorkerOnce();
  assert.equal(imports.length, 1);

  const firstWebhook = await service.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(firstWebhook.accepted, true);
  assert.equal(firstWebhook.duplicate, false);
  assert.equal(
    (
      service.store.database
        .prepare("select status from webhook_trace where provider = ? and trace_id = ?")
        .get("demo", "trace-1") as { status?: string } | undefined
    )?.status,
    "processed",
  );

  const duplicateWebhook = await service.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicateWebhook.duplicate, true);

  await service.runWorkerOnce();
  assert.equal(imports.length, 2);

  const reconcile = service.queueManualReconcile(connected.account.id);
  assert.equal(reconcile.account.id, connected.account.id);
  assert.equal(reconcile.jobs.length, 1);

  service.close();
});

test("device sync service redacts connection metadata from public account responses while retaining internal provider state", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-public-redaction");
  let seenMetadata: Record<string, unknown> | null = null;
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          seenMetadata = { ...context.account.metadata };
          return {};
        },
      }),
    ],
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  const connected = await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "sensitive-connect-code",
  });

  assert.deepEqual(connected.account.metadata, {});
  assert.equal(Object.prototype.hasOwnProperty.call(connected.account, "hostedObservedTokenVersion"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(connected.account, "hostedObservedUpdatedAt"), false);
  assert.deepEqual(service.getAccount(connected.account.id)?.metadata, {});
  assert.deepEqual(service.listAccounts()[0]?.metadata, {});
  assert.deepEqual(service.store.getAccountById(connected.account.id)?.metadata, {
    connectedBy: "sensitive-connect-code",
  });

  await service.runWorkerOnce();
  assert.deepEqual(seenMetadata, {
    connectedBy: "sensitive-connect-code",
  });

  service.close();
});

test("device sync service durably suppresses WHOOP webhook replays without trace_id even when retry deliveries have a new signature timestamp", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-whoop-replay");
  const imports: unknown[] = [];
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input);
      return {
        ok: true,
      };
    },
  };
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "offline read:profile",
        });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/user/profile/basic") {
        return createJsonResponse({
          user_id: "whoop-user-1",
          first_name: "Whoop",
          last_name: "User",
        });
      }

      if (
        url.startsWith("https://api.prod.whoop.com/developer/v2/activity/sleep?") ||
        url.startsWith("https://api.prod.whoop.com/developer/v2/recovery?") ||
        url.startsWith("https://api.prod.whoop.com/developer/v2/cycle?") ||
        url.startsWith("https://api.prod.whoop.com/developer/v2/activity/workout?")
      ) {
        return createJsonResponse({
          records: [],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [provider],
    importer,
  });

  const begin = await service.startConnection({
    provider: "whoop",
  });
  const connected = await service.handleOAuthCallback({
    provider: "whoop",
    state: begin.state,
    code: "abc",
  });

  assert.equal(connected.account.externalAccountId, "whoop-user-1");

  await service.runWorkerOnce();
  assert.equal(imports.length, 1);

  const rawBody = Buffer.from(
    JSON.stringify({
      user_id: "whoop-user-1",
      type: "sleep.deleted",
      id: "sleep-1",
    }),
    "utf8",
  );
  const firstTimestamp = String(Date.now());
  const retryTimestamp = String(Number(firstTimestamp) + 120_000);
  const headers = createWhoopWebhookHeaders("whoop-client-secret", rawBody, firstTimestamp);

  const firstWebhook = await service.handleWebhook("whoop", headers, rawBody);
  assert.equal(firstWebhook.accepted, true);
  assert.equal(firstWebhook.duplicate, false);
  assert.match(firstWebhook.traceId ?? "", /^[a-f0-9]{64}$/u);

  const firstWebhookJob = await service.runWorkerOnce();
  assert.equal(firstWebhookJob?.kind, "delete");
  assert.equal(imports.length, 2);

  const duplicateWebhook = await service.handleWebhook(
    "whoop",
    createWhoopWebhookHeaders("whoop-client-secret", rawBody, retryTimestamp),
    rawBody,
  );
  assert.equal(duplicateWebhook.accepted, true);
  assert.equal(duplicateWebhook.duplicate, true);
  assert.equal(duplicateWebhook.traceId, firstWebhook.traceId);

  const duplicateWebhookJob = await service.runWorkerOnce();
  assert.equal(duplicateWebhookJob, null);
  assert.equal(imports.length, 2);

  service.close();
});

test("sqlite device-sync store clears lastSyncErrorAt when clearErrors removes the error fields", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-clear-errors");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-clear-errors",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      connectedAt: "2026-03-16T10:00:00.000Z",
    });

    store.markSyncFailed(
      account.id,
      "2026-03-16T10:05:00.000Z",
      "SYNC_FAILED",
      "Sync failed.",
      "active",
    );

    const cleared = store.patchAccount(account.id, {
      clearErrors: true,
    });

    assert.equal(cleared.lastErrorCode, null);
    assert.equal(cleared.lastErrorMessage, null);
    assert.equal(cleared.lastSyncErrorAt, null);
  } finally {
    store.close();
  }
});

test("sqlite device-sync store disconnect clears mirrored tokens and stale errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-disconnect-clear");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-disconnect-clear",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      connectedAt: "2026-03-16T10:00:00.000Z",
      nextReconcileAt: "2026-03-17T12:00:00.000Z",
    });

    store.markSyncFailed(
      account.id,
      "2026-03-16T10:05:00.000Z",
      "SYNC_FAILED",
      "Sync failed.",
      "reauthorization_required",
    );

    const disconnected = store.disconnectAccount(account.id, "2026-03-16T10:10:00.000Z");

    assert.equal(disconnected.status, "disconnected");
    assert.equal(disconnected.accessTokenEncrypted, "");
    assert.equal(disconnected.refreshTokenEncrypted, null);
    assert.equal(disconnected.accessTokenExpiresAt, null);
    assert.equal(disconnected.lastErrorCode, null);
    assert.equal(disconnected.lastErrorMessage, null);
    assert.equal(disconnected.lastSyncErrorAt, null);
    assert.equal(disconnected.nextReconcileAt, null);
  } finally {
    store.close();
  }
});

test("device sync service accepts configured external return origins and still rejects unknown origins", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-return");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      allowedReturnOrigins: ["http://127.0.0.1:3000", "http://localhost:3000/app"],
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [createFakeProvider()],
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
      returnTo: "http://127.0.0.1:3000/devices",
    });

    const connected = await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "allowed",
    });

    assert.equal(connected.returnTo, "http://127.0.0.1:3000/devices");

    await assert.rejects(
      () =>
        service.startConnection({
          provider: "demo",
          returnTo: "https://malicious.example/steal",
        }),
      /allowed origin URL/u,
    );
  } finally {
    service.close();
  }
});

test("device sync service rejects manual reconcile and webhook enqueue for disconnected accounts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-disconnect");
  const imports: unknown[] = [];
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input);
      return {
        ok: true,
      };
    },
  };
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [createFakeProvider()],
    importer,
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  const connected = await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "xyz",
  });

  await service.disconnectAccount(connected.account.id);

  assert.throws(
    () => service.queueManualReconcile(connected.account.id),
    /Disconnected device sync accounts must be reconnected/u,
  );

  const webhook = await service.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(webhook.accepted, true);
  assert.equal(webhook.duplicate, false);

  const nextJob = await service.runWorkerOnce();
  assert.equal(nextJob, null);
  assert.equal(imports.length, 0);

  service.close();
});

test("device sync service records granted callback scopes and describes polling-only providers", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-polling");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        provider: "polling",
        callbackPath: "/oauth/polling/callback",
        webhookPath: undefined,
        verifyAndParseWebhook: undefined,
        defaultScopes: ["personal", "daily"],
        async exchangeAuthorizationCode(_context, code) {
          return {
            externalAccountId: `polling-${code}`,
            displayName: `Polling ${code}`,
            tokens: {
              accessToken: "polling-access",
              refreshToken: "polling-refresh",
            },
          };
        },
      }),
    ],
  });

  const descriptor = service.describeProvider("polling");
  assert.equal(descriptor.supportsWebhooks, false);
  assert.equal(descriptor.webhookPath, null);
  assert.equal(descriptor.webhookUrl, null);

  const begin = await service.startConnection({
    provider: "polling",
  });
  const connected = await service.handleOAuthCallback({
    provider: "polling",
    state: begin.state,
    code: "abc",
    scope: "personal daily heartrate",
  });

  assert.deepEqual(connected.account.scopes, ["personal", "daily", "heartrate"]);

  await assert.rejects(
    () => service.handleWebhook("polling", new Headers(), Buffer.from("{}")),
    /does not accept webhooks/u,
  );

  service.close();
});

test("manual reconcile queues every scheduled job and store claims only one job per account at a time", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-serialized");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async exchangeAuthorizationCode(_context, code) {
          return {
            externalAccountId: `serialized-${code}`,
            displayName: `Serialized ${code}`,
            tokens: {
              accessToken: "serialized-access",
              refreshToken: "serialized-refresh",
            },
            initialJobs: [],
            nextReconcileAt: null,
          };
        },
        createScheduledJobs() {
          return {
            jobs: [
              {
                kind: "reconcile-summary",
                payload: {
                  slice: "summary",
                },
              },
              {
                kind: "reconcile-detail",
                payload: {
                  slice: "detail",
                },
              },
            ],
            nextReconcileAt: null,
          };
        },
      }),
    ],
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  const connected = await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "abc",
  });

  const reconcile = service.queueManualReconcile(connected.account.id);
  assert.equal(reconcile.job.kind, "reconcile-summary");
  assert.deepEqual(
    reconcile.jobs.map((job) => job.kind),
    ["reconcile-summary", "reconcile-detail"],
  );

  const now = new Date().toISOString();
  const firstClaim = service.store.claimDueJob("worker-a", now, 60_000);
  const secondClaim = service.store.claimDueJob("worker-b", now, 60_000);

  assert.equal(
    ["reconcile-summary", "reconcile-detail"].includes(firstClaim?.kind ?? ""),
    true,
  );
  assert.equal(secondClaim, null);

  service.store.completeJob(firstClaim!.id, now);

  const thirdClaim = service.store.claimDueJob("worker-b", now, 60_000);
  assert.deepEqual(
    new Set([firstClaim?.kind, thirdClaim?.kind]),
    new Set(["reconcile-summary", "reconcile-detail"]),
  );

  service.close();
});

test("device sync service fences in-flight jobs after disconnect", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-disconnect-fence");
  const imports: unknown[] = [];
  let refreshCalls = 0;
  let providerStartedResolve: (() => void) | null = null;
  let releaseProviderResolve: (() => void) | null = null;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const releaseProvider = new Promise<void>((resolve) => {
    releaseProviderResolve = resolve;
  });
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input);
      return {
        ok: true,
      };
    },
  };
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async refreshTokens(_account: DeviceSyncAccount): Promise<ProviderAuthTokens> {
          refreshCalls += 1;
          return {
            accessToken: "access-token-fenced",
            refreshToken: "refresh-token-fenced",
          };
        },
        async executeJob(context, _job) {
          providerStartedResolve?.();
          await releaseProvider;
          await context.refreshAccountTokens();
          await context.importSnapshot({
            accountId: context.account.externalAccountId,
            importedAt: context.now,
          });
          return {
            scheduledJobs: [
              {
                kind: "follow-up",
                dedupeKey: `follow-up:${context.account.id}`,
              },
            ],
            metadataPatch: {
              fenced: false,
            },
            nextReconcileAt: "2026-03-19T00:00:00.000Z",
          };
        },
      }),
    ],
    importer,
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  const connected = await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "fence",
  });
  const accountBeforeDisconnect = service.store.getAccountById(connected.account.id);
  const initialJob = service.summarize();

  assert.equal(initialJob.jobsQueued, 1);
  assert.ok(accountBeforeDisconnect);

  const workerPromise = service.runWorkerOnce();
  await providerStarted;

  const disconnected = await service.disconnectAccount(connected.account.id);
  assert.equal(disconnected.account.status, "disconnected");

  releaseProviderResolve?.();
  await workerPromise;

  const storedAccount = service.store.getAccountById(connected.account.id);
  const jobs = service.store.database.prepare(`
    select id, kind, status, last_error_code
    from device_job
    where account_id = ?
    order by created_at asc, id asc
  `).all(connected.account.id) as Array<{
    id: string;
    kind: string;
    status: string;
    last_error_code: string | null;
  }>;

  assert.equal(refreshCalls, 0);
  assert.equal(imports.length, 0);
  assert.ok(storedAccount);
  assert.equal(storedAccount.status, "disconnected");
  assert.equal(storedAccount.disconnectGeneration, (accountBeforeDisconnect?.disconnectGeneration ?? 0) + 1);
  assert.equal(storedAccount.accessTokenEncrypted, "");
  assert.equal(storedAccount.refreshTokenEncrypted, null);
  assert.equal(storedAccount.accessTokenExpiresAt, null);
  assert.equal(storedAccount.lastSyncCompletedAt, null);
  assert.equal(service.summarize().jobsQueued, 0);
  assert.equal(service.summarize().jobsRunning, 0);
  assert.equal(service.summarize().jobsDead, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.kind, "backfill");
  assert.equal(jobs[0]?.status, "dead");
  assert.equal(jobs[0]?.last_error_code, "ACCOUNT_DISCONNECTED");

  service.close();
});

test("device sync service next wake tracks scheduled reconciles and queued jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-next-wake");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [createFakeProvider()],
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  const connected = await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "wake",
  });

  assert.equal(
    service.getNextWakeAt("2026-03-17T10:00:00.000Z"),
    "2026-03-17T12:00:00.000Z",
  );

  service.store.enqueueJob({
    accountId: connected.account.id,
    availableAt: "2026-03-17T11:00:00.000Z",
    kind: "retry",
    payload: {},
    priority: 10,
    provider: connected.account.provider,
  });

  assert.equal(
    service.getNextWakeAt("2026-03-17T10:00:00.000Z"),
    "2026-03-17T11:00:00.000Z",
  );

  service.store.enqueueJob({
    accountId: connected.account.id,
    availableAt: "2026-03-17T09:59:00.000Z",
    kind: "due-now",
    payload: {},
    priority: 100,
    provider: connected.account.provider,
  });

  assert.equal(
    service.getNextWakeAt("2026-03-17T10:00:00.000Z"),
    "2026-03-17T10:00:01.000Z",
  );

  service.close();
});

test("sqlite store hosted hydration replaces mirrored metadata and clears local tokens on disconnect", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-hosted-hydrate");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));
  const seeded = store.upsertAccount({
    connectedAt: "2026-03-20T10:00:00.000Z",
    displayName: "Seeded Account",
    externalAccountId: "demo-seeded",
    metadata: {
      stale: true,
      retained: "old",
    },
    nextReconcileAt: "2026-03-28T00:00:00.000Z",
    provider: "demo",
    scopes: ["offline"],
    status: "active",
    tokens: {
      accessToken: "seed-access",
      accessTokenEncrypted: "enc:seed-access",
      accessTokenExpiresAt: "2026-03-28T00:00:00.000Z",
      refreshToken: "seed-refresh",
      refreshTokenEncrypted: "enc:seed-refresh",
    },
  });
  store.markSyncFailed(
    seeded.id,
    "2026-03-20T11:00:00.000Z",
    "STALE",
    "stale local error",
    "reauthorization_required",
  );

  const hydrated = store.hydrateHostedAccount({
    connectedAt: "2026-03-20T10:00:00.000Z",
    displayName: "Hosted Account",
    externalAccountId: "demo-seeded",
    hostedObservedTokenVersion: null,
    hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
    lastSyncErrorAt: null,
    lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
    lastWebhookAt: "2026-03-27T07:50:00.000Z",
    metadata: {
      fresh: true,
      nested: {
        drop: "me",
      },
      oversized: "x".repeat(300),
    },
    nextReconcileAt: null,
    provider: "demo",
    scopes: ["heartrate"],
    status: "disconnected",
    updatedAt: "2026-03-27T08:00:00.000Z",
  });

  assert.ok(hydrated);
  assert.equal(hydrated?.id, seeded.id);
  assert.equal(hydrated?.status, "disconnected");
  assert.equal(hydrated?.displayName, "Hosted Account");
  assert.deepEqual(hydrated?.metadata, {
    fresh: true,
  });
  assert.deepEqual(hydrated?.scopes, ["heartrate"]);
  assert.equal(hydrated?.lastErrorCode, null);
  assert.equal(hydrated?.lastErrorMessage, null);
  assert.equal(hydrated?.lastWebhookAt, "2026-03-27T07:50:00.000Z");
  assert.equal(hydrated?.lastSyncStartedAt, "2026-03-27T07:55:00.000Z");
  assert.equal(hydrated?.lastSyncCompletedAt, "2026-03-27T08:00:00.000Z");
  assert.equal(hydrated?.hostedObservedUpdatedAt, "2026-03-27T08:00:00.000Z");
  assert.equal(hydrated?.hostedObservedTokenVersion, null);
  assert.equal(hydrated?.updatedAt, "2026-03-27T08:00:00.000Z");
  assert.equal(hydrated?.accessTokenEncrypted, "");
  assert.equal(hydrated?.refreshTokenEncrypted, null);
  assert.equal(hydrated?.accessTokenExpiresAt, null);

  store.close();
});

test("sqlite store sanitizes connection metadata writes and metadataPatch merges", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-metadata-sanitize");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));
  const created = store.upsertAccount({
    connectedAt: "2026-03-20T10:00:00.000Z",
    displayName: "Seeded Account",
    externalAccountId: "demo-sanitize",
    metadata: {
      enabled: true,
      longText: "x".repeat(300),
      nested: {
        secret: "drop-me",
      },
      source: "browser",
      values: ["drop-me"],
    },
    nextReconcileAt: null,
    provider: "demo",
    scopes: ["offline"],
    status: "active",
    tokens: {
      accessToken: "seed-access",
      accessTokenEncrypted: "enc:seed-access",
      accessTokenExpiresAt: "2026-03-28T00:00:00.000Z",
      refreshToken: "seed-refresh",
      refreshTokenEncrypted: "enc:seed-refresh",
    },
  });

  assert.deepEqual(created.metadata, {
    enabled: true,
    source: "browser",
  });
  assert.equal(
    store.markSyncSucceeded(created.id, "2026-03-20T12:00:00.000Z", null, {
      metadataPatch: {
        count: 3,
        enabled: false,
        nested: {
          secret: "still-drop-me",
        },
        tags: ["drop-me-too"],
      },
    }),
    true,
  );
  assert.deepEqual(store.getAccountById(created.id)?.metadata, {
    count: 3,
    enabled: false,
    source: "browser",
  });

  store.close();
});

test("sqlite store persists the webhook trace claim lifecycle", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-webhook-trace-store");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));

  const baseTrace = {
    eventType: "demo.updated",
    externalAccountId: "demo-abc",
    payload: {
      resourceId: "resource-1",
    },
    provider: "demo",
  };

  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-processing",
      receivedAt: "2026-03-27T00:00:00.000Z",
      processingExpiresAt: "2026-03-27T00:05:00.000Z",
    }),
    "claimed",
  );
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-processing",
      receivedAt: "2026-03-27T00:01:00.000Z",
      processingExpiresAt: "2026-03-27T00:06:00.000Z",
    }),
    "processing",
  );

  store.completeWebhookTrace("demo", "trace-processing");
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-processing",
      receivedAt: "2026-03-27T00:02:00.000Z",
      processingExpiresAt: "2026-03-27T00:07:00.000Z",
    }),
    "processed",
  );

  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-release",
      receivedAt: "2026-03-27T00:03:00.000Z",
      processingExpiresAt: "2026-03-27T00:08:00.000Z",
    }),
    "claimed",
  );
  store.releaseWebhookTrace("demo", "trace-release");
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-release",
      receivedAt: "2026-03-27T00:04:00.000Z",
      processingExpiresAt: "2026-03-27T00:09:00.000Z",
    }),
    "claimed",
  );

  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-stale",
      receivedAt: "2026-03-27T00:05:00.000Z",
      processingExpiresAt: "2026-03-27T00:06:00.000Z",
    }),
    "claimed",
  );
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-stale",
      receivedAt: "2026-03-27T00:07:00.000Z",
      processingExpiresAt: "2026-03-27T00:12:00.000Z",
    }),
    "claimed",
  );

  store.database.prepare(`
    insert into webhook_trace (
      provider,
      trace_id,
      external_account_id,
      event_type,
      received_at,
      payload_json
    ) values (?, ?, ?, ?, ?, ?)
  `).run(
    "demo",
    "trace-legacy",
    "demo-legacy",
    "demo.updated",
    "2026-03-27T00:08:00.000Z",
    JSON.stringify({ resourceId: "resource-legacy" }),
  );
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-legacy",
      receivedAt: "2026-03-27T00:09:00.000Z",
      processingExpiresAt: "2026-03-27T00:14:00.000Z",
    }),
    "processed",
  );

  const rows = (store.database.prepare(`
    select trace_id, status, processing_expires_at
    from webhook_trace
    where provider = 'demo'
    order by trace_id asc
  `).all() as Array<{
    trace_id: string;
    status: string;
    processing_expires_at: string | null;
  }>).map((row) => ({
    ...row,
  }));

  assert.deepEqual(rows, [
    {
      trace_id: "trace-legacy",
      status: "processed",
      processing_expires_at: null,
    },
    {
      trace_id: "trace-processing",
      status: "processed",
      processing_expires_at: null,
    },
    {
      trace_id: "trace-release",
      status: "processing",
      processing_expires_at: "2026-03-27T00:09:00.000Z",
    },
    {
      trace_id: "trace-stale",
      status: "processing",
      processing_expires_at: "2026-03-27T00:12:00.000Z",
    },
  ]);

  store.close();
});
