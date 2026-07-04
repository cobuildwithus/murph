import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { openSqliteRuntimeDatabase, writeSqliteRuntimeUserVersion } from "@murphai/runtime-state/node";
import { DEVICE_SYNC_DB_RELATIVE_PATH } from "@murphai/runtime-state/node/runtime-paths";

import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.ts";
import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "../src/local-secret-codec.ts";
import { DeviceSyncError, deviceSyncError } from "../src/errors.ts";
import {
  createDeviceSyncService,
  resolveDeviceSyncStoreNextWakeAt,
} from "../src/service.ts";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { scopeWebhookTraceId } from "../src/shared.ts";
import { SqliteDeviceSyncStore } from "../src/store.ts";
import { DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION } from "../src/store/schema.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";
import {
  countJobsForAccountForTesting,
  expireJobLeaseForTesting,
  insertWebhookTraceRowForTesting,
  listJobKindsForAccountForTesting,
  readCredentialStateForTesting,
  readFirstJobIdForAccountForTesting,
  readJobsForAccountForTesting,
  readNamedSqliteTablesForTesting,
  readObservationStateForTesting,
  readTableColumnsForTesting,
  readWebhookTraceLifecycleRowsForTesting,
  readWebhookTraceStatusForTesting,
  setCredentialStateForTesting,
  setJobAttemptsForTesting,
} from "./store-test-helpers.ts";

import type {
  DeviceSyncTickMutex,
  DeviceSyncWorkerExecutor,
} from "../src/service.ts";
import type {
  DeviceConnectionHandler,
  DeviceJobBatchExecutor,
  DeviceSyncAccount,
  DeviceSyncImporterPort,
  DeviceSyncJobRecord,
  DeviceJobExecutor,
  DeviceSyncProvider,
  DeviceWebhookHandler,
  ProviderAuthTokens,
  ProviderConnectionResult,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

const UNSUPPORTED_SCHEMA_VERSION = DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION + 1;
const UNSUPPORTED_SCHEMA_VERSION_RE = new RegExp(
  `device sync runtime database schema version ${UNSUPPORTED_SCHEMA_VERSION} is newer than supported version ${DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION}`,
);

function createServiceFixture(input: Parameters<typeof createDeviceSyncService>[0]): {
  close: () => void;
  service: ReturnType<typeof createDeviceSyncService>;
  store: SqliteDeviceSyncStore;
} {
  const fixtureStore = input.store
    ?? new SqliteDeviceSyncStore(input.config.stateDatabasePath ?? path.join(input.config.vaultRoot, ".runtime", "device-syncd.sqlite"));
  const service = createDeviceSyncService({
    ...input,
    store: fixtureStore,
  });

  return {
    service,
    store: fixtureStore,
    close() {
      service.close();
      fixtureStore.close();
    },
  };
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

type FakeProviderOverrides = Partial<DeviceSyncProvider> & {
  buildConnectUrl?: (input: {
    state: string;
    callbackUrl: string;
    scopes: string[];
    now: string;
  }) => string;
  exchangeAuthorizationCode?: (
    context: {
      callbackUrl: string;
      state: string;
      now: string;
      grantedScopes: string[];
    },
    code: string,
  ) => Promise<ProviderConnectionResult>;
  refreshTokens?: DeviceConnectionHandler["refreshTokens"];
  revokeAccess?: DeviceConnectionHandler["revokeAccess"];
  createScheduledJobs?: DeviceJobExecutor["createScheduledJobs"];
  verifyAndParseWebhook?: DeviceWebhookHandler["verifyAndParseWebhook"];
  executeJob?: DeviceJobExecutor["executeJob"];
  describeJobBatch?: DeviceJobBatchExecutor["describe"];
  executeJobBatch?: DeviceJobBatchExecutor["execute"];
  maxJobBatchEstimatedBytes?: DeviceJobBatchExecutor["maxEstimatedBytes"];
  maxJobBatchSize?: DeviceJobBatchExecutor["maxJobs"];
};

function createFakeProvider(overrides: FakeProviderOverrides = {}): DeviceSyncProvider {
  const defaultBuildConnectUrl: NonNullable<FakeProviderOverrides["buildConnectUrl"]> = (context) =>
    `https://example.test/oauth?state=${context.state}`;
  const defaultExchangeAuthorizationCode: NonNullable<FakeProviderOverrides["exchangeAuthorizationCode"]> =
    async (_context, code) => ({
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
    });
  const defaultRefreshTokens: NonNullable<DeviceConnectionHandler["refreshTokens"]> = async () => ({
    accessToken: "access-token-2",
    refreshToken: "refresh-token-2",
  });
  const defaultCreateScheduledJobs: NonNullable<DeviceJobExecutor["createScheduledJobs"]> = (account) => ({
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
  const defaultExecuteJob: DeviceJobExecutor["executeJob"] = async (context, job) => {
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
  };
  const buildConnectUrl = Object.hasOwn(overrides, "buildConnectUrl")
    ? overrides.buildConnectUrl
    : defaultBuildConnectUrl;
  const exchangeAuthorizationCode = Object.hasOwn(overrides, "exchangeAuthorizationCode")
    ? overrides.exchangeAuthorizationCode
    : defaultExchangeAuthorizationCode;
  const refreshTokens = Object.hasOwn(overrides, "refreshTokens")
    ? overrides.refreshTokens
    : defaultRefreshTokens;
  const revokeAccess = Object.hasOwn(overrides, "revokeAccess") ? overrides.revokeAccess : undefined;
  const createScheduledJobs = Object.hasOwn(overrides, "createScheduledJobs")
    ? overrides.createScheduledJobs
    : defaultCreateScheduledJobs;
  const verifyAndParseWebhook = Object.hasOwn(overrides, "verifyAndParseWebhook")
    ? overrides.verifyAndParseWebhook
    : defaultVerifyAndParseWebhook;
  const executeJob = Object.hasOwn(overrides, "executeJob")
    ? overrides.executeJob
    : defaultExecuteJob;
  const describeJobBatch = Object.hasOwn(overrides, "describeJobBatch")
    ? overrides.describeJobBatch
    : undefined;
  const executeJobBatch = Object.hasOwn(overrides, "executeJobBatch")
    ? overrides.executeJobBatch
    : undefined;
  const maxJobBatchEstimatedBytes = Object.hasOwn(overrides, "maxJobBatchEstimatedBytes")
    ? overrides.maxJobBatchEstimatedBytes
    : undefined;
  const maxJobBatchSize = Object.hasOwn(overrides, "maxJobBatchSize")
    ? overrides.maxJobBatchSize
    : undefined;
  const {
    buildConnectUrl: _buildConnectUrl,
    exchangeAuthorizationCode: _exchangeAuthorizationCode,
    refreshTokens: _refreshTokens,
    revokeAccess: _revokeAccess,
    createScheduledJobs: _createScheduledJobs,
    verifyAndParseWebhook: _verifyAndParseWebhook,
    executeJob: _executeJob,
    describeJobBatch: _describeJobBatch,
    executeJobBatch: _executeJobBatch,
    maxJobBatchEstimatedBytes: _maxJobBatchEstimatedBytes,
    maxJobBatchSize: _maxJobBatchSize,
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
    connectionHandler: {
      async beginConnection(input) {
        return {
          authorizationUrl: buildConnectUrl
            ? buildConnectUrl({
                state: input.state,
                callbackUrl: input.callbackUrl,
                scopes: input.scopes,
                now: input.now,
              })
            : "",
        };
      },
      async completeConnection(input) {
        if (!exchangeAuthorizationCode) {
          throw new Error("Fake provider exchangeAuthorizationCode is not configured.");
        }
        return exchangeAuthorizationCode({
          callbackUrl: input.callbackUrl,
          state: input.state,
          now: input.now,
          grantedScopes: input.grantedScopes,
        }, input.query.get("code") ?? "");
      },
      ...(refreshTokens ? { refreshTokens } : {}),
      ...(revokeAccess ? { revokeAccess } : {}),
    },
    ...(verifyAndParseWebhook ? { webhookHandler: { verifyAndParseWebhook } } : {}),
    jobExecutor: {
      ...(createScheduledJobs ? { createScheduledJobs } : {}),
      executeJob: executeJob ?? defaultExecuteJob,
      ...(describeJobBatch && executeJobBatch
        ? {
            batch: {
              describe: describeJobBatch,
              execute: executeJobBatch,
              ...(maxJobBatchEstimatedBytes !== undefined ? { maxEstimatedBytes: maxJobBatchEstimatedBytes } : {}),
              ...(maxJobBatchSize !== undefined ? { maxJobs: maxJobBatchSize } : {}),
            },
          }
        : {}),
    },
  };

  return {
    ...baseProvider,
    ...providerOverrides,
  };
}

const TEST_SECRET_CODEC = createSecretCodec("secret-for-tests");

function encryptStoredAccessToken(provider: string, externalAccountId: string, accessToken: string): string {
  return TEST_SECRET_CODEC.encrypt(
    accessToken,
    buildDeviceSyncTokenCipherOptions({
      externalAccountId,
      provider,
      purpose: "device-sync-access-token",
    }),
  );
}

function requireCallback(callback: (() => void) | null, message: string): () => void {
  assert.ok(callback, message);
  return callback;
}

function createSkippingTickMutex(shouldSkip: () => boolean): DeviceSyncTickMutex {
  return {
    async runIfIdle(operation) {
      if (shouldSkip()) {
        return undefined;
      }

      return await operation();
    },
  };
}

function requireStoredOAuthCredential(
  account: StoredDeviceSyncAccount | null | undefined,
): Extract<StoredDeviceSyncAccount["credential"], { kind: "oauth_tokens" }> {
  assert.ok(account);
  assert.equal(account.credential.kind, "oauth_tokens");
  return account.credential;
}

function readAccountAccessTokenForTesting(account: DeviceSyncAccount): string | null {
  return account.credential.kind === "oauth_tokens"
    ? account.credential.tokens.accessToken
    : null;
}

function assertStoredCredentialKind(
  account: StoredDeviceSyncAccount | null | undefined,
  kind: StoredDeviceSyncAccount["credential"]["kind"],
): void {
  assert.ok(account);
  assert.equal(account.credential.kind, kind);
}

test("device sync service facade exposes explicit controls without exposing the store", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd");
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn() {
          // Expected failures are asserted through the diagnostics API below.
        },
      },
    },
    providers: [createFakeProvider()],
  });

  try {
    assert.equal(Reflect.has(service, "store"), false);
    assert.equal(Reflect.has(service, "publicIngress"), false);
    assert.equal(typeof service.queueManualReconcile, "function");
    assert.equal(typeof service.disconnectAccount, "function");
  } finally {
    close();
  }
});

test("device sync service explicit account controls reject missing accounts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-controls-missing-account");
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [createFakeProvider()],
  });

  assert.throws(
    () => service.queueManualReconcile("acct_missing"),
    /Device sync account acct_missing was not found\./,
  );
  await assert.rejects(
    () => service.disconnectAccount("acct_missing"),
    /Device sync account acct_missing was not found\./,
  );

  close();
});

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
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn() {
          // Expected failures are asserted through the diagnostics API below.
        },
      },
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
    readWebhookTraceStatusForTesting(store, "demo", scopeWebhookTraceId("demo", "demo-abc", "trace-1")),
    "processed",
  );

  const duplicateWebhook = await service.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.equal(duplicateWebhook.duplicate, true);

  await service.runWorkerOnce();
  assert.equal(imports.length, 2);

  const reconcile = service.queueManualReconcile(connected.account.id);
  assert.equal(reconcile.account.id, connected.account.id);
  assert.equal(reconcile.jobs.length, 1);

  close();
});

test("device sync job context lets providers update source projections", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-source-projection-context");
  let listedInsideJob = 0;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          const upserted = await context.upsertConnectionSource?.({
            sourceInstanceKey: "oura",
            sourceProviderSlug: "oura",
            displayName: "Oura",
            status: "connected",
            resourceAvailabilitySummary: {
              sleep: "available",
            },
            lastSeenAt: context.now,
          });
          assert.equal(upserted?.sourceProviderSlug, "oura");

          const sources = await context.listConnectionSources?.({
            sourceProviderSlug: "oura",
          });
          listedInsideJob = sources?.length ?? 0;
          return {};
        },
      }),
    ],
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    const connected = await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "source-projection",
    });

    await service.runWorkerOnce();

    const sources = store.listConnectionSources({ connectionId: connected.account.id });
    assert.equal(listedInsideJob, 1);
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0], {
      id: sources[0]?.id,
      connectionId: connected.account.id,
      sourceInstanceKey: "oura",
      sourceProviderSlug: "oura",
      displayName: "Oura",
      status: "connected",
      resourceAvailabilitySummary: {
        sleep: "available",
      },
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: sources[0]?.firstSeenAt,
      lastSeenAt: sources[0]?.lastSeenAt,
      createdAt: sources[0]?.createdAt,
      updatedAt: sources[0]?.updatedAt,
    });
  } finally {
    close();
  }
});

test("device sync service keeps connection-established webhook admin upkeep best-effort", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-webhook-admin-upkeep");
  const warnEvents: Array<{ context?: Record<string, unknown>; message: string }> = [];
  let upkeepInput: { publicBaseUrl: string } | null = null;
  const ensureSubscriptions = vi.fn(async (input: { publicBaseUrl: string }) => {
    upkeepInput = input;
    throw new Error("upkeep unavailable");
  });
  const baseProvider = createFakeProvider();
  const webhookDescriptor = baseProvider.descriptor.webhook;
  assert.ok(webhookDescriptor);
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn(message, context) {
          warnEvents.push({
            context: context as Record<string, unknown> | undefined,
            message,
          });
        },
      },
    },
    providers: [
      createFakeProvider({
        provider: "oura",
        descriptor: {
          ...baseProvider.descriptor,
          provider: "oura",
          displayName: "Oura",
          oauth: {
            callbackPath: "/oauth/oura/callback",
            defaultScopes: ["offline", "read:data"],
          },
          webhook: {
            ...webhookDescriptor,
            path: "/webhooks/oura",
            supportsAdmin: true,
          },
        },
        async exchangeAuthorizationCode(_context, code) {
          return {
            externalAccountId: `oura-${code}`,
            displayName: "Oura",
            scopes: ["personal", "daily"],
            tokens: {
              accessToken: "access-token",
              refreshToken: "refresh-token",
            },
            initialJobs: [],
            nextReconcileAt: "2026-03-17T12:00:00.000Z",
          };
        },
        webhookAdmin: {
          ensureSubscriptions,
        },
      }),
    ],
  });

  const begin = await service.startConnection({
    provider: "oura",
  });
  const connected = await service.handleOAuthCallback({
    provider: "oura",
    state: begin.state,
    code: "webhook-admin",
  });
  const queuedJobs = countJobsForAccountForTesting(store, connected.account.id);

  assert.equal(connected.account.externalAccountId, "oura-webhook-admin");
  assert.equal(queuedJobs, 0);
  assert.equal(ensureSubscriptions.mock.calls.length, 1);
  assert.deepEqual(upkeepInput, {
    publicBaseUrl: "https://sync.example.test/device-sync",
  });
  assert.equal(warnEvents.length, 1);
  assert.equal(
    warnEvents[0]?.message,
    "Failed to ensure device-sync webhook admin upkeep after connection establishment.",
  );
  assert.equal(warnEvents[0]?.context?.failureCode, "DEVICE_SYNC_WEBHOOK_ADMIN_UPKEEP_FAILED");
  assert.deepEqual(warnEvents[0]?.context?.error, {
    category: "unexpected_error",
    message: "upkeep unavailable",
    name: "Error",
  });
  assert.equal(warnEvents[0]?.context?.provider, "oura");
  assert.equal(warnEvents[0]?.context?.reason, "connection-established");

  close();
});

test("device sync service does not run connection-established webhook admin upkeep for non-Oura providers", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-non-oura-webhook-admin");
  const ensureSubscriptions = vi.fn(async () => {});
  const baseProvider = createFakeProvider();
  const webhookDescriptor = baseProvider.descriptor.webhook;
  assert.ok(webhookDescriptor);
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        provider: "strava",
        descriptor: {
          ...baseProvider.descriptor,
          provider: "strava",
          displayName: "Strava",
          oauth: {
            callbackPath: "/oauth/strava/callback",
            defaultScopes: ["offline", "activity:read_all"],
          },
          webhook: {
            ...webhookDescriptor,
            path: "/webhooks/strava",
            supportsAdmin: true,
          },
        },
        async exchangeAuthorizationCode(_context, code) {
          return {
            externalAccountId: `strava-${code}`,
            displayName: "Strava",
            scopes: ["activity:read_all"],
            tokens: {
              accessToken: "access-token",
              refreshToken: "refresh-token",
            },
            initialJobs: [],
            nextReconcileAt: "2026-03-17T12:00:00.000Z",
          };
        },
        webhookAdmin: {
          ensureSubscriptions,
        },
      }),
    ],
  });

  const begin = await service.startConnection({
    provider: "strava",
  });
  await service.handleOAuthCallback({
    provider: "strava",
    state: begin.state,
    code: "strava-webhook-admin",
  });

  assert.equal(ensureSubscriptions.mock.calls.length, 0);

  close();
});

test("device sync service redacts connection metadata from public account responses while retaining internal provider state", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-public-redaction");
  let seenMetadata: Record<string, unknown> | null = null;
  const { service, store, close } = createServiceFixture({
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
  assert.deepEqual(store.getAccountById(connected.account.id)?.metadata, {
    connectedBy: "sensitive-connect-code",
  });

  await service.runWorkerOnce();
  assert.deepEqual(seenMetadata, {
    connectedBy: "sensitive-connect-code",
  });

  close();
});

test("device sync service sanitizes legacy credential metadata before provider runtime context", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-credential-runtime-sanitize");
  let seenCredentialMetadata: Record<string, unknown> | null = null;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          seenCredentialMetadata = context.account.credential.kind === "provider_config"
            ? { ...context.account.credential.credentialMetadata }
            : null;
          return {};
        },
      }),
    ],
  });

  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-config",
    displayName: "Demo Provider Config",
    scopes: [],
    credential: {
      kind: "provider_config",
      providerConfigKey: "demo",
      subject: {
        clientUserIdHash: "client-user-id-hash",
      },
      credentialMetadata: {
        mode: "external-link",
      },
    },
    metadata: {},
    connectedAt: "2026-04-07T00:00:00.000Z",
  });
  setCredentialStateForTesting(store, account.id, {
    credential_metadata_json: JSON.stringify({
      authHeader: "Bearer legacy-auth-token",
      mode: "external-link",
      token: "legacy-token",
      subject: {
        clientUserId: "legacy-client-user-id",
        clientUserIdHash: "client-user-id-hash",
        sessionToken: "legacy-session-token",
        userHashId: "legacy-user-id",
      },
    }),
  });
  store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "reconcile",
    payload: {},
    availableAt: "2026-04-07T00:00:00.000Z",
  });

  await service.runWorkerOnce();

  assert.deepEqual(seenCredentialMetadata, {
    mode: "external-link",
    subject: {
      clientUserIdHash: "client-user-id-hash",
    },
  });

  close();
});

test("device sync service fails closed when stored token integrity validation fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-token-integrity");
  const { service, store, close } = createServiceFixture({
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
    returnTo: "/settings/devices",
  });
  const connected = await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "tampered",
  });
  const stored = store.getAccountById(connected.account.id);
  assert.ok(stored);

  const codec = createSecretCodec("secret-for-tests");
  const updated = store.updateAccountTokens(stored.id, {
    accessToken: "tampered-access-token",
    accessTokenEncrypted: codec.encrypt(
      "tampered-access-token",
      buildDeviceSyncTokenCipherOptions({
        externalAccountId: `${stored.externalAccountId}-other`,
        provider: stored.provider,
        purpose: "device-sync-access-token",
      }),
    ),
    refreshToken: "tampered-refresh-token",
    refreshTokenEncrypted: codec.encrypt(
      "tampered-refresh-token",
      buildDeviceSyncTokenCipherOptions({
        externalAccountId: stored.externalAccountId,
        provider: stored.provider,
        purpose: "device-sync-refresh-token",
      }),
    ),
  });
  assert.ok(updated);

  const reconcile = service.queueManualReconcile(stored.id);
  const processedJob = await service.runWorkerOnce();

  const failedJob = processedJob ? store.getJobById(processedJob.id) : null;
  const queuedManualJob = store.getJobById(reconcile.job.id);
  const reauthorizationAccount = store.getAccountById(stored.id);

  assert.equal(processedJob?.id, reconcile.job.id);
  assert.equal(failedJob?.status, "dead");
  assert.equal(failedJob?.lastErrorCode, "ACCOUNT_TOKEN_DECRYPT_FAILED");
  assert.match(failedJob?.lastErrorMessage ?? "", /failed integrity validation/u);
  assert.equal(queuedManualJob?.status, "dead");
  assert.equal(reauthorizationAccount?.status, "reauthorization_required");

  close();
});

test("device sync service starts and stops its timers, closes owned stores, and rejects missing provider or account lookups", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-lifecycle");
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
  const closeSpy = vi.spyOn(SqliteDeviceSyncStore.prototype, "close");
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [],
  });

  try {
    assert.deepEqual(service.describeProviders(), []);
    assert.equal(service.getAccount("missing-account"), null);
    assert.equal(service.getNextWakeAt("2026-03-17T10:00:00.000Z"), null);
    assert.throws(
      () => service.describeProvider("missing-provider"),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "PROVIDER_NOT_REGISTERED"
        && error.httpStatus === 404,
    );
    assert.throws(
      () => service.queueManualReconcile("missing-account"),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "ACCOUNT_NOT_FOUND"
        && error.httpStatus === 404,
    );

    service.start();
    service.start();
    service.stop();
    service.close();

    assert.equal(setIntervalSpy.mock.calls.length, 2);
    assert.equal(clearIntervalSpy.mock.calls.length, 2);
    assert.equal(closeSpy.mock.calls.length, 1);
  } finally {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    closeSpy.mockRestore();
  }
});

test("device sync service scheduler queues due active jobs and skips unsupported or inactive accounts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-scheduler");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        provider: "scheduled",
        descriptor: {
          ...createFakeProvider().descriptor,
          provider: "scheduled",
          displayName: "Scheduled",
          oauth: {
            callbackPath: "/oauth/scheduled/callback",
            defaultScopes: ["offline"],
          },
        },
        createScheduledJobs() {
          return {
            jobs: [
              {
                kind: "scheduled-refresh",
                payload: {
                  slice: "summary",
                },
              },
            ],
            nextReconcileAt: "2026-03-17T12:30:00.000Z",
          };
        },
      }),
      createFakeProvider({
        provider: "unsupported",
        descriptor: {
          ...createFakeProvider().descriptor,
          provider: "unsupported",
          displayName: "Unsupported",
          oauth: {
            callbackPath: "/oauth/unsupported/callback",
            defaultScopes: ["offline"],
          },
        },
        createScheduledJobs: undefined,
      }),
    ],
  });

  const dueActive = store.upsertAccount({
    provider: "scheduled",
    externalAccountId: "scheduled-1",
    displayName: "Scheduled",
    scopes: ["offline"],
    tokens: {
      accessToken: "scheduled-access",
      accessTokenEncrypted: "enc:scheduled-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
    nextReconcileAt: "2026-03-17T11:00:00.000Z",
  });
  store.upsertAccount({
    provider: "scheduled",
    externalAccountId: "scheduled-future",
    displayName: "Future",
    scopes: ["offline"],
    tokens: {
      accessToken: "future-access",
      accessTokenEncrypted: "enc:future-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
    nextReconcileAt: "2026-03-17T13:00:00.000Z",
  });
  store.upsertAccount({
    provider: "unsupported",
    externalAccountId: "unsupported-1",
    displayName: "Unsupported",
    scopes: ["offline"],
    tokens: {
      accessToken: "unsupported-access",
      accessTokenEncrypted: "enc:unsupported-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
    nextReconcileAt: "2026-03-17T11:00:00.000Z",
  });
  const disconnected = store.upsertAccount({
    provider: "scheduled",
    externalAccountId: "scheduled-disconnected",
    displayName: "Disconnected",
    status: "disconnected",
    scopes: ["offline"],
    tokens: {
      accessToken: "disconnected-access",
      accessTokenEncrypted: "enc:disconnected-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
    nextReconcileAt: "2026-03-17T11:00:00.000Z",
  });

  await service.runSchedulerOnce();

  const scheduledJobs = listJobKindsForAccountForTesting(store, dueActive.id);
  const unsupportedAccount = store.getAccountByExternalAccount("unsupported", "unsupported-1");
  assert.ok(unsupportedAccount);
  assert.deepEqual(scheduledJobs, ["scheduled-refresh"]);
  assert.equal(store.getAccountById(dueActive.id)?.nextReconcileAt, "2026-03-17T12:30:00.000Z");
  assert.equal(countJobsForAccountForTesting(store, unsupportedAccount.id), 0);
  assert.equal(countJobsForAccountForTesting(store, disconnected.id), 0);

  close();
});

test("device sync service scheduler logs failures once and skips reentrant ticks", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-scheduler-error");
  const schedulerErrors: Array<{ context?: Record<string, unknown>; message: string }> = [];
  let skipSchedulerTick = false;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        error(message, context) {
          schedulerErrors.push({
            message,
            context: context as Record<string, unknown> | undefined,
          });
        },
      },
    },
    schedulerMutex: createSkippingTickMutex(() => skipSchedulerTick),
    providers: [
      createFakeProvider({
        provider: "broken",
        descriptor: {
          ...createFakeProvider().descriptor,
          provider: "broken",
          displayName: "Broken",
          oauth: {
            callbackPath: "/oauth/broken/callback",
            defaultScopes: ["offline"],
          },
        },
        createScheduledJobs() {
          throw new Error("scheduler exploded");
        },
      }),
    ],
  });

  store.upsertAccount({
    provider: "broken",
    externalAccountId: "broken-1",
    displayName: "Broken",
    scopes: ["offline"],
    tokens: {
      accessToken: "broken-access",
      accessTokenEncrypted: "enc:broken-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
    nextReconcileAt: "2026-03-17T11:00:00.000Z",
  });

  await service.runSchedulerOnce();

  skipSchedulerTick = true;
  await service.runSchedulerOnce();
  assert.equal(schedulerErrors.length, 1);
  assert.deepEqual(schedulerErrors[0]?.context, {
    failureCode: "DEVICE_SYNC_SCHEDULER_TICK_FAILED",
    error: {
      category: "unexpected_error",
      name: "Error",
      message: "scheduler exploded",
    },
  });

  close();
});

test("device sync service worker batch logs drain failures once and skips reentrant ticks", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-worker-batch-error");
  const workerErrors: Array<{ context?: Record<string, unknown>; message: string }> = [];
  let workerErrorLoggedResolve: (() => void) | null = null;
  const workerErrorLogged = new Promise<void>((resolve) => {
    workerErrorLoggedResolve = resolve;
  });
  let drainCalls = 0;
  const drainLimits: number[] = [];
  const failingWorkerExecutor: DeviceSyncWorkerExecutor = {
    async drainWorker(limit) {
      drainCalls += 1;
      drainLimits.push(limit);
      throw new Error("worker batch exploded");
    },
  };
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      workerBatchSize: 7,
      log: {
        error(message, context) {
          workerErrors.push({
            message,
            context: context as Record<string, unknown> | undefined,
          });
          workerErrorLoggedResolve?.();
        },
      },
    },
    workerExecutor: failingWorkerExecutor,
    providers: [createFakeProvider()],
  });

  service.start();
  await workerErrorLogged;
  assert.equal(drainCalls, 1);
  assert.deepEqual(drainLimits, [7]);
  assert.equal(workerErrors.length, 1);
  assert.equal(workerErrors[0]?.message, "Device sync worker tick failed.");
  assert.deepEqual(workerErrors[0]?.context, {
    failureCode: "DEVICE_SYNC_WORKER_TICK_FAILED",
    error: {
      category: "unexpected_error",
      name: "Error",
      message: "worker batch exploded",
    },
  });
  close();

  const skippedVaultRoot = await makeTempDirectory("murph-device-syncd-worker-batch-skip");
  let skippedDrainCalls = 0;
  const skipped = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot: skippedVaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(skippedVaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    workerMutex: createSkippingTickMutex(() => true),
    workerExecutor: {
      async drainWorker() {
        skippedDrainCalls += 1;
        return 0;
      },
    },
    providers: [createFakeProvider()],
  });

  skipped.service.start();
  await Promise.resolve();
  assert.equal(skippedDrainCalls, 0);
  skipped.close();
});

test("device sync service worker handles missing providers, disconnected jobs, and reauthorization-required jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-worker-edges");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [createFakeProvider()],
  });

  const queuedAccount = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-worker-edges",
    displayName: "Demo",
    scopes: ["offline"],
    tokens: {
      accessToken: "demo-access",
      accessTokenEncrypted: "enc:demo-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });

  const missingProviderJob = store.enqueueJob({
    accountId: queuedAccount.id,
    provider: "missing-provider",
    kind: "sync",
    payload: {},
    availableAt: "2026-03-17T10:00:00.000Z",
  });
  await service.runWorkerOnce();
  assert.equal(store.getJobById(missingProviderJob.id)?.status, "dead");
  assert.equal(store.getJobById(missingProviderJob.id)?.lastErrorCode, "PROVIDER_NOT_REGISTERED");

  store.patchAccount(queuedAccount.id, {
    status: "disconnected",
  });
  const disconnectedJob = store.enqueueJob({
    accountId: queuedAccount.id,
    provider: "demo",
    kind: "sync",
    payload: {},
    availableAt: "2026-03-17T10:00:01.000Z",
  });
  await service.runWorkerOnce();
  assert.equal(store.getJobById(disconnectedJob.id)?.status, "succeeded");

  const reauthAccount = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-worker-reauth",
    displayName: "Demo Reauth",
    status: "reauthorization_required",
    scopes: ["offline"],
    tokens: {
      accessToken: "reauth-access",
      accessTokenEncrypted: "enc:reauth-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const reauthJob = store.enqueueJob({
    accountId: reauthAccount.id,
    provider: "demo",
    kind: "sync",
    payload: {},
    availableAt: "2026-03-17T10:00:02.000Z",
  });
  const reauthFollowupJob = store.enqueueJob({
    accountId: reauthAccount.id,
    provider: "demo",
    kind: "sync-followup",
    payload: {},
    availableAt: "2026-03-17T10:00:02.000Z",
  });
  await service.runWorkerOnce();
  assert.equal(store.getJobById(reauthJob.id)?.status, "dead");
  assert.equal(store.getJobById(reauthJob.id)?.lastErrorCode, "ACCOUNT_REAUTHORIZATION_REQUIRED");
  assert.equal(store.getJobById(reauthFollowupJob.id)?.status, "dead");
  assert.equal(store.getJobById(reauthFollowupJob.id)?.lastErrorCode, "ACCOUNT_REAUTHORIZATION_REQUIRED");

  close();
});

test("device sync service preserves scheduler-owned reconcile cursor when job result omits it", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-preserve-reconcile");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob(_context, job) {
          if (job.payload.clearNextReconcileAt === true) {
            return {
              nextReconcileAt: null,
            };
          }

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
    code: "preserve-reconcile",
  });

  const initialNextReconcileAt = "2026-03-17T12:00:00.000Z";
  assert.equal(store.getAccountById(connected.account.id)?.nextReconcileAt, initialNextReconcileAt);

  const processedBackfill = await service.runWorkerOnce();
  assert.equal(processedBackfill?.kind, "backfill");
  assert.equal(store.getAccountById(connected.account.id)?.nextReconcileAt, initialNextReconcileAt);

  store.enqueueJob({
    accountId: connected.account.id,
    provider: "demo",
    kind: "manual-clear",
    payload: {
      clearNextReconcileAt: true,
    },
    availableAt: "2026-03-17T10:00:00.000Z",
  });

  const processedClear = await service.runWorkerOnce();
  assert.equal(processedClear?.kind, "manual-clear");
  assert.equal(store.getAccountById(connected.account.id)?.nextReconcileAt, null);

  close();
});

test("device sync service lets providers execute compatible due jobs as one bounded batch", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-batch");
  const batchCalls: string[][] = [];
  const singleCalls: string[] = [];
  const imports: unknown[] = [];
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input.snapshot);
      return { ok: true };
    },
  };
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    importer,
    providers: [
      createFakeProvider({
        describeJobBatch(job) {
          const group = typeof job.payload.group === "string" ? job.payload.group : null;
          const estimatedBytes = typeof job.payload.estimatedBytes === "number" ? job.payload.estimatedBytes : 5;
          return job.kind === "resource" && group
            ? { key: `resource:${group}`, estimatedBytes }
            : null;
        },
        maxJobBatchEstimatedBytes: 16,
        maxJobBatchSize: 3,
        async executeJob(context, job) {
          singleCalls.push(String(job.payload.label));
          await context.importSnapshot({ single: job.payload.label });
          return {};
        },
        async executeJobBatch(context, jobs) {
          batchCalls.push(jobs.map((job) => String(job.payload.label)));
          await context.importSnapshot({
            batch: jobs.map((job) => job.payload.label),
          });
          return {
            nextReconcileAt: "2026-03-18T12:00:00.000Z",
          };
        },
      }),
    ],
  });

  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch",
    displayName: "Demo Provider Batch",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-access",
      accessTokenEncrypted: encryptStoredAccessToken("demo", "demo-provider-batch", "batch-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const otherAccount = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch-other",
    displayName: "Demo Provider Batch Other",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-other-access",
      accessTokenEncrypted: encryptStoredAccessToken("demo", "demo-provider-batch-other", "batch-other-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const first = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "first" },
    availableAt: "2026-03-17T10:00:00.000Z",
  });
  const second = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "second" },
    availableAt: "2026-03-17T10:00:01.000Z",
  });
  const third = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "third" },
    availableAt: "2026-03-17T10:00:02.000Z",
  });
  const cappedByBytes = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "capped-by-bytes" },
    availableAt: "2026-03-17T10:00:03.000Z",
  });
  const laterCompatibleAfterByteBarrier = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { estimatedBytes: 1, group: "activity", label: "later-compatible-after-byte-barrier" },
    availableAt: "2026-03-17T10:00:04.000Z",
  });
  const incompatible = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "sleep", label: "incompatible" },
    availableAt: "2026-03-17T10:00:05.000Z",
  });
  const otherAccountJob = store.enqueueJob({
    accountId: otherAccount.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "other-account" },
    availableAt: "2026-03-17T10:00:06.000Z",
  });

  const processed = await service.runWorkerOnce();

  assert.equal(processed?.id, first.id);
  assert.deepEqual(batchCalls, [["first", "second", "third"]]);
  assert.deepEqual(singleCalls, []);
  assert.deepEqual(imports, [{ batch: ["first", "second", "third"] }]);
  assert.equal(store.getJobById(first.id)?.status, "succeeded");
  assert.equal(store.getJobById(second.id)?.status, "succeeded");
  assert.equal(store.getJobById(third.id)?.status, "succeeded");
  assert.equal(store.getJobById(cappedByBytes.id)?.status, "queued");
  assert.equal(store.getJobById(laterCompatibleAfterByteBarrier.id)?.status, "queued");
  assert.equal(store.getJobById(incompatible.id)?.status, "queued");
  assert.equal(store.getJobById(otherAccountJob.id)?.status, "queued");
  assert.equal(store.getAccountById(account.id)?.nextReconcileAt, "2026-03-18T12:00:00.000Z");

  close();
});

test("device sync service counts provider batch rows against drainWorker limits", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-batch-drain");
  const batchCalls: string[][] = [];
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        describeJobBatch(job) {
          return job.kind === "resource" && job.payload.group === "activity"
            ? { key: "resource:activity", estimatedBytes: 1 }
            : null;
        },
        maxJobBatchSize: 3,
        async executeJobBatch(_context, jobs) {
          batchCalls.push(jobs.map((job) => String(job.payload.label)));
          return {};
        },
      }),
    ],
  });
  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch-drain",
    displayName: "Demo Provider Batch Drain",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-drain-access",
      accessTokenEncrypted: encryptStoredAccessToken("demo", "demo-provider-batch-drain", "batch-drain-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const first = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "first" },
    availableAt: "2026-03-17T10:00:00.000Z",
  });
  const second = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "second" },
    availableAt: "2026-03-17T10:00:01.000Z",
  });
  const third = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "third" },
    availableAt: "2026-03-17T10:00:02.000Z",
  });
  const fourth = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "fourth" },
    availableAt: "2026-03-17T10:00:03.000Z",
  });

  const processedRows = await service.drainWorker(2);

  assert.equal(processedRows, 2);
  assert.deepEqual(batchCalls, [["first", "second"]]);
  assert.equal(store.getJobById(first.id)?.status, "succeeded");
  assert.equal(store.getJobById(second.id)?.status, "succeeded");
  assert.equal(store.getJobById(third.id)?.status, "queued");
  assert.equal(store.getJobById(fourth.id)?.status, "queued");

  close();
});

test("device sync service reclaims expired running batch candidates in due order", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-batch-expired-running");
  const batchCalls: string[][] = [];
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        describeJobBatch(job) {
          return job.kind === "resource" && job.payload.group === "activity"
            ? { key: "resource:activity", estimatedBytes: 1 }
            : null;
        },
        maxJobBatchSize: 3,
        async executeJobBatch(_context, jobs) {
          batchCalls.push(jobs.map((job) => String(job.payload.label)));
          return {};
        },
      }),
    ],
  });
  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch-expired-running",
    displayName: "Demo Provider Batch Expired Running",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-expired-access",
      accessTokenEncrypted: encryptStoredAccessToken("demo", "demo-provider-batch-expired-running", "batch-expired-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const first = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "first" },
    availableAt: "2026-03-17T10:00:00.000Z",
  });
  const second = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "second" },
    availableAt: "2026-03-17T10:00:01.000Z",
  });
  const third = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "third" },
    availableAt: "2026-03-17T10:00:02.000Z",
  });
  const staleNow = "2026-03-17T10:01:00.000Z";
  const staleSeed = store.claimDueJob("stale-worker", staleNow, 60_000);

  assert.equal(staleSeed?.id, first.id);
  assert.deepEqual(
    store.claimJobBatchCandidatesIfSeedOwned({
      accountId: account.id,
      jobIds: [second.id],
      leaseMs: 60_000,
      now: staleNow,
      provider: "demo",
      seedJobId: first.id,
      workerId: "stale-worker",
    }).map((job) => job.id),
    [second.id],
  );

  const expiredLeaseAt = "2026-03-17T10:00:30.000Z";
  expireJobLeaseForTesting(store, first.id, expiredLeaseAt);
  expireJobLeaseForTesting(store, second.id, expiredLeaseAt);

  const processed = await service.runWorkerOnce();

  assert.equal(processed?.id, first.id);
  assert.deepEqual(batchCalls, [["first", "second", "third"]]);
  assert.equal(store.getJobById(first.id)?.status, "succeeded");
  assert.equal(store.getJobById(second.id)?.status, "succeeded");
  assert.equal(store.getJobById(third.id)?.status, "succeeded");
  assert.equal(store.getJobById(first.id)?.attempts, 2);
  assert.equal(store.getJobById(second.id)?.attempts, 2);
  assert.equal(store.getJobById(third.id)?.attempts, 1);

  close();
});

test("device sync service preserves per-job retry backoff when a provider batch fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-batch-retry");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        describeJobBatch(job) {
          return job.kind === "resource" && job.payload.group === "activity"
            ? { key: "resource:activity", estimatedBytes: 1 }
            : null;
        },
        maxJobBatchSize: 2,
        async executeJobBatch() {
          throw deviceSyncError({
            code: "BATCH_RETRY",
            message: "Batch retry requested.",
            httpStatus: 503,
            retryable: true,
          });
        },
      }),
    ],
  });
  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch-retry",
    displayName: "Demo Provider Batch Retry",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-retry-access",
      accessTokenEncrypted: encryptStoredAccessToken("demo", "demo-provider-batch-retry", "batch-retry-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const first = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "first" },
    availableAt: "2026-03-17T10:00:00.000Z",
  });
  const retried = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "retried" },
    availableAt: "2026-03-17T10:00:01.000Z",
  });
  setJobAttemptsForTesting(store, retried.id, 3);

  const processed = await service.runWorkerOnce();

  assert.equal(processed?.id, first.id);
  const firstAfter = store.getJobById(first.id);
  const retriedAfter = store.getJobById(retried.id);
  assert.equal(firstAfter?.status, "queued");
  assert.equal(retriedAfter?.status, "queued");
  assert.equal(firstAfter?.attempts, 1);
  assert.equal(retriedAfter?.attempts, 4);
  assert.equal(firstAfter?.lastErrorCode, "BATCH_RETRY");
  assert.equal(retriedAfter?.lastErrorCode, "BATCH_RETRY");
  assert.equal(
    Date.parse(retriedAfter?.availableAt ?? "") - Date.parse(firstAfter?.availableAt ?? ""),
    (30 * 60_000) - 15_000,
  );

  close();
});

test("device sync service falls back to single-job execution when seed batch description throws", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-batch-seed-describe-error");
  const debugLog = vi.fn();
  const singleCalls: string[] = [];
  let batchCalls = 0;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        debug: debugLog,
      },
    },
    providers: [
      createFakeProvider({
        describeJobBatch() {
          throw new Error("descriptor exploded");
        },
        async executeJob(_context, job) {
          singleCalls.push(String(job.payload.label));
          return {};
        },
        async executeJobBatch() {
          batchCalls += 1;
          return {};
        },
      }),
    ],
  });
  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch-seed-describe-error",
    displayName: "Demo Provider Batch Seed Describe Error",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-seed-describe-error-access",
      accessTokenEncrypted: encryptStoredAccessToken(
        "demo",
        "demo-provider-batch-seed-describe-error",
        "batch-seed-describe-error-access",
      ),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const first = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "first" },
    availableAt: "2026-03-17T10:00:00.000Z",
  });

  const processed = await service.runWorkerOnce();

  assert.equal(processed?.id, first.id);
  assert.deepEqual(singleCalls, ["first"]);
  assert.equal(batchCalls, 0);
  assert.equal(store.getJobById(first.id)?.status, "succeeded");
  expect(debugLog).toHaveBeenCalledWith(
    "Device sync provider batch descriptor failed; using single-job fallback.",
    expect.objectContaining({
      jobId: first.id,
      provider: "demo",
      role: "seed",
    }),
  );

  close();
});

test("device sync service treats batch candidate description failures as order barriers", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-batch-candidate-describe-error");
  const debugLog = vi.fn();
  const batchCalls: string[][] = [];
  const singleCalls: string[] = [];
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        debug: debugLog,
      },
    },
    providers: [
      createFakeProvider({
        describeJobBatch(job) {
          if (job.payload.label === "bad-candidate") {
            throw new Error("candidate descriptor exploded");
          }

          return job.kind === "resource" && job.payload.group === "activity"
            ? { key: "resource:activity", estimatedBytes: 1 }
            : null;
        },
        maxJobBatchSize: 3,
        async executeJob(_context, job) {
          singleCalls.push(String(job.payload.label));
          return {};
        },
        async executeJobBatch(_context, jobs) {
          batchCalls.push(jobs.map((job) => String(job.payload.label)));
          return {};
        },
      }),
    ],
  });
  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch-candidate-describe-error",
    displayName: "Demo Provider Batch Candidate Describe Error",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-candidate-describe-error-access",
      accessTokenEncrypted: encryptStoredAccessToken(
        "demo",
        "demo-provider-batch-candidate-describe-error",
        "batch-candidate-describe-error-access",
      ),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const first = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "first" },
    availableAt: "2026-03-17T10:00:00.000Z",
  });
  const badCandidate = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "bad-candidate" },
    availableAt: "2026-03-17T10:00:01.000Z",
  });
  const third = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "third" },
    availableAt: "2026-03-17T10:00:02.000Z",
  });

  const processed = await service.runWorkerOnce();

  assert.equal(processed?.id, first.id);
  assert.deepEqual(singleCalls, ["first"]);
  assert.deepEqual(batchCalls, []);
  assert.equal(store.getJobById(first.id)?.status, "succeeded");
  assert.equal(store.getJobById(badCandidate.id)?.status, "queued");
  assert.equal(store.getJobById(third.id)?.status, "queued");
  expect(debugLog).toHaveBeenCalledWith(
    "Device sync provider batch descriptor failed; using single-job fallback.",
    expect.objectContaining({
      jobId: badCandidate.id,
      provider: "demo",
      role: "candidate",
    }),
  );

  close();
});

test("device sync service falls back to single-job execution when no compatible batch exists", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-batch-fallback");
  let batchCalls = 0;
  const singleCalls: string[] = [];
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        describeJobBatch(job) {
          return job.kind === "resource" && typeof job.payload.group === "string"
            ? { key: `resource:${job.payload.group}`, estimatedBytes: 1 }
            : null;
        },
        async executeJob(context, job) {
          singleCalls.push(String(job.payload.label));
          return {};
        },
        async executeJobBatch() {
          batchCalls += 1;
          return {};
        },
      }),
    ],
  });

  const account = store.upsertAccount({
    provider: "demo",
    externalAccountId: "demo-provider-batch-fallback",
    displayName: "Demo Provider Batch Fallback",
    scopes: ["read:data"],
    tokens: {
      accessToken: "batch-fallback-access",
      accessTokenEncrypted: encryptStoredAccessToken("demo", "demo-provider-batch-fallback", "batch-fallback-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const first = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "first" },
    availableAt: "2026-03-17T10:00:00.000Z",
  });
  const incompatible = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "sleep", label: "incompatible" },
    availableAt: "2026-03-17T10:00:01.000Z",
  });
  const laterCompatible = store.enqueueJob({
    accountId: account.id,
    provider: "demo",
    kind: "resource",
    payload: { group: "activity", label: "later-compatible" },
    availableAt: "2026-03-17T10:00:02.000Z",
  });

  const processed = await service.runWorkerOnce();

  assert.equal(processed?.id, first.id);
  assert.equal(batchCalls, 0);
  assert.deepEqual(singleCalls, ["first"]);
  assert.equal(store.getJobById(first.id)?.status, "succeeded");
  assert.equal(store.getJobById(incompatible.id)?.status, "queued");
  assert.equal(store.getJobById(laterCompatible.id)?.status, "queued");

  close();
});

test("device sync service treats token refresh races as cancelled work instead of provider failures", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-refresh-cancel");
  const debugEvents: Array<{ context?: Record<string, unknown>; message: string }> = [];
  let refreshStartedResolve: (() => void) | null = null;
  let releaseRefreshResolve: (() => void) | null = null;
  const refreshStarted = new Promise<void>((resolve) => {
    refreshStartedResolve = resolve;
  });
  const releaseRefresh = new Promise<void>((resolve) => {
    releaseRefreshResolve = resolve;
  });
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        debug(message, context) {
          debugEvents.push({
            message,
            context: context as Record<string, unknown> | undefined,
          });
        },
      },
    },
    providers: [
      createFakeProvider({
        async refreshTokens(_account: DeviceSyncAccount): Promise<ProviderAuthTokens> {
          refreshStartedResolve?.();
          await releaseRefresh;
          return {
            accessToken: "refresh-access",
            refreshToken: "refresh-refresh",
          };
        },
        async executeJob(context) {
          await context.refreshAccountTokens();
          return {
            metadataPatch: {
              shouldNotPersist: true,
            },
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
    code: "cancelled",
  });

  const workerPromise = service.runWorkerOnce();
  await refreshStarted;
  await service.disconnectAccount(connected.account.id);
  requireCallback(releaseRefreshResolve, "refresh release callback was not initialized")();
  const processedJob = await workerPromise;

  assert.equal(processedJob?.kind, "backfill");
  assert.equal(store.getAccountById(connected.account.id)?.status, "disconnected");
  assert.equal(store.getAccountById(connected.account.id)?.lastErrorCode, null);
  assert.equal(store.getJobById(processedJob!.id)?.status, "dead");
  assert.equal(store.getJobById(processedJob!.id)?.lastErrorCode, "ACCOUNT_DISCONNECTED");
  assert.equal(debugEvents.length, 1);
  assert.equal(debugEvents[0]?.message, "Device sync job side effects skipped because execution was cancelled.");
  assert.deepEqual(debugEvents[0]?.context, {
    provider: "demo",
    accountId: connected.account.id,
    jobId: processedJob!.id,
  });

  close();
});

test("device sync service aborts and releases provider jobs when foreground work should yield", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-job-yield");
  const imports: unknown[] = [];
  let yieldRequested = false;
  let executionCount = 0;
  let providerStartedResolve: (() => void) | null = null;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input);
      return {
        ok: true,
      };
    },
  };
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      shouldYieldJobExecution: () => yieldRequested,
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          executionCount += 1;

          if (executionCount === 1) {
            assert.ok(context.signal);
            providerStartedResolve?.();
            await new Promise<void>((_resolve, reject) => {
              const abortTimeout = setTimeout(
                () => reject(new Error("provider job was not aborted")),
                1_000,
              );
              context.signal?.addEventListener("abort", () => {
                clearTimeout(abortTimeout);
                reject(context.signal?.reason ?? new Error("provider job aborted"));
              }, { once: true });
            });
          }

          await context.importSnapshot({
            accountId: context.account.externalAccountId,
            importedAt: context.now,
          });
          return {};
        },
      }),
    ],
    importer,
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "yield",
    });

    const workerPromise = service.runWorkerOnce();
    await providerStarted;
    yieldRequested = true;
    const yieldedJob = await workerPromise;

    assert.equal(yieldedJob?.kind, "backfill");
    assert.equal(executionCount, 1);
    assert.equal(imports.length, 0);
    assert.deepEqual(service.listJobFailureDiagnostics(), []);

    const releasedJob = yieldedJob ? store.getJobById(yieldedJob.id) : null;
    assert.equal(releasedJob?.status, "queued");
    assert.equal(releasedJob?.leaseOwner, null);
    assert.equal(releasedJob?.leaseExpiresAt, null);
    assert.equal(releasedJob?.attempts, 0);

    yieldRequested = false;
    const completedJob = await service.runWorkerOnce();

    assert.equal(completedJob?.id, yieldedJob?.id);
    assert.equal(executionCount, 2);
    assert.equal(imports.length, 1);
    assert.equal(store.getJobById(completedJob!.id)?.status, "succeeded");
  } finally {
    close();
  }
});

test("device sync service persists refreshed tokens before yielding provider jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-refresh-yield");
  const imports: unknown[] = [];
  let yieldRequested = false;
  let executionCount = 0;
  let refreshCalls = 0;
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input);
      return {
        ok: true,
      };
    },
  };
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      shouldYieldJobExecution: () => yieldRequested,
    },
    providers: [
      createFakeProvider({
        async refreshTokens(_account, options): Promise<ProviderAuthTokens> {
          assert.equal(options?.signal ?? null, null);
          refreshCalls += 1;
          yieldRequested = true;
          return {
            accessToken: "rotated-access-token",
            refreshToken: "rotated-refresh-token",
          };
        },
        async executeJob(context) {
          executionCount += 1;

          if (executionCount === 1) {
            await context.refreshAccountTokens();
            throw new Error("refresh should yield after persisting rotated tokens");
          }

          assert.equal(readAccountAccessTokenForTesting(context.account), "rotated-access-token");
          await context.importSnapshot({
            accountId: context.account.externalAccountId,
            importedAt: context.now,
          });
          return {};
        },
      }),
    ],
    importer,
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "refresh-yield",
    });

    const yieldedJob = await service.runWorkerOnce();

    assert.equal(yieldedJob?.kind, "backfill");
    assert.equal(executionCount, 1);
    assert.equal(refreshCalls, 1);
    assert.equal(imports.length, 0);
    assert.deepEqual(service.listJobFailureDiagnostics(), []);
    assert.equal(store.getJobById(yieldedJob!.id)?.status, "queued");

    yieldRequested = false;
    const completedJob = await service.runWorkerOnce();

    assert.equal(completedJob?.id, yieldedJob?.id);
    assert.equal(executionCount, 2);
    assert.equal(refreshCalls, 1);
    assert.equal(imports.length, 1);
    assert.equal(store.getJobById(completedJob!.id)?.status, "succeeded");
  } finally {
    close();
  }
});

test("device sync service records provider failures even when the job signal has yielded", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-yielded-provider-failure");
  let yieldRequested = false;
  let providerStartedResolve: (() => void) | null = null;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      shouldYieldJobExecution: () => yieldRequested,
      log: {
        warn() {
          // The provider failure is asserted through durable job state below.
        },
      },
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          assert.ok(context.signal);
          providerStartedResolve?.();
          await new Promise<void>((resolve, reject) => {
            const abortTimeout = setTimeout(
              () => reject(new Error("provider job was not yielded")),
              1_000,
            );
            context.signal?.addEventListener("abort", () => {
              clearTimeout(abortTimeout);
              resolve();
            }, { once: true });
          });
          throw new DOMException("Provider cancelled independently after yield.", "AbortError");
        },
      }),
    ],
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "yielded-failure",
    });

    const workerPromise = service.runWorkerOnce();
    await providerStarted;
    yieldRequested = true;
    const processedJob = await workerPromise;

    assert.equal(processedJob?.kind, "backfill");
    assert.equal(store.getJobById(processedJob!.id)?.status, "dead");
    assert.equal(store.getJobById(processedJob!.id)?.lastErrorCode, "SYNC_JOB_FAILED");
    assert.equal(service.listJobFailureDiagnostics()[0]?.details.failureErrorName, "AbortError");
  } finally {
    close();
  }
});

test("device sync service preserves provider-level yield job results", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-yield-result");
  let yieldRequested = false;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      shouldYieldJobExecution: () => yieldRequested,
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          yieldRequested = true;
          assert.equal(context.shouldYield?.(), true);
          return {
            nextReconcileAt: "2026-03-18T00:00:00.000Z",
            scheduledJobs: [
              {
                kind: "backfill",
                payload: {
                  windowStart: "2026-03-16T00:00:00.000Z",
                },
              },
            ],
          };
        },
      }),
    ],
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    const connected = await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "provider-yield-result",
    });

    const processedJob = await service.runWorkerOnce();
    const jobs = readJobsForAccountForTesting(store, connected.account.id);
    const queuedJob = jobs.find((candidate) => candidate.id !== processedJob?.id);

    assert.equal(processedJob?.kind, "backfill");
    assert.equal(jobs.length, 2);
    assert.equal(store.getJobById(processedJob!.id)?.status, "succeeded");
    assert.equal(queuedJob?.status, "queued");
    assert.deepEqual(store.getJobById(queuedJob!.id)?.payload, {
      windowStart: "2026-03-16T00:00:00.000Z",
    });
    assert.equal(store.getAccountById(connected.account.id)?.nextReconcileAt, "2026-03-18T00:00:00.000Z");
  } finally {
    close();
  }
});

test("device sync service rolls back job success when scheduled follow-up enqueue fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-follow-up-enqueue-rollback");
  const circularPayload: Record<string, unknown> = {};
  circularPayload.self = circularPayload;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn() {
          // The rollback is asserted through durable job/account state below.
        },
      },
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          return {
            nextReconcileAt: "2026-03-19T00:00:00.000Z",
            scheduledJobs: [
              {
                kind: "backfill",
                payload: circularPayload,
              },
            ],
          };
        },
      }),
    ],
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    const connected = await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "enqueue-rollback",
    });
    const beforeWorker = store.getAccountById(connected.account.id);

    const processedJob = await service.runWorkerOnce();
    const jobs = readJobsForAccountForTesting(store, connected.account.id);
    const afterWorker = store.getAccountById(connected.account.id);
    const failedJob = store.getJobById(processedJob!.id);

    assert.equal(processedJob?.kind, "backfill");
    assert.equal(jobs.length, 1);
    assert.equal(failedJob?.status, "dead");
    assert.equal(failedJob?.lastErrorCode, "SYNC_JOB_FAILED");
    assert.equal(afterWorker?.lastSyncCompletedAt, beforeWorker?.lastSyncCompletedAt);
    assert.equal(afterWorker?.nextReconcileAt, beforeWorker?.nextReconcileAt);
    assert.equal(afterWorker?.lastErrorCode, "SYNC_JOB_FAILED");
  } finally {
    close();
  }
});

test("device sync worker skips claims while foreground work should yield", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-persistent-yield");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      shouldYieldJobExecution: () => true,
    },
    providers: [createFakeProvider()],
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    const connected = await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "persistent-yield",
    });

    assert.equal(await service.runWorkerOnce(), null);
    assert.equal(await service.drainWorker(5), 0);

    const jobs = readJobsForAccountForTesting(store, connected.account.id);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.status, "queued");
    assert.equal(jobs[0]?.attempts, 0);
  } finally {
    close();
  }
});

test("device sync service dead-letters provider-driven disconnect jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-disconnect");
  const debugEvents: Array<{ context?: Record<string, unknown>; message: string }> = [];
  const imports: unknown[] = [];
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push(input);
      return {
        ok: true,
      };
    },
  };
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        debug(message, context) {
          debugEvents.push({
            message,
            context: context as Record<string, unknown> | undefined,
          });
        },
      },
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          await context.disconnectAccount?.();
          return {
            metadataPatch: {
              shouldNotPersist: true,
            },
            nextReconcileAt: "2026-03-19T00:00:00.000Z",
            scheduledJobs: [
              {
                kind: "follow-up",
                dedupeKey: `follow-up:${context.account.id}`,
              },
            ],
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
    code: "provider-disconnect",
  });
  const processedJob = await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const storedJob = processedJob ? store.getJobById(processedJob.id) : null;

  assert.equal(processedJob?.kind, "backfill");
  assert.ok(storedAccount);
  assert.equal(storedAccount?.status, "disconnected");
  assert.deepEqual(storedAccount?.metadata, {
    connectedBy: "provider-disconnect",
  });
  assert.equal(storedAccount?.nextReconcileAt, null);
  assert.equal(storedJob?.status, "dead");
  assert.equal(storedJob?.lastErrorCode, "ACCOUNT_DISCONNECTED");
  assert.equal(service.summarize().jobsQueued, 0);
  assert.equal(service.summarize().jobsRunning, 0);
  assert.equal(service.summarize().jobsDead, 1);
  assert.equal(imports.length, 0);
  assert.equal(debugEvents.length, 1);
  assert.equal(debugEvents[0]?.message, "Device sync job side effects skipped because execution was cancelled.");
  assert.deepEqual(debugEvents[0]?.context, {
    provider: "demo",
    accountId: connected.account.id,
    jobId: processedJob!.id,
  });

  close();
});

test("device sync service accepts legacy Oura resource jobs that fall back without a dataType", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-oura-legacy-resource-job");
  let seenPayload: Record<string, unknown> | null = null;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        provider: "oura",
        async executeJob(_context, job) {
          seenPayload = { ...job.payload };
          return {};
        },
      }),
    ],
  });

  const account = store.upsertAccount({
    provider: "oura",
    externalAccountId: "oura-legacy",
    displayName: "Oura Legacy",
    scopes: ["personal"],
    tokens: {
      accessToken: "oura-access",
      accessTokenEncrypted: encryptStoredAccessToken("oura", "oura-legacy", "oura-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const job = store.enqueueJob({
    accountId: account.id,
    provider: "oura",
    kind: "resource",
    payload: {
      objectId: "missing-data-type",
    },
    availableAt: "2026-03-17T10:00:00.000Z",
  });

  const processedJob = await service.runWorkerOnce();

  assert.equal(processedJob?.id, job.id);
  if (!seenPayload) {
    assert.fail("Expected the Oura legacy resource job to reach provider execution.");
  }
  assert.deepEqual(seenPayload, {
    objectId: "missing-data-type",
  });
  assert.equal(store.getJobById(job.id)?.status, "succeeded");

  close();
});

test("device sync service accepts legacy Strava delete jobs that rely on the default resource type", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-strava-legacy-delete-job");
  let seenPayload: Record<string, unknown> | null = null;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        provider: "strava",
        async executeJob(_context, job) {
          seenPayload = { ...job.payload };
          return {};
        },
      }),
    ],
  });

  const account = store.upsertAccount({
    provider: "strava",
    externalAccountId: "strava-legacy",
    displayName: "Strava Legacy",
    scopes: ["activity:read"],
    tokens: {
      accessToken: "strava-access",
      accessTokenEncrypted: encryptStoredAccessToken("strava", "strava-legacy", "strava-access"),
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });
  const job = store.enqueueJob({
    accountId: account.id,
    provider: "strava",
    kind: "delete",
    payload: {
      resourceId: "activity-123",
    },
    availableAt: "2026-03-17T10:00:00.000Z",
  });

  const processedJob = await service.runWorkerOnce();

  assert.equal(processedJob?.id, job.id);
  if (!seenPayload) {
    assert.fail("Expected the Strava legacy delete job to reach provider execution.");
  }
  assert.deepEqual(seenPayload, {
    resourceId: "activity-123",
  });
  assert.equal(store.getJobById(job.id)?.status, "succeeded");

  close();
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
    assertStoredCredentialKind(disconnected, "none");
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

test("device sync service accepts and dedupes disconnected-account webhooks while manual reconcile stays blocked", async () => {
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
    providers: [
      createFakeProvider({
        async verifyAndParseWebhook() {
          return {
            acceptanceMode: "durable_webhook_work",
            externalAccountId: "demo-xyz",
            eventType: "demo.updated",
            traceId: "trace-disconnected",
            jobs: [
              {
                kind: "resource",
                payload: {
                  resourceId: "resource-disconnected",
                },
              },
            ],
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
    code: "xyz",
  });

  await service.disconnectAccount(connected.account.id);

  assert.throws(
    () => service.queueManualReconcile(connected.account.id),
    /Disconnected device sync accounts must be reconnected/u,
  );

  const webhook = await service.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.deepEqual(webhook, {
    accepted: true,
    duplicate: false,
    eventType: "demo.updated",
    provider: "demo",
    traceId: scopeWebhookTraceId("demo", "demo-xyz", "trace-disconnected"),
  });

  const duplicate = await service.handleWebhook("demo", new Headers(), Buffer.from("{}"));
  assert.deepEqual(duplicate, {
    accepted: true,
    duplicate: true,
    eventType: "demo.updated",
    provider: "demo",
    traceId: scopeWebhookTraceId("demo", "demo-xyz", "trace-disconnected"),
  });

  const nextJob = await service.runWorkerOnce();
  assert.equal(nextJob, null);
  assert.equal(imports.length, 0);

  service.close();
});

test("device sync service rejects manual reconcile when the stored account provider is no longer registered", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-manual-missing-provider");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [],
  });

  const account = store.upsertAccount({
    provider: "missing-provider",
    externalAccountId: "missing-provider-account",
    displayName: "Missing Provider",
    scopes: ["offline"],
    tokens: {
      accessToken: "missing-provider-access",
      accessTokenEncrypted: "enc:missing-provider-access",
    },
    connectedAt: "2026-03-17T10:00:00.000Z",
  });

  assert.throws(
    () => service.queueManualReconcile(account.id),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "PROVIDER_NOT_REGISTERED"
      && error.httpStatus === 404,
  );

  close();
});

test("device sync service rejects manual reconcile for reauthorization-required accounts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-manual-reauthorize");
  const { service, store, close } = createServiceFixture({
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
    code: "reauthorize",
  });

  store.patchAccount(connected.account.id, {
    status: "reauthorization_required",
  });

  assert.throws(
    () => service.queueManualReconcile(connected.account.id),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "ACCOUNT_REAUTHORIZATION_REQUIRED"
      && error.httpStatus === 409,
  );

  close();
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
        descriptor: {
          provider: "polling",
          displayName: "Polling",
          transportModes: ["oauth_callback", "scheduled_poll"],
          oauth: {
            callbackPath: "/oauth/polling/callback",
            defaultScopes: ["personal", "daily"],
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
        verifyAndParseWebhook: undefined,
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
  const { service, store, close } = createServiceFixture({
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
  const firstClaim = store.claimDueJob("worker-a", now, 60_000);
  const secondClaim = store.claimDueJob("worker-b", now, 60_000);

  assert.equal(
    ["reconcile-summary", "reconcile-detail"].includes(firstClaim?.kind ?? ""),
    true,
  );
  assert.equal(secondClaim, null);

  store.completeJob(firstClaim!.id, now);

  const thirdClaim = store.claimDueJob("worker-b", now, 60_000);
  assert.deepEqual(
    new Set([firstClaim?.kind, thirdClaim?.kind]),
    new Set(["reconcile-summary", "reconcile-detail"]),
  );

  close();
});

test("manual reconcile boosts Junction reconcile priority without promoting historical backfill", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-manual-junction-backfill-priority");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    clock: {
      now: () => new Date("2026-04-03T12:34:56.000Z"),
    },
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createJunctionDeviceSyncProvider({
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        region: "us",
        summaryResources: ["activity"],
        timeseriesResources: [],
        fetchImpl: async (input) => {
          throw new Error(`Unexpected Junction request during manual queue test: ${readUrl(input)}`);
        },
      }),
    ],
  });

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-user-1",
      displayName: "Junction",
      scopes: [],
      status: "active",
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {},
      },
      connectedAt: "2026-04-01T00:00:00.000Z",
      nextReconcileAt: null,
    });

    const reconcile = service.queueManualReconcile(account.id);
    const queuedByKind = new Map(reconcile.jobs.map((job) => [job.kind, job]));

    assert.equal(queuedByKind.get("reconcile")?.priority, 80);
    assert.equal(queuedByKind.get("backfill")?.priority, 30);
    assert.deepEqual(queuedByKind.get("backfill")?.payload, {
      windowStart: "2025-10-03T00:00:00.000Z",
      windowEnd: "2026-04-01T00:00:00.000Z",
    });
  } finally {
    close();
  }
});

test("device sync service wakes Junction retrying historical backfill at the retry due time", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-junction-empty-backfill-wake");
  const executedAt = "2026-04-04T00:00:00.000Z";
  const retryDueAt = "2026-04-04T00:15:00.000Z";
  const hourlyReconcileAt = "2026-04-04T01:00:00.000Z";
  const ownerWindowStart = "2026-04-01T00:00:00.000Z";
  const ownerWindowEnd = "2026-04-03T00:00:00.000Z";
  let now = new Date(executedAt);
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    clock: {
      now: () => now,
    },
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createJunctionDeviceSyncProvider({
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        region: "us",
        reconcileIntervalMs: 60 * 60_000,
        summaryBackfillDays: 2,
        summaryResources: ["activity"],
        timeseriesResources: [],
        fetchImpl: async (input) => {
          const url = readUrl(input);

          if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
            return createJsonResponse({
              providers: [
                {
                  id: "provider-garmin-1",
                  slug: "garmin",
                  name: "Garmin",
                  status: "connected",
                  resource_availability: {
                    activity: true,
                  },
                },
              ],
            });
          }

          if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
            return createJsonResponse({ data: [] });
          }

          throw new Error(`Unexpected Junction request during empty backfill wake test: ${url}`);
        },
      }),
    ],
  });

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-user-1",
      displayName: "Junction",
      scopes: [],
      status: "active",
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {},
      },
      connectedAt: ownerWindowEnd,
      nextReconcileAt: null,
    });
    const expectedDedupeKey = createHash("sha256")
      .update(JSON.stringify(["junction", "backfill", ownerWindowStart, ownerWindowEnd]))
      .digest("hex");

    store.enqueueJob({
      accountId: account.id,
      provider: "junction",
      kind: "backfill",
      payload: {
        windowStart: ownerWindowStart,
        windowEnd: ownerWindowEnd,
      },
      availableAt: executedAt,
      priority: 30,
      dedupeKey: expectedDedupeKey,
    });

    const processedJob = await service.runWorkerOnce();
    assert.equal(processedJob?.kind, "backfill");

    const afterEmptyBackfill = store.getAccountById(account.id);
    assert.equal(afterEmptyBackfill?.metadata.junctionHistoricalBackfillStatus, "retrying");
    assert.equal(afterEmptyBackfill?.metadata.junctionHistoricalBackfillEmptyAttempts, 1);
    assert.equal(afterEmptyBackfill?.metadata.junctionHistoricalBackfillLastEmptyAt, executedAt);
    assert.equal(afterEmptyBackfill?.nextReconcileAt, retryDueAt);
    assert.notEqual(afterEmptyBackfill?.nextReconcileAt, hourlyReconcileAt);
    assert.equal(service.getNextWakeAt(executedAt), retryDueAt);

    now = new Date("2026-04-04T00:05:00.000Z");
    service.queueManualReconcile(account.id);
    const manualReconcile = await service.runWorkerOnce();
    const afterManualReconcile = store.getAccountById(account.id);

    assert.equal(manualReconcile?.kind, "reconcile");
    assert.equal(afterManualReconcile?.nextReconcileAt, retryDueAt);
    assert.notEqual(afterManualReconcile?.nextReconcileAt, "2026-04-04T01:05:00.000Z");
    assert.equal(service.getNextWakeAt("2026-04-04T00:05:00.000Z"), retryDueAt);

    now = new Date("2026-04-04T00:14:59.000Z");
    await service.runSchedulerOnce();
    assert.equal(
      readJobsForAccountForTesting(store, account.id).filter((job) =>
        job.kind === "backfill" && job.status === "queued"
      ).length,
      0,
    );

    now = new Date(retryDueAt);
    await service.runSchedulerOnce();
    const queuedBackfills = readJobsForAccountForTesting(store, account.id).filter((job) =>
      job.kind === "backfill" && job.status === "queued"
    );

    assert.equal(queuedBackfills.length, 1);
    const queuedBackfill = store.getJobById(queuedBackfills[0]!.id);
    assert.ok(queuedBackfill);
    assert.deepEqual(queuedBackfill.payload, {
      windowStart: ownerWindowStart,
      windowEnd: ownerWindowEnd,
    });
    assert.equal(queuedBackfill.dedupeKey, expectedDedupeKey);
    assert.equal(store.getAccountById(account.id)?.nextReconcileAt, "2026-04-04T01:15:00.000Z");
  } finally {
    close();
  }
});

test("device sync service stores Junction non-connect empty backfill retry attempts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-junction-non-connect-empty-retry");
  const executedAt = "2026-04-04T00:00:00.000Z";
  const retryDueAt = "2026-04-04T00:15:00.000Z";
  const ownerWindowStart = "2026-04-02T00:00:00.000Z";
  const ownerWindowEnd = "2026-04-03T00:00:00.000Z";
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    clock: {
      now: () => new Date(executedAt),
    },
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createJunctionDeviceSyncProvider({
        apiKey: "sk_us_fake_test_placeholder",
        clientUserIdSecret: "test-only-hmac-secret",
        environment: "sandbox",
        region: "us",
        reconcileIntervalMs: 60 * 60_000,
        summaryBackfillDays: 2,
        summaryResources: ["activity"],
        timeseriesResources: [],
        fetchImpl: async (input) => {
          const url = new URL(readUrl(input));

          if (url.pathname === "/v2/user/providers/junction-account") {
            return createJsonResponse({
              providers: [
                {
                  id: "provider-garmin-1",
                  slug: "garmin",
                  status: "connected",
                  resource_availability: {
                    activity: true,
                  },
                },
              ],
            });
          }

          if (url.pathname === "/v2/summary/activity/junction-account") {
            return createJsonResponse({ data: [] });
          }

          throw new Error(`Unexpected Junction request during non-connect retry test: ${url.pathname}`);
        },
      }),
    ],
  });

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-account",
      displayName: "Junction",
      scopes: [],
      status: "active",
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {},
      },
      connectedAt: "2026-04-01T00:00:00.000Z",
      nextReconcileAt: null,
    });
    const expectedDedupeKey = createHash("sha256")
      .update(JSON.stringify(["junction", "backfill", ownerWindowStart, ownerWindowEnd]))
      .digest("hex");

    store.enqueueJob({
      accountId: account.id,
      provider: "junction",
      kind: "backfill",
      payload: {
        windowStart: ownerWindowStart,
        windowEnd: ownerWindowEnd,
      },
      availableAt: executedAt,
      priority: 30,
      dedupeKey: expectedDedupeKey,
    });

    const processedJob = await service.runWorkerOnce();
    const jobs = readJobsForAccountForTesting(store, account.id);
    const retryRow = jobs.find((job) => job.status === "queued");

    assert.equal(processedJob?.kind, "backfill");
    assert.equal(store.getJobById(processedJob!.id)?.status, "succeeded");
    assert.equal(jobs.length, 2);
    assert.ok(retryRow);

    const retryJob = store.getJobById(retryRow.id);
    assert.ok(retryJob);
    assert.equal(retryJob.kind, "backfill");
    assert.equal(retryJob.availableAt, retryDueAt);
    assert.deepEqual(retryJob.payload, {
      windowStart: ownerWindowStart,
      windowEnd: ownerWindowEnd,
      emptyBackfillAttempts: 1,
    });
    assert.equal(retryJob.dedupeKey, expectedDedupeKey);
    assert.equal(store.getAccountById(account.id)?.metadata.junctionHistoricalBackfillStatus, undefined);
  } finally {
    close();
  }
});

test("device sync service preserves Junction yielded backfill timeseries cursor in queued continuation", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-junction-yielded-backfill-cursor");
  const ownerWindowStart = "2026-04-07T00:00:00.000Z";
  const ownerWindowEnd = "2026-04-10T00:00:00.000Z";
  let yieldRequested = false;
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    clock: {
      now: () => new Date("2026-04-10T12:00:00.000Z"),
    },
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      shouldYieldJobExecution: () => yieldRequested,
    },
    providers: [
      createJunctionDeviceSyncProvider({
        apiKey: "sk_us_fake_test_placeholder",
        clientUserIdSecret: "test-only-hmac-secret",
        environment: "sandbox",
        region: "us",
        reconcileIntervalMs: 60_000,
        summaryBackfillDays: 3,
        summaryResources: ["activity"],
        timeseriesBackfillDays: 3,
        timeseriesResources: ["stress"],
        fetchImpl: async (input) => {
          const url = new URL(readUrl(input));

          if (url.pathname === "/v2/user/providers/junction-account") {
            return createJsonResponse({
              providers: [
                {
                  slug: "garmin",
                  status: "connected",
                },
              ],
            });
          }

          if (url.pathname === "/v2/summary/activity/junction-account") {
            yieldRequested = true;
            return createJsonResponse({
              activity: [],
            });
          }

          throw new Error(`Unexpected Junction request during yield continuation test: ${url.pathname}`);
        },
      }),
    ],
  });

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-account",
      displayName: "Junction",
      scopes: [],
      status: "active",
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {},
      },
      connectedAt: ownerWindowEnd,
      nextReconcileAt: null,
    });
    const expectedDedupeKey = createHash("sha256")
      .update(JSON.stringify(["junction", "backfill", ownerWindowStart, ownerWindowEnd]))
      .digest("hex");

    store.enqueueJob({
      accountId: account.id,
      provider: "junction",
      kind: "backfill",
      payload: {
        windowStart: ownerWindowStart,
        windowEnd: ownerWindowEnd,
        emptyBackfillAttempts: 2,
      },
      availableAt: ownerWindowEnd,
      priority: 30,
      dedupeKey: expectedDedupeKey,
    });

    const processedJob = await service.runWorkerOnce();
    const jobs = readJobsForAccountForTesting(store, account.id);
    const continuationRow = jobs.find((job) => job.status === "queued");

    assert.equal(processedJob?.kind, "backfill");
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0]?.status, "succeeded");
    assert.ok(continuationRow);

    const continuation = store.getJobById(continuationRow.id);
    assert.ok(continuation);
    assert.equal(continuation.kind, "backfill");
    assert.deepEqual(continuation.payload, {
      windowStart: ownerWindowStart,
      windowEnd: ownerWindowEnd,
      emptyBackfillAttempts: 2,
      timeseriesCursor: ownerWindowStart,
    });
    assert.equal(continuation.dedupeKey, expectedDedupeKey);
  } finally {
    close();
  }
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
  const { service, store, close } = createServiceFixture({
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
  const accountBeforeDisconnect = store.getAccountById(connected.account.id);
  const initialJob = service.summarize();

  assert.equal(initialJob.jobsQueued, 1);
  assert.ok(accountBeforeDisconnect);

  const workerPromise = service.runWorkerOnce();
  await providerStarted;

  const disconnected = await service.disconnectAccount(connected.account.id);
  assert.equal(disconnected.account.status, "disconnected");

  requireCallback(releaseProviderResolve, "provider release callback was not initialized")();
  await workerPromise;

  const storedAccount = store.getAccountById(connected.account.id);
  const jobs = readJobsForAccountForTesting(store, connected.account.id);

  assert.equal(refreshCalls, 0);
  assert.equal(imports.length, 0);
  assert.ok(storedAccount);
  assert.equal(storedAccount.status, "disconnected");
  assert.equal(storedAccount.disconnectGeneration, (accountBeforeDisconnect?.disconnectGeneration ?? 0) + 1);
  assertStoredCredentialKind(storedAccount, "none");
  assert.equal(storedAccount.accessTokenExpiresAt, null);
  assert.equal(storedAccount.lastSyncCompletedAt, null);
  assert.equal(service.summarize().jobsQueued, 0);
  assert.equal(service.summarize().jobsRunning, 0);
  assert.equal(service.summarize().jobsDead, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.kind, "backfill");
  assert.equal(jobs[0]?.status, "dead");
  assert.equal(jobs[0]?.last_error_code, "ACCOUNT_DISCONNECTED");

  close();
});

test("device sync service releases success-fenced jobs after local connection revision changes", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-success-revision-fence");
  let providerStartedResolve: (() => void) | null = null;
  let releaseProviderResolve: (() => void) | null = null;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const releaseProvider = new Promise<void>((resolve) => {
    releaseProviderResolve = resolve;
  });
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob(context, _job) {
          providerStartedResolve?.();
          await releaseProvider;
          return {
            metadataPatch: {
              providerSucceeded: true,
            },
            nextReconcileAt: "2026-03-19T00:00:00.000Z",
            scheduledJobs: [
              {
                kind: "follow-up",
                dedupeKey: `follow-up:${context.account.id}`,
              },
            ],
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
    code: "success-fence",
  });
  const accountBeforeWorker = store.getAccountById(connected.account.id);
  assert.ok(accountBeforeWorker);
  const originalCompleteAndSucceed = store.completeJobsMarkSyncSucceededAndEnqueueJobs.bind(store);
  store.completeJobsMarkSyncSucceededAndEnqueueJobs = (input) => {
    store.patchAccount(connected.account.id, {
      metadata: {
        localRevisionChanged: true,
      },
    });
    return originalCompleteAndSucceed(input);
  };

  const workerPromise = service.runWorkerOnce();
  await providerStarted;
  requireCallback(releaseProviderResolve, "provider release callback was not initialized")();
  const processedJob = await workerPromise;
  const storedAccount = store.getAccountById(connected.account.id);
  const jobs = readJobsForAccountForTesting(store, connected.account.id);

  assert.equal(processedJob?.kind, "backfill");
  assert.ok(storedAccount);
  assert.deepEqual(storedAccount.metadata, {
    connectedBy: "success-fence",
    localRevisionChanged: true,
  });
  assert.equal(storedAccount.lastSyncCompletedAt, null);
  assert.equal(storedAccount.nextReconcileAt, accountBeforeWorker.nextReconcileAt);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.kind, "backfill");
  assert.equal(jobs[0]?.status, "queued");
  assert.equal(service.summarize().jobsQueued, 1);

  close();
});

test("device sync service does not fail jobs reclaimed by another worker after the original lease expires", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-stale-worker-failure");
  let providerStartedResolve: (() => void) | null = null;
  let releaseProviderResolve: (() => void) | null = null;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const releaseProvider = new Promise<void>((resolve) => {
    releaseProviderResolve = resolve;
  });
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          providerStartedResolve?.();
          await releaseProvider;
          throw new Error("provider exploded");
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
    code: "stale-worker",
  });

  const workerPromise = service.runWorkerOnce();
  await providerStarted;

  const initialJobId = readFirstJobIdForAccountForTesting(store, connected.account.id);

  assert.ok(initialJobId);

  const expiredLeaseAt = new Date(Date.now() - 1_000).toISOString();
  const reclaimAt = new Date().toISOString();
  expireJobLeaseForTesting(store, initialJobId, expiredLeaseAt);

  const reclaimedJob = store.claimDueJob("worker-b", reclaimAt, 60_000);
  assert.equal(reclaimedJob?.id, initialJobId);
  assert.equal(reclaimedJob?.status, "running");
  assert.equal(reclaimedJob?.leaseOwner, "worker-b");

  requireCallback(releaseProviderResolve, "provider release callback was not initialized")();
  await workerPromise;

  const persistedJob = store.getJobById(initialJobId);
  assert.equal(persistedJob?.status, "running");
  assert.equal(persistedJob?.leaseOwner, "worker-b");
  assert.equal(persistedJob?.lastErrorCode, null);
  assert.equal(persistedJob?.lastErrorMessage, null);
  assert.equal(service.summarize().jobsRunning, 1);
  assert.equal(service.summarize().jobsDead, 0);

  close();
});

test("device sync service stops snapshot imports after the job lease expires and another worker reclaims it", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-stale-worker-import-fence");
  const imports: unknown[] = [];
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
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob(context) {
          providerStartedResolve?.();
          await releaseProvider;
          await context.importSnapshot({
            accountId: context.account.externalAccountId,
            importedAt: context.now,
          });
          return {
            metadataPatch: {
              shouldNotPersist: true,
            },
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
    code: "stale-import",
  });

  const workerPromise = service.runWorkerOnce();
  await providerStarted;

  const initialJobId = readFirstJobIdForAccountForTesting(store, connected.account.id);

  assert.ok(initialJobId);

  const expiredLeaseAt = new Date(Date.now() - 1_000).toISOString();
  const reclaimAt = new Date().toISOString();
  expireJobLeaseForTesting(store, initialJobId, expiredLeaseAt);

  const reclaimedJob = store.claimDueJob("worker-b", reclaimAt, 60_000);
  assert.equal(reclaimedJob?.id, initialJobId);
  assert.equal(reclaimedJob?.leaseOwner, "worker-b");

  requireCallback(releaseProviderResolve, "provider release callback was not initialized")();
  await workerPromise;

  const persistedJob = store.getJobById(initialJobId);
  const storedAccount = store.getAccountById(connected.account.id);

  assert.equal(imports.length, 0);
  assert.equal(persistedJob?.status, "running");
  assert.equal(persistedJob?.leaseOwner, "worker-b");
  assert.equal(persistedJob?.lastErrorCode, null);
  assert.equal(storedAccount?.lastSyncCompletedAt, null);
  assert.deepEqual(storedAccount?.metadata, {
    connectedBy: "stale-import",
  });

  close();
});

test("device sync service does not persist refreshed tokens after the job lease expires mid-refresh", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-stale-worker-token-fence");
  let refreshStartedResolve: (() => void) | null = null;
  let releaseRefreshResolve: (() => void) | null = null;
  const refreshStarted = new Promise<void>((resolve) => {
    refreshStartedResolve = resolve;
  });
  const releaseRefresh = new Promise<void>((resolve) => {
    releaseRefreshResolve = resolve;
  });
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async refreshTokens(_account: DeviceSyncAccount): Promise<ProviderAuthTokens> {
          refreshStartedResolve?.();
          await releaseRefresh;
          return {
            accessToken: "access-token-after-expiry",
            refreshToken: "refresh-token-after-expiry",
          };
        },
        async executeJob(context) {
          await context.refreshAccountTokens();
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
    code: "stale-refresh",
  });
  const tokensBefore = store.getAccountById(connected.account.id);

  assert.ok(tokensBefore);

  const workerPromise = service.runWorkerOnce();
  await refreshStarted;

  const initialJobId = readFirstJobIdForAccountForTesting(store, connected.account.id);

  assert.ok(initialJobId);

  const expiredLeaseAt = new Date(Date.now() - 1_000).toISOString();
  const reclaimAt = new Date().toISOString();
  expireJobLeaseForTesting(store, initialJobId, expiredLeaseAt);

  const reclaimedJob = store.claimDueJob("worker-b", reclaimAt, 60_000);
  assert.equal(reclaimedJob?.id, initialJobId);
  assert.equal(reclaimedJob?.leaseOwner, "worker-b");

  requireCallback(releaseRefreshResolve, "refresh release callback was not initialized")();
  await workerPromise;

  const persistedJob = store.getJobById(initialJobId);
  const accountAfter = store.getAccountById(connected.account.id);

  assert.ok(accountAfter);
  const credentialBefore = requireStoredOAuthCredential(tokensBefore);
  const credentialAfter = requireStoredOAuthCredential(accountAfter);
  assert.equal(credentialAfter.accessTokenEncrypted, credentialBefore.accessTokenEncrypted);
  assert.equal(credentialAfter.refreshTokenEncrypted, credentialBefore.refreshTokenEncrypted);
  assert.equal(persistedJob?.status, "running");
  assert.equal(persistedJob?.leaseOwner, "worker-b");
  assert.equal(persistedJob?.lastErrorCode, null);

  close();
});

test("device sync service ignores stale provider failures after account reconnect", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-stale-reconnect-failure");
  let providerStartedResolve: (() => void) | null = null;
  let releaseProviderResolve: (() => void) | null = null;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const releaseProvider = new Promise<void>((resolve) => {
    releaseProviderResolve = resolve;
  });
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          providerStartedResolve?.();
          await releaseProvider;
          throw deviceSyncError({
            code: "TOKEN_REFRESH_FAILED",
            message: "Reconnect required.",
            retryable: true,
            accountStatus: "reauthorization_required",
            details: {
              failureMetadataPatch: {
                staleFailure: true,
              },
            },
          });
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
    code: "stale-reconnect",
  });
  const accountBeforeReconnect = store.getAccountById(connected.account.id);

  assert.ok(accountBeforeReconnect);

  const workerPromise = service.runWorkerOnce();
  await providerStarted;

  const reconnect = await service.startConnection({
    provider: "demo",
  });
  const reconnected = await service.handleOAuthCallback({
    provider: "demo",
    state: reconnect.state,
    code: "stale-reconnect",
  });

  assert.equal(reconnected.account.id, connected.account.id);
  assert.equal(
    store.getAccountById(connected.account.id)?.localConnectionRevision,
    accountBeforeReconnect.localConnectionRevision + 1,
  );

  requireCallback(releaseProviderResolve, "provider release callback was not initialized")();
  await workerPromise;

  const accountAfter = store.getAccountById(connected.account.id);
  const jobsAfter = readJobsForAccountForTesting(store, connected.account.id);

  assert.ok(accountAfter);
  assert.equal(accountAfter.status, "active");
  assert.equal(accountAfter.lastErrorCode, null);
  assert.equal(accountAfter.lastErrorMessage, null);
  assert.deepEqual(accountAfter.metadata, {
    connectedBy: "stale-reconnect",
  });
  assert.equal(Object.hasOwn(accountAfter.metadata, "staleFailure"), false);
  assert.equal(service.summarize().jobsDead, 0);
  assert.equal(jobsAfter.some((job) => job.last_error_code !== null), false);

  close();
});

test("device sync service next wake tracks scheduled reconciles and queued jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-next-wake");
  const { service, store, close } = createServiceFixture({
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

  store.enqueueJob({
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

  store.enqueueJob({
    accountId: connected.account.id,
    availableAt: "2026-03-17T09:59:00.000Z",
    kind: "due-now",
    payload: {},
    priority: 100,
    provider: connected.account.provider,
  });

  assert.equal(
    service.getNextWakeAt("2026-03-17T10:00:00.000Z"),
    "2026-03-17T09:59:00.000Z",
  );

  close();
});

test("device sync store next wake reads scheduled reconciles and queued jobs without providers", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-store-next-wake");
  const stateDatabasePath = path.join(vaultRoot, DEVICE_SYNC_DB_RELATIVE_PATH);
  const store = new SqliteDeviceSyncStore(stateDatabasePath);

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-account",
      displayName: "Junction Account",
      scopes: ["offline"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
      },
      connectedAt: "2026-03-17T09:00:00.000Z",
      nextReconcileAt: "2026-03-17T12:00:00.000Z",
    });

    assert.equal(
      resolveDeviceSyncStoreNextWakeAt({
        vaultRoot,
      }),
      "2026-03-17T12:00:00.000Z",
    );

    store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-03-17T11:00:00.000Z",
      kind: "retry",
      payload: {},
      priority: 10,
      provider: account.provider,
    });

    assert.equal(
      resolveDeviceSyncStoreNextWakeAt({
        stateDatabasePath,
        vaultRoot: "/unused-vault-root",
      }),
      "2026-03-17T11:00:00.000Z",
    );

    assert.equal(
      resolveDeviceSyncStoreNextWakeAt({
        stateDatabasePath,
        vaultRoot: "/unused-vault-root",
      }),
      "2026-03-17T11:00:00.000Z",
    );
  } finally {
    store.close();
  }
});

test("device sync service stops queued work when a provider failure requires reauthorization", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-reauth-retry");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          throw deviceSyncError({
            code: "TOKEN_REFRESH_FAILED",
            message: "Reconnect required.",
            retryable: true,
            accountStatus: "reauthorization_required",
          });
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
    code: "reauth",
  });

  const processedJob = await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const queuedJobs = readJobsForAccountForTesting(store, connected.account.id);

  assert.equal(processedJob?.kind, "backfill");
  assert.equal(storedAccount?.status, "reauthorization_required");
  assert.equal(storedAccount?.lastErrorCode, "TOKEN_REFRESH_FAILED");
  assert.equal(storedAccount?.lastErrorMessage, "Reconnect required.");
  assert.equal(storedAccount?.nextReconcileAt, null);
  assert.equal(service.summarize().jobsQueued, 0);
  assert.equal(service.summarize().jobsDead, 1);
  assert.equal(queuedJobs[0]?.status, "dead");
  assert.equal(queuedJobs[0]?.attempts, 1);
  assert.equal(queuedJobs[0]?.last_error_code, "ACCOUNT_REAUTHORIZATION_REQUIRED");
  assert.equal(
    queuedJobs[0]?.last_error_message,
    "Device sync account requires reconnection before queued jobs can run.",
  );

  close();
});

test("device sync service records unexpected job errors as dead jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-job-error");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          throw new Error(
            "provider exploded for https://provider.example.test/jobs/123 and user@example.test at '/tmp/device-sync/job' while notifying 415-555-0100",
          );
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
    code: "job-error",
  });

  const processedJob = await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const jobStatus = readJobsForAccountForTesting(store, connected.account.id)[0];

  assert.equal(processedJob?.kind, "backfill");
  assert.equal(storedAccount?.status, "active");
  assert.equal(storedAccount?.lastErrorCode, "SYNC_JOB_FAILED");
  assert.equal(
    storedAccount?.lastErrorMessage,
    "provider exploded for <redacted-url> and <redacted-email> at '<redacted-path>' while notifying <redacted-phone>",
  );
  assert.equal(jobStatus.status, "dead");
  assert.equal(jobStatus.last_error_code, "SYNC_JOB_FAILED");
  assert.equal(
    jobStatus.last_error_message,
    "provider exploded for <redacted-url> and <redacted-email> at '<redacted-path>' while notifying <redacted-phone>",
  );

  close();
});

test("device sync service preserves sanitized validation issue paths for unexpected job errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-job-validation-error");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          const error = new Error("Invalid input: expected nonoptional, received undefined") as Error & {
            issues: Array<{ code: string; message: string; path: Array<number | string> }>;
          };
          error.name = "ZodError";
          error.issues = [
            {
              code: "invalid_type",
              message: "Invalid input: expected nonoptional, received undefined",
              path: ["snapshot", "sleeps", 0, "score"],
            },
          ];
          throw error;
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
    code: "validation-error",
  });

  await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const jobStatus = readJobsForAccountForTesting(store, connected.account.id)[0];
  const expectedMessage =
    "Invalid input: expected nonoptional, received undefined | validationIssues=$.snapshot.sleeps[0].score invalid_type Invalid input: expected nonoptional, received undefined";

  assert.equal(storedAccount?.lastErrorCode, "SYNC_JOB_FAILED");
  assert.equal(storedAccount?.lastErrorMessage, expectedMessage);
  assert.equal(jobStatus.last_error_code, "SYNC_JOB_FAILED");
  assert.equal(jobStatus.last_error_message, expectedMessage);

  close();
});

test("device sync service preserves nested sanitized validation metadata for unexpected job errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-job-nested-validation-error");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          const cause = new Error("Nested validation failed") as Error & {
            issues: Array<{
              code: string;
              expected?: string;
              message: string;
              origin?: string;
              path: Array<number | string>;
              received?: string;
            }>;
          };
          cause.name = "ZodError";
          cause.issues = [
            {
              code: "invalid_type",
              expected: "nonoptional",
              message: "Invalid input: expected nonoptional, received undefined",
              origin: "object",
              path: ["snapshot", "sleeps", 0, "score"],
              received: "undefined",
            },
            {
              code: "invalid_type",
              expected: "string",
              message: "Invalid input: access_token=provider-secret",
              path: ["snapshot", "profile", "access_token"],
              received: "undefined",
            },
          ];

          const error = new Error("Import failed", { cause }) as Error & {
            errors: Array<{
              code: string;
              inclusive: boolean;
              message: string;
              minimum: number;
              path: Array<number | string>;
            }>;
          };
          error.errors = [
            {
              code: "too_small",
              inclusive: true,
              message: "Too small",
              minimum: 0,
              path: ["snapshot", "workouts", 0, "score", "strain"],
            },
          ];
          throw error;
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
    code: "nested-validation-error",
  });

  await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const jobStatus = readJobsForAccountForTesting(store, connected.account.id)[0];
  const expectedMessage =
    "Import failed | validationIssues=$.snapshot.workouts[0].score.strain too_small Too small [minimum=0 inclusive=true]; $.snapshot.sleeps[0].score invalid_type Invalid input: expected nonoptional, received undefined [expected=nonoptional received=undefined origin=object]; $.snapshot.profile.<redacted-field> invalid_type Invalid input: access_token=[redacted] [expected=string received=undefined]";

  assert.equal(storedAccount?.lastErrorCode, "SYNC_JOB_FAILED");
  assert.equal(storedAccount?.lastErrorMessage, expectedMessage);
  assert.equal(jobStatus.last_error_code, "SYNC_JOB_FAILED");
  assert.equal(jobStatus.last_error_message, expectedMessage);

  close();
});

test("device sync service preserves sanitized vault validation details for unexpected job errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-job-vault-validation-error");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          const error = new Error("Vault metadata failed contract validation.") as Error & {
            details: { errors: string[] };
          };
          error.name = "VaultError";
          error.details = {
            errors: [
              "$.timezone: Invalid input: expected string, received undefined",
              "$.unsafe.bad field.name: Invalid input: expected string, received undefined",
            ],
          };
          throw error;
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
    code: "vault-validation-error",
  });

  await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const jobStatus = readJobsForAccountForTesting(store, connected.account.id)[0];
  const expectedMessage =
    "Vault metadata failed contract validation. | validationIssues=$.timezone: Invalid input: expected string, received undefined; $.unsafe.<field>: Invalid input: expected string, received undefined";

  assert.equal(storedAccount?.lastErrorCode, "SYNC_JOB_FAILED");
  assert.equal(storedAccount?.lastErrorMessage, expectedMessage);
  assert.equal(jobStatus.last_error_code, "SYNC_JOB_FAILED");
  assert.equal(jobStatus.last_error_message, expectedMessage);

  close();
});

test("device sync service string job failures still produce deterministic dead-job state", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-job-string-error");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          throw "plain failure";
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
    code: "string-error",
  });

  await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const jobStatus = readJobsForAccountForTesting(store, connected.account.id)[0];

  assert.equal(storedAccount?.lastErrorCode, "SYNC_JOB_FAILED");
  assert.equal(storedAccount?.lastErrorMessage, "plain failure");
  assert.equal(jobStatus.status, "dead");
  assert.equal(jobStatus.last_error_message, "plain failure");

  close();
});

test("device sync service exposes safe structured diagnostics for provider failures", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-provider-failure-diagnostics");
  const warnEvents: Array<{ context?: Record<string, unknown>; message: string }> = [];
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn(message, context) {
          warnEvents.push({
            message,
            context: context as Record<string, unknown> | undefined,
          });
        },
      },
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          throw deviceSyncError({
            code: "WHOOP_TOKEN_REQUEST_FAILED",
            message: "WHOOP token request failed.",
            retryable: false,
            httpStatus: 400,
            details: {
              status: 400,
              retryable: false,
              accountStatus: null,
              oauthErrorCode: "invalid_request",
              oauthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
              oauthGrantType: "refresh_token",
              oauthRequestBodyBuilderKind: "url_search_params_record",
              oauthRequestClientAuthPlacement: "body_parameters",
              oauthRequestClientCredentialPresent: true,
              oauthRequestClientIdPresent: true,
              oauthRequestContentType: "application_x_www_form_urlencoded",
              oauthRequestDuplicateParameterCount: 0,
              oauthRequestEncodingKind: "form_urlencoded",
              oauthRequestHasDuplicateParameters: false,
              oauthRequestMethod: "POST",
              oauthRequestOfflineScopePresent: true,
              oauthRequestParameterCount: 5,
              oauthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
              oauthRequestRefreshCredentialPresent: true,
              oauthRequestScopeCount: 1,
              oauthRequestScopePresent: true,
              oauthRequestScopeValue: "offline",
              oauthRequestTokenEndpointKind: "whoop_oauth_token",
              oauthResponseErrorDescriptionFieldPresent: true,
              oauthResponseErrorFieldPresent: true,
              oauthResponseShapeKind: "json_object",
              responseBody: "access_token=secret",
              requestAuthKind: "oauth_client_secret_body",
              requestAuthPlacement: "body_parameters",
              requestBodyFieldCount: 5,
              requestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
              requestBodyKind: "form_urlencoded",
              requestContentType: "application_x_www_form_urlencoded",
              requestCredentialPresent: true,
              requestEndpointKind: "whoop_oauth_token",
              requestMethod: "POST",
              requestQueryParameterCount: 0,
              requestQueryParameterNames: null,
              responseErrorCode: "invalid_request",
              responseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
              responseErrorDescriptionFieldPresent: true,
              responseErrorFieldPresent: true,
              responseShapeKind: "json_object",
            },
          });
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
    code: "provider-failure-diagnostics",
  });

  await service.runWorkerOnce();

  const diagnostics = service.listJobFailureDiagnostics();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.accountId, connected.account.id);
  assert.equal(diagnostics[0]?.code, "WHOOP_TOKEN_REQUEST_FAILED");
  assert.equal(diagnostics[0]?.retryable, false);
  assert.equal(diagnostics[0]?.provider, "demo");
  assert.equal(diagnostics[0]?.jobKind, "backfill");
  assert.equal(diagnostics[0]?.attempts, 1);
  assert.equal(typeof diagnostics[0]?.at, "string");
  assert.equal(
    diagnostics[0]?.summary,
    "WHOOP token request failed. Provider reason: Refresh token expired. Reconnect WHOOP.",
  );
  assert.deepEqual(diagnostics[0]?.details, {
    providerHttpStatus: 400,
    providerRequestAuthKind: "oauth_client_secret_body",
    providerRequestAuthPlacement: "body_parameters",
    providerRequestBodyFieldCount: 5,
    providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
    providerRequestBodyKind: "form_urlencoded",
    providerRequestContentType: "application_x_www_form_urlencoded",
    providerRequestCredentialPresent: true,
    providerRequestEndpointKind: "whoop_oauth_token",
    providerRequestMethod: "POST",
    providerRequestQueryParameterCount: 0,
    providerResponseErrorCode: "invalid_request",
    providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
    providerResponseErrorDescriptionFieldPresent: true,
    providerResponseErrorFieldPresent: true,
    providerResponseShapeKind: "json_object",
    providerOAuthErrorCode: "invalid_request",
    providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
    providerOAuthGrantType: "refresh_token",
    providerOAuthRequestBodyBuilderKind: "url_search_params_record",
    providerOAuthRequestClientAuthPlacement: "body_parameters",
    providerOAuthRequestClientCredentialPresent: true,
    providerOAuthRequestClientIdPresent: true,
    providerOAuthRequestContentType: "application_x_www_form_urlencoded",
    providerOAuthRequestDuplicateParameterCount: 0,
    providerOAuthRequestEncodingKind: "form_urlencoded",
    providerOAuthRequestHasDuplicateParameters: false,
    providerOAuthRequestMethod: "POST",
    providerOAuthRequestOfflineScopePresent: true,
    providerOAuthRequestParameterCount: 5,
    providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
    providerOAuthRequestRefreshCredentialPresent: true,
    providerOAuthRequestScopeCount: 1,
    providerOAuthRequestScopePresent: true,
    providerOAuthRequestScopeValue: "offline",
    providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
    providerOAuthResponseErrorDescriptionFieldPresent: true,
    providerOAuthResponseErrorFieldPresent: true,
    providerOAuthResponseShapeKind: "json_object",
  });

  diagnostics[0]!.details.providerOAuthErrorCode = "mutated";
  assert.equal(service.listJobFailureDiagnostics()[0]?.details.providerOAuthErrorCode, "invalid_request");

  assert.equal(warnEvents.length, 1);
  const { jobId, ...warnContext } = warnEvents[0]?.context ?? {};
  assert.equal(typeof jobId, "string");
  assert.deepEqual(warnContext, {
    provider: "demo",
    code: "WHOOP_TOKEN_REQUEST_FAILED",
    failureSummary: "WHOOP token request failed. Provider reason: Refresh token expired. Reconnect WHOOP.",
    retryable: false,
    accountStatus: null,
    providerHttpStatus: 400,
    providerRequestAuthKind: "oauth_client_secret_body",
    providerRequestAuthPlacement: "body_parameters",
    providerRequestBodyFieldCount: 5,
    providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
    providerRequestBodyKind: "form_urlencoded",
    providerRequestContentType: "application_x_www_form_urlencoded",
    providerRequestCredentialPresent: true,
    providerRequestEndpointKind: "whoop_oauth_token",
    providerRequestMethod: "POST",
    providerRequestQueryParameterCount: 0,
    providerResponseErrorCode: "invalid_request",
    providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
    providerResponseErrorDescriptionFieldPresent: true,
    providerResponseErrorFieldPresent: true,
    providerResponseShapeKind: "json_object",
    providerOAuthErrorCode: "invalid_request",
    providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
    providerOAuthGrantType: "refresh_token",
    providerOAuthRequestBodyBuilderKind: "url_search_params_record",
    providerOAuthRequestClientAuthPlacement: "body_parameters",
    providerOAuthRequestClientCredentialPresent: true,
    providerOAuthRequestClientIdPresent: true,
    providerOAuthRequestContentType: "application_x_www_form_urlencoded",
    providerOAuthRequestDuplicateParameterCount: 0,
    providerOAuthRequestEncodingKind: "form_urlencoded",
    providerOAuthRequestHasDuplicateParameters: false,
    providerOAuthRequestMethod: "POST",
    providerOAuthRequestOfflineScopePresent: true,
    providerOAuthRequestParameterCount: 5,
    providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
    providerOAuthRequestRefreshCredentialPresent: true,
    providerOAuthRequestScopeCount: 1,
    providerOAuthRequestScopePresent: true,
    providerOAuthRequestScopeValue: "offline",
    providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
    providerOAuthResponseErrorDescriptionFieldPresent: true,
    providerOAuthResponseErrorFieldPresent: true,
    providerOAuthResponseShapeKind: "json_object",
  });
  assert.equal(JSON.stringify(warnEvents).includes(connected.account.id), false);

  close();
});

test("device sync service keeps per-attempt failure diagnostics after a later job success clears account error state", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-failure-after-success");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn() {
          // The failure is asserted through the diagnostics ring below.
        },
      },
    },
    providers: [
      createFakeProvider({
        async executeJob(_context, job) {
          if (job.kind === "resource") {
            throw deviceSyncError({
              code: "JUNCTION_API_REQUEST_FAILED",
              message: "Junction summary request failed.",
              retryable: true,
              httpStatus: 503,
            });
          }
          return {};
        },
      }),
    ],
  });

  try {
    const begin = await service.startConnection({
      provider: "demo",
    });
    const connected = await service.handleOAuthCallback({
      provider: "demo",
      state: begin.state,
      code: "failure-then-success",
    });

    store.enqueueJob({
      accountId: connected.account.id,
      provider: "demo",
      kind: "resource",
      payload: {
        resource: "sleep",
        resourceCategory: "summary",
      },
      availableAt: "2026-06-08T02:00:00.000Z",
    });

    // The webhook-style resource job fails first; the initial backfill job for
    // the same account succeeds afterwards and clears the account-level error
    // state, mirroring the webhook-wake drains from the June 2026 incident.
    await service.drainWorker(10);

    const account = store.getAccountById(connected.account.id);
    assert.ok(account);
    assert.equal(account.lastSyncErrorAt, null);
    assert.equal(account.lastErrorCode, null);

    const diagnostics = service.listJobFailureDiagnostics();
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.accountId, connected.account.id);
    assert.equal(diagnostics[0]?.code, "JUNCTION_API_REQUEST_FAILED");
    assert.equal(diagnostics[0]?.provider, "demo");
    assert.equal(diagnostics[0]?.jobKind, "resource");
    assert.equal(diagnostics[0]?.resource, "sleep");
    assert.equal(diagnostics[0]?.attempts, 1);
    assert.equal(diagnostics[0]?.retryable, true);
    assert.equal(typeof diagnostics[0]?.at, "string");
    assert.equal(diagnostics[0]?.summary, "Junction summary request failed.");
  } finally {
    close();
  }
});

test("device sync service omits unsafe free-form provider diagnostic reasons", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-unsafe-provider-diagnostics");
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          throw deviceSyncError({
            code: "WHOOP_TOKEN_REQUEST_FAILED",
            message: "WHOOP token request failed.",
            retryable: false,
            httpStatus: 400,
            details: {
              oauthErrorCode: "invalid_grant",
              oauthErrorDescription: '{"access_token":"fixture-secret","account_id":"account-sensitive"}',
              oauthGrantType: "refresh_token",
            },
          });
        },
      }),
    ],
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "unsafe-provider-diagnostics",
  });

  await service.runWorkerOnce();

  assert.deepEqual(service.listJobFailureDiagnostics()[0]?.details, {
    providerHttpStatus: 400,
    providerOAuthErrorCode: "invalid_grant",
    providerOAuthGrantType: "refresh_token",
  });

  close();
});

test("device sync service exposes sanitized cause details for transport failures", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-transport-failure-diagnostics");
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          const cause = new Error(
            "Connect Timeout Error for https://api.prod.whoop.com/oauth/oauth2/token?access_token=secret",
          ) as Error & { code: string };
          cause.name = "ConnectTimeoutError";
          cause.code = "UND_ERR_CONNECT_TIMEOUT";
          throw new TypeError("fetch failed", { cause });
        },
      }),
    ],
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "transport-failure-diagnostics",
  });

  await service.runWorkerOnce();

  assert.deepEqual(service.listJobFailureDiagnostics()[0]?.details, {
    failureErrorName: "TypeError",
    failureCauseName: "ConnectTimeoutError",
    failureCauseCode: "UND_ERR_CONNECT_TIMEOUT",
    failureErrorCause: "Connect Timeout Error for <redacted-url>",
  });

  close();
});

test("device sync service omits unsafe free-form transport causes", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-unsafe-transport-diagnostics");
  const { service, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          const cause = new Error("refresh token abc123 leaked") as Error & { code: string };
          cause.name = "ProviderTransportError";
          cause.code = "UND_ERR_SOCKET";
          throw new TypeError("fetch failed", { cause });
        },
      }),
    ],
  });

  const begin = await service.startConnection({
    provider: "demo",
  });
  await service.handleOAuthCallback({
    provider: "demo",
    state: begin.state,
    code: "unsafe-transport-diagnostics",
  });

  await service.runWorkerOnce();

  assert.deepEqual(service.listJobFailureDiagnostics()[0]?.details, {
    failureErrorName: "TypeError",
    failureCauseName: "ProviderTransportError",
    failureCauseCode: "UND_ERR_SOCKET",
  });

  close();
});

test("device sync service bounds in-memory job failure diagnostics to recent failures", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-bounded-failure-diagnostics");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob(_context, job) {
          const index = typeof job.payload.failureIndex === "number" ? job.payload.failureIndex : -1;
          throw deviceSyncError({
            code: `BOUNDED_FAILURE_${index}`,
            message: `Bounded failure ${index}.`,
            retryable: false,
            httpStatus: 500,
          });
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
    code: "bounded-failure-diagnostics",
  });

  const processedBackfill = await service.runWorkerOnce();
  assert.equal(processedBackfill?.kind, "backfill");

  for (let index = 0; index < 55; index += 1) {
    store.enqueueJob({
      accountId: connected.account.id,
      provider: "demo",
      kind: "bounded-failure",
      payload: {
        failureIndex: index,
      },
      availableAt: new Date(Date.parse("2026-03-17T10:00:00.000Z") + index * 1000).toISOString(),
    });
  }

  assert.equal(await service.drainWorker(60), 55);
  const diagnostics = service.listJobFailureDiagnostics();
  assert.equal(diagnostics.length, 50);
  assert.equal(diagnostics[0]?.code, "BOUNDED_FAILURE_5");
  assert.equal(diagnostics.at(-1)?.code, "BOUNDED_FAILURE_54");

  close();
});

test("device sync service redacts secret-bearing job failures before persistence", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-job-error-redacted");
  const { service, store, close } = createServiceFixture({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
    },
    providers: [
      createFakeProvider({
        async executeJob() {
          throw new Error(
            "authorization=Bearer secret-token refresh_token=refresh-secret eyJhbGciOiJIUzI1NiJ9.payload.signature",
          );
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
    code: "secret-error",
  });

  await service.runWorkerOnce();
  const storedAccount = store.getAccountById(connected.account.id);
  const jobStatus = readJobsForAccountForTesting(store, connected.account.id)[0];

  assert.equal(storedAccount?.lastErrorCode, "SYNC_JOB_FAILED");
  assert.equal(
    storedAccount?.lastErrorMessage,
    "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
  );
  assert.equal(jobStatus.status, "dead");
  assert.equal(jobStatus.last_error_code, "SYNC_JOB_FAILED");
  assert.equal(
    jobStatus.last_error_message,
    "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
  );

  close();
});

test("device sync service logs non-error revoke failures but still disconnects locally", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-revoke-warning");
  const warnEvents: Array<{ context?: Record<string, unknown>; message: string }> = [];
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn(message, context) {
          warnEvents.push({
            context: context as Record<string, unknown> | undefined,
            message,
          });
        },
      },
    },
    providers: [
      createFakeProvider({
        async revokeAccess() {
          throw "remote revoke unavailable";
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
    code: "disconnect-warning",
  });

  const disconnected = await service.disconnectAccount(connected.account.id);

  assert.equal(disconnected.account.status, "disconnected");
  assert.equal(warnEvents.length, 1);
  assert.equal(warnEvents[0]?.message, "Provider revoke access failed during disconnect; continuing local disconnect.");
  assert.equal(warnEvents[0]?.context?.failureCode, "DEVICE_SYNC_DISCONNECT_REVOKE_FAILED");
  assert.deepEqual(warnEvents[0]?.context?.error, {
    category: "non_error_throw",
    value: "remote revoke unavailable",
  });

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
    connection: {
      connectedAt: "2026-03-20T10:00:00.000Z",
      displayName: "Hosted Account",
      externalAccountId: "demo-seeded",
      metadata: {
        fresh: true,
        nested: {
          drop: "me",
        },
        oversized: "x".repeat(300),
      },
      provider: "demo",
      scopes: ["heartrate"],
      status: "disconnected",
      updatedAt: "2026-03-27T08:00:00.000Z",
    },
    hostedObservedTokenVersion: null,
    hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
    localState: {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
      lastSyncErrorAt: null,
      lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      nextReconcileAt: null,
    },
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
  assertStoredCredentialKind(hydrated, "none");
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
      athleteId: "raw-athlete-id",
      authHeader: "Bearer auth-token",
      credential: "credential-material",
      enabled: true,
      externalAccountId: "raw-account-id",
      hmacSecret: "hmac-secret",
      longText: "x".repeat(300),
      nested: {
        secret: "drop-me",
      },
      profileId: "raw-profile-id",
      ownerId: "raw-owner-id",
      session: "session",
      sessionHandle: "session-handle",
      sessionHash: "session-hash",
      sessionKey: "session-key",
      sourceId: "raw-source-id",
      source: "browser",
      subjectId: "raw-subject-id",
      token: "generic-token",
      values: ["drop-me"],
      webhookSecret: "webhook-secret",
      webhookSignature: "webhook-signature",
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
        authHeader: "Bearer patched-auth-token",
        memberId: "patched-member-id",
        providerConnectionId: "provider-connection-id",
        secret: "generic-secret",
        sessionHash: "patched-session-hash",
        sessionKey: "patched-session-key",
        sourceInstanceId: "source-instance-id",
        webhookSignature: "patched-webhook-signature",
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
  assert.equal(
    store.markSyncSucceeded(created.id, "2026-03-20T13:00:00.000Z", null, {
      metadataPatch: {
        count: undefined,
        source: null,
      },
    }),
    true,
  );
  assert.deepEqual(store.getAccountById(created.id)?.metadata, {
    count: 3,
    enabled: false,
    source: null,
  });

  store.close();
});

test("sqlite store leaves metadata untouched on failures without metadata patches", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-failure-metadata-untouched");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));
  const created = store.upsertAccount({
    connectedAt: "2026-03-20T10:00:00.000Z",
    displayName: "Failure Metadata Account",
    externalAccountId: "demo-failure-metadata",
    metadata: {},
    nextReconcileAt: null,
    provider: "demo",
    scopes: ["offline"],
    status: "active",
    tokens: {
      accessToken: "seed-access",
      accessTokenEncrypted: "enc:seed-access",
      refreshToken: "seed-refresh",
      refreshTokenEncrypted: "enc:seed-refresh",
    },
  });
  const crowdedMetadataJson = JSON.stringify(
    Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`legacy${index}`, `value-${index}`])),
  );
  const database = openSqliteRuntimeDatabase(store.databasePath);
  try {
    database.prepare("update device_connection set metadata_json = ? where id = ?").run(
      crowdedMetadataJson,
      created.id,
    );
    const before = database.prepare("select metadata_json from device_connection where id = ?").get(
      created.id,
    ) as { metadata_json?: string } | undefined;
    assert.equal(before?.metadata_json, crowdedMetadataJson);

    store.markSyncFailed(
      created.id,
      "2026-03-20T12:00:00.000Z",
      "SYNC_FAILED",
      "sync failed",
      null,
    );

    const after = database.prepare("select metadata_json from device_connection where id = ?").get(
      created.id,
    ) as { metadata_json?: string } | undefined;
    assert.equal(after?.metadata_json, crowdedMetadataJson);
  } finally {
    database.close();
    store.close();
  }
});

test("sqlite store prioritizes metadataPatch entries when capped metadata is full", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-metadata-patch-priority");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));
  const crowdedMetadata = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [`existing${index}`, `value-${index}`]),
  );
  const created = store.upsertAccount({
    connectedAt: "2026-03-20T10:00:00.000Z",
    displayName: "Crowded Metadata Account",
    externalAccountId: "demo-crowded-metadata",
    metadata: crowdedMetadata,
    nextReconcileAt: null,
    provider: "demo",
    scopes: ["offline"],
    status: "active",
    tokens: {
      accessToken: "seed-access",
      accessTokenEncrypted: "enc:seed-access",
      refreshToken: "seed-refresh",
      refreshTokenEncrypted: "enc:seed-refresh",
    },
  });

  assert.equal(Object.keys(created.metadata).length, 16);
  assert.equal(
    store.markSyncSucceeded(created.id, "2026-03-20T12:00:00.000Z", null, {
      metadataPatch: {
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillStatus: "retrying",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      },
    }),
    true,
  );

  const metadata = store.getAccountById(created.id)?.metadata ?? {};
  assert.deepEqual(
    {
      junctionHistoricalBackfillEmptyAttempts: metadata.junctionHistoricalBackfillEmptyAttempts,
      junctionHistoricalBackfillLastEmptyAt: metadata.junctionHistoricalBackfillLastEmptyAt,
      junctionHistoricalBackfillStatus: metadata.junctionHistoricalBackfillStatus,
      junctionHistoricalBackfillWindowEnd: metadata.junctionHistoricalBackfillWindowEnd,
      junctionHistoricalBackfillWindowStart: metadata.junctionHistoricalBackfillWindowStart,
    },
    {
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
      junctionHistoricalBackfillStatus: "retrying",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
    },
  );
  assert.equal(Object.keys(metadata).length, 16);

  assert.equal(
    store.markSyncSucceeded(created.id, "2026-03-20T12:05:00.000Z", null, {
      metadataPatch: {
        "99": "numeric-like-patch-key",
      },
    }),
    true,
  );

  const numericKeyMetadata = store.getAccountById(created.id)?.metadata ?? {};
  assert.equal(numericKeyMetadata["99"], "numeric-like-patch-key");
  assert.equal(Object.keys(numericKeyMetadata).length, 16);

  store.close();
});

test("sqlite store splits connection, credential, and observation state into explicit tables", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-authority-split");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));
  const created = store.upsertAccount({
    connectedAt: "2026-03-20T10:00:00.000Z",
    displayName: "Split Account",
    externalAccountId: "demo-split",
    metadata: {
      source: "browser",
    },
    nextReconcileAt: "2026-03-28T00:00:00.000Z",
    provider: "demo",
    scopes: ["offline", "read:data"],
    status: "active",
    tokens: {
      accessToken: "split-access",
      accessTokenEncrypted: "enc:split-access",
      accessTokenExpiresAt: "2026-03-28T00:00:00.000Z",
      refreshToken: "split-refresh",
      refreshTokenEncrypted: "enc:split-refresh",
    },
  });
  store.markWebhookReceived(created.id, "2026-03-20T11:00:00.000Z");
  store.markSyncFailed(created.id, "2026-03-20T12:00:00.000Z", "SYNC_FAILED", "sync failed", "reauthorization_required");

  const sqliteTables = readNamedSqliteTablesForTesting(store, [
    "device_account",
    "device_connection",
    "device_credential_state",
    "device_job",
    "device_observation_state",
    "oauth_state",
    "webhook_trace",
  ]);

  assert.deepEqual(sqliteTables, [
    "device_connection",
    "device_credential_state",
    "device_job",
    "device_observation_state",
    "oauth_state",
    "webhook_trace",
  ]);
  assert.deepEqual(readTableColumnsForTesting(store, "device_connection"), [
    "id",
    "provider",
    "external_account_id",
    "display_name",
    "status",
    "setup_phase",
    "setup_expires_at",
    "scopes_json",
    "disconnect_generation",
    "metadata_json",
    "connected_at",
    "created_at",
    "updated_at",
  ]);
  assert.deepEqual(readTableColumnsForTesting(store, "oauth_state"), [
    "state",
    "provider",
    "owner_id",
    "return_to",
    "metadata_json",
    "created_at",
    "expires_at",
  ]);
  assert.deepEqual(readTableColumnsForTesting(store, "device_credential_state"), [
    "account_id",
    "credential_kind",
    "provider_config_key",
    "access_token_encrypted",
    "refresh_token_encrypted",
    "access_token_expires_at",
    "credential_metadata_json",
    "created_at",
    "updated_at",
  ]);
  assert.deepEqual(readTableColumnsForTesting(store, "device_observation_state"), [
    "account_id",
    "hosted_observed_updated_at",
    "hosted_observed_connection_revision",
    "hosted_observed_token_version",
    "hosted_observed_token_revision",
    "local_connection_revision",
    "local_token_revision",
    "last_webhook_at",
    "last_sync_started_at",
    "last_sync_completed_at",
    "last_sync_error_at",
    "last_error_code",
    "last_error_message",
    "next_reconcile_at",
    "created_at",
    "updated_at",
  ]);
  const credentialRow = readCredentialStateForTesting(store, created.id);
  assert.ok(credentialRow);
  assert.equal(credentialRow.credential_kind, "oauth_tokens");
  assert.equal(credentialRow.provider_config_key, null);
  assert.equal(credentialRow.access_token_encrypted, "enc:split-access");
  assert.equal(credentialRow.refresh_token_encrypted, "enc:split-refresh");
  assert.equal(credentialRow.access_token_expires_at, "2026-03-28T00:00:00.000Z");
  assert.equal(credentialRow.credential_metadata_json, "{}");

  const observationRow = readObservationStateForTesting(store, created.id);
  assert.ok(observationRow);
  assert.equal(observationRow.hosted_observed_updated_at, null);
  assert.equal(observationRow.hosted_observed_connection_revision, 0);
  assert.equal(observationRow.hosted_observed_token_version, null);
  assert.equal(observationRow.hosted_observed_token_revision, 0);
  assert.equal(observationRow.local_connection_revision, 1);
  assert.equal(observationRow.local_token_revision, 0);
  assert.equal(observationRow.last_webhook_at, "2026-03-20T11:00:00.000Z");
  assert.equal(observationRow.last_error_code, "SYNC_FAILED");
  assert.equal(observationRow.next_reconcile_at, null);

  store.close();
});

test("sqlite store reopens an existing split-schema database at the current schema version", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-reopen-current-schema");
  const databasePath = path.join(vaultRoot, ".runtime", "device-syncd.sqlite");

  const initialStore = new SqliteDeviceSyncStore(databasePath);
  const created = initialStore.upsertAccount({
    connectedAt: "2026-03-20T10:00:00.000Z",
    displayName: "Reopen Account",
    externalAccountId: "demo-reopen",
    metadata: {
      source: "reopen-test",
    },
    nextReconcileAt: "2026-03-28T00:00:00.000Z",
    provider: "demo",
    scopes: ["offline", "read:data"],
    status: "active",
    tokens: {
      accessToken: "reopen-access",
      accessTokenEncrypted: "enc:reopen-access",
      accessTokenExpiresAt: "2026-03-28T00:00:00.000Z",
      refreshToken: "reopen-refresh",
      refreshTokenEncrypted: "enc:reopen-refresh",
    },
  });
  initialStore.close();

  const reopenedStore = new SqliteDeviceSyncStore(databasePath);
  const reopened = reopenedStore.getAccountById(created.id);

  assert.ok(reopened);
  assert.equal(reopened?.displayName, "Reopen Account");
  assert.equal(requireStoredOAuthCredential(reopened).accessTokenEncrypted, "enc:reopen-access");

  reopenedStore.markWebhookReceived(created.id, "2026-03-21T12:00:00.000Z");
  assert.equal(reopenedStore.getAccountById(created.id)?.lastWebhookAt, "2026-03-21T12:00:00.000Z");

  reopenedStore.close();
});

test("sqlite store still rejects newer schema versions even when stale legacy tables remain", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-legacy-reject");
  const databasePath = path.join(vaultRoot, ".runtime", "device-syncd.sqlite");
  const database = openSqliteRuntimeDatabase(databasePath);

  try {
    database.exec(`
      create table device_account (
        id text primary key
      );
    `);
    writeSqliteRuntimeUserVersion(database, UNSUPPORTED_SCHEMA_VERSION);
  } finally {
    database.close();
  }

  assert.throws(
    () => new SqliteDeviceSyncStore(databasePath),
    UNSUPPORTED_SCHEMA_VERSION_RE,
  );
});

test("sqlite store persists the webhook trace claim lifecycle", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-syncd-webhook-trace-store");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));

  const baseTrace = {
    claimToken: "claim-base",
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
      receivedAt: "2099-03-27T00:00:00.000Z",
      processingExpiresAt: "2099-03-27T00:05:00.000Z",
    }),
    "claimed",
  );
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-processing",
      receivedAt: "2099-03-27T00:01:00.000Z",
      processingExpiresAt: "2099-03-27T00:06:00.000Z",
    }),
    "processing",
  );

  store.completeWebhookTrace("demo", "trace-processing", "claim-base");
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-processing",
      receivedAt: "2099-03-27T00:02:00.000Z",
      processingExpiresAt: "2099-03-27T00:07:00.000Z",
    }),
    "processed",
  );

  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-release",
      receivedAt: "2099-03-27T00:03:00.000Z",
      processingExpiresAt: "2099-03-27T00:08:00.000Z",
    }),
    "claimed",
  );
  store.releaseWebhookTrace("demo", "trace-release", "claim-base");
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-release",
      receivedAt: "2099-03-27T00:04:00.000Z",
      processingExpiresAt: "2099-03-27T00:09:00.000Z",
    }),
    "claimed",
  );

  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-stale",
      receivedAt: "2099-03-27T00:05:00.000Z",
      processingExpiresAt: "2099-03-27T00:06:00.000Z",
    }),
    "claimed",
  );
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-stale",
      receivedAt: "2099-03-27T00:07:00.000Z",
      processingExpiresAt: "2099-03-27T00:12:00.000Z",
    }),
    "claimed",
  );

  insertWebhookTraceRowForTesting(store, {
    provider: "demo",
    traceId: "trace-legacy",
    externalAccountId: "demo-legacy",
    eventType: "demo.updated",
    receivedAt: "2099-03-27T00:08:00.000Z",
    payloadJson: JSON.stringify({ resourceId: "resource-legacy" }),
  });
  assert.equal(
    store.claimWebhookTrace({
      ...baseTrace,
      traceId: "trace-legacy",
      receivedAt: "2099-03-27T00:09:00.000Z",
      processingExpiresAt: "2099-03-27T00:14:00.000Z",
    }),
    "processed",
  );

  const rows = readWebhookTraceLifecycleRowsForTesting(store, "demo");

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
      processing_expires_at: "2099-03-27T00:09:00.000Z",
    },
    {
      trace_id: "trace-stale",
      status: "processing",
      processing_expires_at: "2099-03-27T00:12:00.000Z",
    },
  ]);

  store.close();
});
