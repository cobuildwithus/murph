import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.js";
import { createDeviceSyncService } from "../src/service.js";

import type {
  DeviceSyncAccount,
  DeviceSyncImporterPort,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
  ProviderAuthTokens,
} from "../src/types.js";

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
  const vaultRoot = await makeTempDirectory("healthybob-device-syncd");
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
      publicBaseUrl: "https://healthybob.test/device-sync",
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

  const duplicateWebhook = await service.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicateWebhook.duplicate, true);

  await service.runWorkerOnce();
  assert.equal(imports.length, 2);

  const reconcile = service.queueManualReconcile(connected.account.id);
  assert.equal(reconcile.account.id, connected.account.id);
  assert.equal(reconcile.jobs.length, 1);

  service.close();
});

test("device sync service durably suppresses WHOOP webhook replays without trace_id after the first job runs", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-syncd-whoop-replay");
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
      publicBaseUrl: "https://healthybob.test/device-sync",
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
  const headers = createWhoopWebhookHeaders("whoop-client-secret", rawBody, String(Date.now()));

  const firstWebhook = await service.handleWebhook("whoop", headers, rawBody);
  assert.equal(firstWebhook.accepted, true);
  assert.equal(firstWebhook.duplicate, false);
  assert.match(firstWebhook.traceId ?? "", /^[a-f0-9]{64}$/u);

  const firstWebhookJob = await service.runWorkerOnce();
  assert.equal(firstWebhookJob?.kind, "delete");
  assert.equal(imports.length, 2);

  const duplicateWebhook = await service.handleWebhook("whoop", headers, rawBody);
  assert.equal(duplicateWebhook.accepted, true);
  assert.equal(duplicateWebhook.duplicate, true);
  assert.equal(duplicateWebhook.traceId, firstWebhook.traceId);

  const duplicateWebhookJob = await service.runWorkerOnce();
  assert.equal(duplicateWebhookJob, null);
  assert.equal(imports.length, 2);

  service.close();
});

test("device sync service accepts configured external return origins and still rejects unknown origins", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-syncd-return");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.healthybob.test/device-sync",
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
  const vaultRoot = await makeTempDirectory("healthybob-device-syncd-disconnect");
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
      publicBaseUrl: "https://healthybob.test/device-sync",
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
  const vaultRoot = await makeTempDirectory("healthybob-device-syncd-polling");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://healthybob.test/device-sync",
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
  const vaultRoot = await makeTempDirectory("healthybob-device-syncd-serialized");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://healthybob.test/device-sync",
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
