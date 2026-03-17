import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

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

  const begin = service.startConnection({
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
    const begin = service.startConnection({
      provider: "demo",
      returnTo: "http://127.0.0.1:3000/devices",
    });

    const connected = await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "allowed",
    });

    assert.equal(connected.returnTo, "http://127.0.0.1:3000/devices");

    assert.throws(
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

  const begin = service.startConnection({
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

  const begin = service.startConnection({
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
