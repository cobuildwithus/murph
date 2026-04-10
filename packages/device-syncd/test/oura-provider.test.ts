import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";
import { prepareDeviceProviderSnapshotImport } from "@murphai/importers";

import { DeviceSyncError } from "../src/errors.ts";
import { createOuraDeviceSyncProvider, resolveOuraWebhookVerificationChallenge } from "../src/providers/oura.ts";
import { OURA_DEFAULT_WEBHOOK_TARGETS } from "../src/providers/oura-webhooks.ts";
import { subtractDays } from "../src/shared.ts";
import { createJsonResponse, requireValue } from "./helpers.ts";

import type { DeviceSyncAccount, DeviceSyncJobRecord, DeviceSyncProvider, ProviderJobContext } from "../src/types.ts";

function createAccount(scopes: string[]): DeviceSyncAccount {
  return {
    id: "acct-oura-1",
    provider: "oura",
    externalAccountId: "oura-user-1",
    disconnectGeneration: 0,
    displayName: "oura@example.com",
    status: "active",
    scopes,
    accessTokenExpiresAt: null,
    metadata: {},
    connectedAt: "2026-03-16T00:00:00.000Z",
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: "2026-03-16T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
    accessToken: "access-token",
    refreshToken: "refresh-token",
  };
}

function createJob(kind: string, payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    id: `job-${kind}`,
    provider: "oura",
    accountId: "acct-oura-1",
    kind,
    payload,
    priority: 100,
    availableAt: "2026-03-16T10:00:00.000Z",
    attempts: 0,
    maxAttempts: 5,
    dedupeKey: null,
    status: "queued",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: "2026-03-16T10:00:00.000Z",
    updatedAt: "2026-03-16T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  };
}

function createOuraWebhookSignature(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac("sha256", secret).update(`${timestamp}${rawBody.toString("utf8")}`).digest("hex");
}

function createOuraWebhookEncodedSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  encoding: "base64" | "base64url" | "hex",
): string {
  return createHmac("sha256", secret).update(`${timestamp}${rawBody.toString("utf8")}`).digest(encoding);
}

function createOuraWebhookHeaders(secret: string, timestamp: string, rawBody: Buffer): Headers {
  return new Headers({
    "x-oura-signature": createOuraWebhookSignature(secret, timestamp, rawBody),
    "x-oura-timestamp": timestamp,
  });
}

function requireVerifyAndParseWebhook(
  provider: DeviceSyncProvider,
): NonNullable<DeviceSyncProvider["verifyAndParseWebhook"]> {
  return requireValue(provider.verifyAndParseWebhook);
}

test("Oura provider exchanges an auth code into a refreshable connection", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "extapi:personal extapi:daily extapi:heartrate",
        });
      }

      if (url === "https://api.ouraring.com/v2/usercollection/personal_info") {
        return createJsonResponse({
          id: "oura-user-1",
          email: "oura@example.com",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      state: "state-1",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: [],
    },
    "auth-code-1",
  );

  assert.equal(connection.externalAccountId, "oura-user-1");
  assert.equal(connection.displayName, "oura@example.com");
  assert.equal(connection.tokens.refreshToken, "refresh-token");
  assert.deepEqual(connection.scopes, ["personal", "daily", "heartrate"]);
  assert.equal(connection.initialJobs?.[0]?.kind, "backfill");
  assert.equal(connection.metadata, undefined);
  assert.deepEqual(requests, [
    "https://api.ouraring.com/oauth/token",
    "https://api.ouraring.com/v2/usercollection/personal_info",
  ]);
});

test("Oura provider normalizes extapi-prefixed token scopes from token responses", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "extapi:personal extapi:daily extapi:heartrate",
        });
      }

      if (url === "https://api.ouraring.com/v2/usercollection/personal_info") {
        return createJsonResponse({
          id: "oura-user-1",
          email: "oura@example.com",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      state: "state-1",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: [],
    },
    "auth-code-1",
  );

  assert.deepEqual(connection.scopes, ["personal", "daily", "heartrate"]);
});

test("Oura provider requires a replacement refresh token during refresh", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "refreshed-access-token",
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    provider.refreshTokens(createAccount(["personal"])),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_REFRESH_TOKEN_ROTATION_MISSING" &&
      error.accountStatus === "reauthorization_required",
  );
});

test("Oura provider requires an existing refresh token before attempting refresh", async () => {
  let fetchCalled = false;
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("refresh should not reach the token endpoint without a refresh token");
    },
  });

  await assert.rejects(
    provider.refreshTokens({
      ...createAccount(["personal"]),
      refreshToken: null,
    }),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_REFRESH_TOKEN_MISSING" &&
      error.accountStatus === "reauthorization_required",
  );
  assert.equal(fetchCalled, false);
});

test("Oura provider rejects auth exchanges without a refresh token and personal-info ids", async () => {
  const missingRefreshProvider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          expires_in: 3600,
          scope: "extapi:personal",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      missingRefreshProvider.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
          state: "state-missing-refresh",
          now: "2026-03-16T10:00:00.000Z",
          grantedScopes: [],
        },
        "auth-code-missing-refresh",
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_REFRESH_TOKEN_MISSING" &&
      error.httpStatus === 502,
  );

  const missingProfileIdProvider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "extapi:personal",
        });
      }

      if (url === "https://api.ouraring.com/v2/usercollection/personal_info") {
        return createJsonResponse({
          email: "oura@example.com",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      missingProfileIdProvider.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
          state: "state-missing-profile-id",
          now: "2026-03-16T10:00:00.000Z",
          grantedScopes: [],
        },
        "auth-code-missing-profile-id",
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_PROFILE_INVALID" &&
      error.httpStatus === 502,
  );
});

test("Oura provider backfills snapshot windows with polling-friendly collection fetches", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url === "https://api.ouraring.com/v2/usercollection/personal_info") {
        return createJsonResponse({
          id: "oura-user-1",
          email: "oura@example.com",
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/daily_activity?")) {
        return createJsonResponse({
          data: [{ day: "2026-03-15", score: 80, steps: 10000 }],
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/daily_sleep?")) {
        return createJsonResponse({
          data: [{ day: "2026-03-15", score: 84 }],
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/daily_readiness?")) {
        return createJsonResponse({
          data: [{ day: "2026-03-15", score: 76 }],
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/sleep?")) {
        return createJsonResponse({
          data: [{ id: "sleep-1", type: "sleep" }],
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/daily_spo2?")) {
        return createJsonResponse({
          data: [{ day: "2026-03-15", spo2_percentage: { average: 97.2 } }],
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/session?")) {
        return createJsonResponse({
          data: [{ id: "session-1", type: "meditation" }],
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/workout?")) {
        return createJsonResponse({
          data: [{ id: "workout-1", activity: "running" }],
        });
      }

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/heartrate?")) {
        return createJsonResponse({
          data: [{ timestamp: "2026-03-15T12:00:00.000Z", bpm: 64 }],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const account = createAccount(["personal", "daily", "session", "workout", "heartrate", "spo2"]);
  const context: ProviderJobContext = {
    account,
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return {
        ok: true,
      };
    },
    async refreshAccountTokens() {
      throw new Error("refresh should not be called in this test");
    },
  };

  await provider.executeJob(
    context,
    createJob("backfill", {
      windowStart: "2026-03-15T00:00:00.000Z",
      windowEnd: "2026-03-16T00:00:00.000Z",
      includePersonalInfo: true,
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(importedSnapshots[0], {
    accountId: "oura-user-1",
    importedAt: "2026-03-16T10:00:00.000Z",
    personalInfo: {
      id: "oura-user-1",
      email: "oura@example.com",
    },
    dailyActivity: [{ day: "2026-03-15", score: 80, steps: 10000 }],
    dailySleep: [{ day: "2026-03-15", score: 84 }],
    dailyReadiness: [{ day: "2026-03-15", score: 76 }],
    sleeps: [{ id: "sleep-1", type: "sleep" }],
    dailySpO2: [{ day: "2026-03-15", spo2_percentage: { average: 97.2 } }],
    sessions: [{ id: "session-1", type: "meditation" }],
    workouts: [{ id: "workout-1", activity: "running" }],
    heartrate: [{ timestamp: "2026-03-15T12:00:00.000Z", bpm: 64 }],
  });
  assert.ok(requests.some((url) => url.includes("/v2/usercollection/daily_activity?")));
  assert.ok(requests.some((url) => url.includes("/v2/usercollection/heartrate?")));
  assert.equal(provider.descriptor.webhook?.path, "/webhooks/oura");
});

test("Oura provider splits heartrate backfills into 30-day chunks", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/heartrate?")) {
        const search = new URL(url).searchParams;
        const start = search.get("start_datetime");

        return createJsonResponse({
          data: start ? [{ timestamp: start, bpm: 64 }] : [],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["heartrate"]),
    now: "2026-04-05T00:00:00.000Z",
    logger: {},
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return {
        ok: true,
      };
    },
    async refreshAccountTokens() {
      throw new Error("refresh should not be called in this test");
    },
  };

  await provider.executeJob(
    context,
    createJob("backfill", {
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
      includePersonalInfo: false,
    }),
  );

  const heartrateRequests = requests
    .filter((url) => url.startsWith("https://api.ouraring.com/v2/usercollection/heartrate?"))
    .map((url) => {
      const search = new URL(url).searchParams;
      return {
        start: search.get("start_datetime"),
        end: search.get("end_datetime"),
      };
    });

  assert.deepEqual(heartrateRequests, [
    {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-31T00:00:00.000Z",
    },
    {
      start: "2026-01-31T00:00:00.000Z",
      end: "2026-03-02T00:00:00.000Z",
    },
    {
      start: "2026-03-02T00:00:00.000Z",
      end: "2026-04-01T00:00:00.000Z",
    },
    {
      start: "2026-04-01T00:00:00.000Z",
      end: "2026-04-05T00:00:00.000Z",
    },
  ]);
  assert.deepEqual(importedSnapshots[0], {
    accountId: "oura-user-1",
    importedAt: "2026-04-05T00:00:00.000Z",
    heartrate: [
      { timestamp: "2026-01-01T00:00:00.000Z", bpm: 64 },
      { timestamp: "2026-01-31T00:00:00.000Z", bpm: 64 },
      { timestamp: "2026-03-02T00:00:00.000Z", bpm: 64 },
      { timestamp: "2026-04-01T00:00:00.000Z", bpm: 64 },
    ],
  });
});

test("Oura provider rejects invalid heartrate window payloads", async () => {
  let fetchCalled = false;
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called for invalid window payloads");
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["heartrate"]),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot() {
      throw new Error("invalid windows should not reach importSnapshot");
    },
    async refreshAccountTokens() {
      throw new Error("refresh should not be called in this test");
    },
  };

  await assert.rejects(
    provider.executeJob(
      context,
      createJob("backfill", {
        windowStart: "not-a-date",
        windowEnd: "2026-03-16T00:00:00.000Z",
        includePersonalInfo: false,
      }),
    ),
    (error) => error instanceof RangeError,
  );
  assert.equal(fetchCalled, false);
});

test("Oura provider falls back to granted scopes and rejects connections without the personal scope", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }

      if (url === "https://api.ouraring.com/v2/usercollection/personal_info") {
        return createJsonResponse({
          id: "oura-user-granted",
          email: "granted@example.com",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const grantedScopeConnection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      state: "state-2",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: ["personal", "workout"],
    },
    "auth-code-granted",
  );

  assert.deepEqual(grantedScopeConnection.scopes, ["personal", "workout"]);
  assert.equal(grantedScopeConnection.externalAccountId, "oura-user-granted");
  assert.deepEqual(requests, [
    "https://api.ouraring.com/oauth/token",
    "https://api.ouraring.com/v2/usercollection/personal_info",
  ]);

  await assert.rejects(
    () =>
      provider.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
          state: "state-3",
          now: "2026-03-16T10:00:00.000Z",
          grantedScopes: ["workout"],
        },
        "auth-code-without-personal",
      ),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_PERSONAL_SCOPE_REQUIRED" &&
      error.httpStatus === 400,
  );
});

test("Oura provider turns non-operation webhook events into reconcile hints and rejects stale signed deliveries", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "sync_completed",
      data_type: "workout",
      object_id: "workout-99",
      user_id: "oura-user-1",
    }),
    "utf8",
  );
  const timestamp = "2026-03-16T09:58:10.000Z";

  const parsed = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", timestamp, rawBody),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });

  assert.deepEqual(parsed, {
    externalAccountId: "oura-user-1",
    eventType: "sync_completed",
    traceId: parsed?.traceId,
    occurredAt: "2026-03-16T10:00:00.000Z",
    payload: {
      eventType: "sync_completed",
      dataType: "workout",
      operation: null,
    },
    jobs: [
      {
        kind: "reconcile",
        priority: 90,
        dedupeKey: `oura-webhook:${parsed?.traceId}`,
        payload: {
          windowStart: "2026-02-23T10:00:00.000Z",
          windowEnd: "2026-03-16T10:00:00.000Z",
          includePersonalInfo: false,
        },
      },
    ],
  });

  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: createOuraWebhookHeaders("oura-client-secret", timestamp, rawBody),
        rawBody,
        now: "2026-03-16T10:10:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_WEBHOOK_TIMESTAMP_INVALID" &&
      error.httpStatus === 400,
  );
});

test("Oura provider validates webhook signatures and turns notifications into resource-scoped hints", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "daily_sleep.updated",
      data_type: "daily_sleep",
      object_id: "daily-sleep-1",
      user_id: "oura-user-1",
      timestamp: "2026-03-16T09:58:00.000Z",
    }),
    "utf8",
  );
  const timestamp = "2026-03-16T09:58:10.000Z";

  const parsed = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", timestamp, rawBody),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });

  assert.deepEqual(parsed, {
    externalAccountId: "oura-user-1",
    eventType: "daily_sleep.updated",
    traceId: parsed?.traceId,
    occurredAt: "2026-03-16T09:58:00.000Z",
    payload: {
      eventType: "daily_sleep.updated",
      dataType: "daily_sleep",
      operation: "update",
    },
    jobs: [
      {
        kind: "resource",
        priority: 90,
        dedupeKey: parsed?.jobs[0]?.dedupeKey,
        payload: {
          dataType: "daily_sleep",
          objectId: "daily-sleep-1",
          occurredAt: "2026-03-16T09:58:00.000Z",
          windowStart: "2026-02-23T10:00:00.000Z",
          windowEnd: "2026-03-16T10:00:00.000Z",
          includePersonalInfo: false,
        },
      },
    ],
  });
  assert.match(parsed?.traceId ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(parsed?.jobs[0]?.dedupeKey, `oura-webhook:${parsed?.traceId}`);
});

test("Oura provider accepts uppercase hexadecimal webhook signatures", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "update",
      data_type: "daily_sleep",
      object_id: "daily-sleep-1",
      user_id: "oura-user-1",
      timestamp: "2026-03-16T09:58:00.000Z",
    }),
    "utf8",
  );
  const timestamp = "2026-03-16T09:58:10.000Z";
  const signature = createOuraWebhookSignature("oura-client-secret", timestamp, rawBody)
    .toUpperCase();

  const parsed = await verifyAndParseWebhook({
    headers: new Headers({
      "x-oura-signature": signature,
      "x-oura-timestamp": timestamp,
    }),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });

  assert.equal(parsed?.eventType, "daily_sleep.updated");
  assert.equal(parsed?.payload?.dataType, "daily_sleep");
});

test("Oura provider accepts base64 webhook signatures and falls back to the request time when event_time is absent", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "update",
      data_type: "workout",
      object_id: "workout-1",
      user_id: "oura-user-1",
    }),
    "utf8",
  );
  const timestamp = "2026-03-16T09:58:10.000Z";
  const now = "2026-03-16T10:00:00.000Z";
  const reconcileDays = provider.descriptor.sync?.windows.reconcileDays ?? 0;

  const parsed = await verifyAndParseWebhook({
    headers: new Headers({
      "x-oura-signature": createOuraWebhookEncodedSignature("oura-client-secret", timestamp, rawBody, "base64"),
      "x-oura-timestamp": timestamp,
    }),
    rawBody,
    now,
  });

  assert.deepEqual(parsed, {
    externalAccountId: "oura-user-1",
    eventType: "workout.updated",
    traceId: parsed?.traceId,
    occurredAt: now,
    payload: {
      eventType: "workout.updated",
      dataType: "workout",
      operation: "update",
    },
    jobs: [
      {
        kind: "resource",
        priority: 90,
        dedupeKey: `oura-webhook:${parsed?.traceId}`,
        payload: {
          dataType: "workout",
          objectId: "workout-1",
          occurredAt: now,
          windowStart: subtractDays(now, reconcileDays),
          windowEnd: now,
          includePersonalInfo: false,
        },
      },
    ],
  });
});

test("Oura webhook verification challenge helper returns the challenge only for the configured token", () => {
  const challenge = resolveOuraWebhookVerificationChallenge({
    url: new URL(
      "https://sync.example.test/api/device-sync/webhooks/oura?verification_token=verify-token&challenge=random-challenge",
    ),
    verificationToken: "verify-token",
  });

  assert.equal(challenge, "random-challenge");
  assert.throws(
    () =>
      resolveOuraWebhookVerificationChallenge({
        url: new URL(
          "https://sync.example.test/api/device-sync/webhooks/oura?verification_token=wrong&challenge=random-challenge",
        ),
        verificationToken: "verify-token",
      }),
    /verification token/u,
  );
});

test("Oura provider webhook admin no-ops without a verification token and reuses the shared subscription client when one is configured", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(`${init?.method ?? "GET"} ${url}`);

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && (init?.method ?? "GET") === "GET") {
        return createJsonResponse({
          data: OURA_DEFAULT_WEBHOOK_TARGETS.map((target, index) => ({
            id: `sub-${index + 1}`,
            callback_url: "https://sync.example.test/device-sync/webhooks/oura",
            event_type: target.eventType,
            data_type: target.dataType,
            expiration_time: "2030-01-01T00:00:00.000Z",
          })),
        });
      }

      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    },
  });
  const webhookAdmin = requireValue(provider.webhookAdmin);
  const ensureSubscriptions = requireValue(webhookAdmin.ensureSubscriptions);

  await ensureSubscriptions({
    publicBaseUrl: "https://sync.example.test/device-sync",
    verificationToken: "   ",
  });
  assert.deepEqual(requests, []);

  await ensureSubscriptions({
    publicBaseUrl: "https://sync.example.test/device-sync",
    verificationToken: "verify-token-for-tests",
  });

  assert.deepEqual(requests, [
    "GET https://api.ouraring.com/v2/webhook/subscription",
    "GET https://api.ouraring.com/v2/webhook/subscription",
  ]);
});

test("Oura provider accepts documented numeric-second timestamps, uses event_time, and imports delete webhooks as deletion snapshots", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "delete",
      data_type: "session",
      object_id: "session-42",
      user_id: "oura-user-1",
      event_time: "2026-03-16T09:58:00.000Z",
    }),
    "utf8",
  );
  const timestamp = String(Math.floor(Date.parse("2026-03-16T10:00:00.000Z") / 1000));
  const parsed = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", timestamp, rawBody),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });

  assert.deepEqual(parsed, {
    externalAccountId: "oura-user-1",
    eventType: "session.deleted",
    traceId: parsed?.traceId,
    occurredAt: "2026-03-16T09:58:00.000Z",
    payload: {
      eventType: "session.deleted",
      dataType: "session",
      operation: "delete",
    },
    jobs: [
      {
        kind: "delete",
        priority: 95,
        dedupeKey: parsed?.jobs[0]?.dedupeKey,
        payload: {
          sourceEventType: "session.deleted",
          dataType: "session",
          objectId: "session-42",
          occurredAt: "2026-03-16T09:58:00.000Z",
        },
      },
    ],
  });

  const context: ProviderJobContext = {
    account: createAccount(["session"]),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return { ok: true };
    },
    async refreshAccountTokens() {
      throw new Error("refreshAccountTokens should not be called");
    },
  };

  await provider.executeJob(context, createJob("delete", parsed?.jobs[0]?.payload ?? {}));

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "oura-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      deletions: [
        {
          resource_type: "session",
          resource_id: "session-42",
          occurred_at: "2026-03-16T09:58:00.000Z",
          source_event_type: "session.deleted",
        },
      ],
    },
  ]);

  const normalizedPayload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    snapshot: importedSnapshots[0],
  });
  const deletionEvent = normalizedPayload.events?.find((event) => event.externalRef?.facet === "deleted");

  assert.equal(deletionEvent?.externalRef?.resourceType, "session");
  assert.equal(deletionEvent?.fields?.metric, "external-resource-deleted");
  assert.equal(deletionEvent?.fields?.sourceEventType, "session.deleted");
});

test("Oura provider imports hosted-narrowed delete wake payloads as deletion snapshots", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const context: ProviderJobContext = {
    account: createAccount(["session"]),
    now: "2026-03-27T08:05:00.000Z",
    logger: {},
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return { ok: true };
    },
    async refreshAccountTokens() {
      throw new Error("refreshAccountTokens should not be called");
    },
  };

  await provider.executeJob(context, createJob("delete", {
    dataType: "session",
    objectId: "session-42",
    occurredAt: "2026-03-27T08:03:00.000Z",
    sourceEventType: "session.deleted",
  }));

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "oura-user-1",
      importedAt: "2026-03-27T08:05:00.000Z",
      deletions: [
        {
          resource_type: "session",
          resource_id: "session-42",
          occurred_at: "2026-03-27T08:03:00.000Z",
          source_event_type: "session.deleted",
        },
      ],
    },
  ]);
});

test("Oura provider fallback trace ids ignore transport timestamps when the webhook body is unchanged", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "update",
      data_type: "workout",
      object_id: "workout-7",
      user_id: "oura-user-1",
      event_time: "2026-03-16T09:58:00.000Z",
    }),
    "utf8",
  );
  const first = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", "2026-03-16T10:00:00.000Z", rawBody),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });
  const second = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", "2026-03-16T10:05:00.000Z", rawBody),
    rawBody,
    now: "2026-03-16T10:05:00.000Z",
  });

  assert.equal(first?.traceId, second?.traceId);
  assert.equal(first?.jobs[0]?.dedupeKey, second?.jobs[0]?.dedupeKey);
});

test("Oura webhook resource jobs fetch only the hinted collection and keep the matching object id", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/workout?")) {
        return createJsonResponse({
          data: [
            {
              id: "workout-2",
              activity: "running",
              start_datetime: "2026-03-16T09:00:00.000Z",
              end_datetime: "2026-03-16T09:45:00.000Z",
              timestamp: "2026-03-16T09:50:00.000Z",
            },
            {
              id: "workout-3",
              activity: "cycling",
              start_datetime: "2026-03-16T11:00:00.000Z",
              end_datetime: "2026-03-16T11:30:00.000Z",
              timestamp: "2026-03-16T11:35:00.000Z",
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["workout"]),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return { ok: true };
    },
    async refreshAccountTokens() {
      throw new Error("refreshAccountTokens should not be called");
    },
  };

  await provider.executeJob(
    context,
    createJob("resource", {
      dataType: "workout",
      objectId: "workout-2",
      occurredAt: "2026-03-16T09:58:00.000Z",
      sourceEventType: "workout.updated",
    }),
  );

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "oura-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      workouts: [
        {
          id: "workout-2",
          activity: "running",
          start_datetime: "2026-03-16T09:00:00.000Z",
          end_datetime: "2026-03-16T09:45:00.000Z",
          timestamp: "2026-03-16T09:50:00.000Z",
        },
      ],
    },
  ]);
  assert.equal(requests.length, 1);
  assert.match(requests[0] ?? "", /\/v2\/usercollection\/workout\?/u);
});

test("Oura webhook resource jobs keep object scope even when the hinted object is missing from narrow and broader retries", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/workout?")) {
        return createJsonResponse({
          data: [
            {
              id: "workout-3",
              activity: "cycling",
              start_datetime: "2026-03-16T11:00:00.000Z",
              end_datetime: "2026-03-16T11:30:00.000Z",
              timestamp: "2026-03-16T11:35:00.000Z",
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["workout"]),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return { ok: true };
    },
    async refreshAccountTokens() {
      throw new Error("refreshAccountTokens should not be called");
    },
  };

  await provider.executeJob(
    context,
    createJob("resource", {
      dataType: "workout",
      objectId: "workout-2",
      occurredAt: "2026-03-16T09:58:00.000Z",
      sourceEventType: "workout.updated",
    }),
  );

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "oura-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      workouts: [],
    },
  ]);
  assert.equal(requests.length, 2);
  assert.match(requests[0] ?? "", /start_date=2026-03-16/u);
  assert.match(requests[1] ?? "", /start_date=2026-02-23/u);
});

test("Oura webhook rejects malformed timestamp headers even when the signature matches", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "daily_sleep.updated",
      data_type: "daily_sleep",
      object_id: "daily-sleep-1",
      user_id: "oura-user-1",
      timestamp: "2026-03-16T09:58:00.000Z",
    }),
    "utf8",
  );
  const timestamp = "not-a-real-timestamp";
  const signature = createOuraWebhookSignature("oura-client-secret", timestamp, rawBody);

  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: new Headers({
          "x-oura-signature": signature,
          "x-oura-timestamp": timestamp,
        }),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) => error instanceof DeviceSyncError && error.code === "OURA_WEBHOOK_TIMESTAMP_INVALID",
  );
});

test("Oura webhook rejects missing or invalid signatures before parsing the payload", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "update",
      data_type: "workout",
      object_id: "workout-1",
      user_id: "oura-user-1",
    }),
    "utf8",
  );
  const timestamp = "2026-03-16T09:58:10.000Z";

  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: new Headers({
          "x-oura-timestamp": timestamp,
        }),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_WEBHOOK_SIGNATURE_MISSING" &&
      error.httpStatus === 400,
  );
  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: new Headers({
          "x-oura-signature": "invalid-signature",
          "x-oura-timestamp": timestamp,
        }),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_WEBHOOK_SIGNATURE_INVALID" &&
      error.httpStatus === 401,
  );
});

test("Oura provider rejects invalid webhook payloads, schedules reconcile jobs, and rejects unsupported job kinds", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const reconcileProvider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.ouraring.com/v2/usercollection/personal_info") {
        return createJsonResponse({});
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "update",
      data_type: "workout",
      user_id: "oura-user-1",
    }),
    "utf8",
  );
  const timestamp = "2026-03-16T09:58:10.000Z";

  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: createOuraWebhookHeaders("oura-client-secret", timestamp, rawBody),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_WEBHOOK_PAYLOAD_INVALID" &&
      error.httpStatus === 400,
  );

  const scheduled = reconcileProvider.createScheduledJobs?.(
    {
      ...createAccount(["personal"]),
      nextReconcileAt: "2026-03-16T09:00:00.000Z",
      accessTokenEncrypted: "encrypted-access-token",
      refreshTokenEncrypted: "encrypted-refresh-token",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: null,
    },
    "2026-03-16T10:00:00.000Z",
  );
  assert.equal(scheduled?.jobs[0]?.kind, "reconcile");
  assert.deepEqual(scheduled?.jobs[0]?.payload, {
    windowStart: subtractDays("2026-03-16T10:00:00.000Z", 21),
    windowEnd: "2026-03-16T10:00:00.000Z",
    includePersonalInfo: false,
  });

  const importedSnapshots: unknown[] = [];
  await reconcileProvider.executeJob(
    {
      account: createAccount(["personal"]),
      async importSnapshot(snapshot) {
        importedSnapshots.push(snapshot);
        return { ok: true };
      },
      logger: {},
      now: "2026-03-16T10:00:00.000Z",
      async refreshAccountTokens() {
        return createAccount(["personal"]);
      },
    },
    createJob("reconcile", {
      includePersonalInfo: true,
    }),
  );
  assert.deepEqual(importedSnapshots, [
    {
      accountId: "oura-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      personalInfo: {},
    },
  ]);

  await assert.rejects(
    () =>
      provider.executeJob(
        {
          account: createAccount(["personal"]),
          async importSnapshot() {
            return { ok: true };
          },
          logger: {},
          now: "2026-03-16T10:00:00.000Z",
          async refreshAccountTokens() {
            return createAccount(["personal"]);
          },
        },
        createJob("webhook", {}),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_JOB_KIND_UNSUPPORTED",
  );
});

test("Oura provider exposes the connect URL, forwards webhook verification through the admin surface, and falls back to reconcile for unscoped resource jobs", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });
  const webhookAdmin = requireValue(provider.webhookAdmin);
  const resolveVerificationChallenge = requireValue(webhookAdmin.resolveVerificationChallenge);
  const fallbackSnapshots: unknown[] = [];

  assert.equal(
    provider.buildConnectUrl({
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      scopes: ["personal", "workout"],
      state: "state-connect",
      now: "2026-03-16T10:00:00.000Z",
    }),
    "https://cloud.ouraring.com/oauth/authorize?client_id=oura-client-id&response_type=code&redirect_uri=https%3A%2F%2Fsync.example.test%2Fdevice-sync%2Foauth%2Foura%2Fcallback&scope=personal+workout&state=state-connect",
  );
  assert.equal(
    resolveVerificationChallenge({
      url: new URL("https://sync.example.test/device-sync/webhooks/oura?verification_token=verify-token&challenge=challenge-123"),
      verificationToken: "verify-token",
    }),
    "challenge-123",
  );

  await provider.executeJob(
    {
      account: createAccount(["personal"]),
      async importSnapshot(snapshot) {
        fallbackSnapshots.push(snapshot);
        return { ok: true };
      },
      logger: {},
      now: "2026-03-16T10:00:00.000Z",
      async refreshAccountTokens() {
        return createAccount(["personal"]);
      },
    },
    createJob("resource", {
      objectId: "missing-data-type",
    }),
  );

  assert.deepEqual(fallbackSnapshots, [
    {
      accountId: "oura-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
    },
  ]);
  await assert.rejects(
    () =>
      provider.executeJob(
        {
          account: createAccount(["personal"]),
          async importSnapshot() {
            return { ok: true };
          },
          logger: {},
          now: "2026-03-16T10:00:00.000Z",
          async refreshAccountTokens() {
            return createAccount(["personal"]);
          },
        },
        createJob("delete", {
          dataType: "workout",
        }),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_DELETE_JOB_INVALID",
  );
});
