import assert from "node:assert/strict";
import { test } from "vitest";

import { createOuraDeviceSyncProvider } from "../src/providers/oura.js";

import type { DeviceSyncAccount, DeviceSyncJobRecord, ProviderJobContext } from "../src/types.js";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createAccount(scopes: string[]): DeviceSyncAccount {
  return {
    id: "acct-oura-1",
    provider: "oura",
    externalAccountId: "oura-user-1",
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
      callbackUrl: "https://healthybob.test/device-sync/oauth/oura/callback",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: ["personal", "daily", "heartrate"],
    },
    "auth-code-1",
  );

  assert.equal(connection.externalAccountId, "oura-user-1");
  assert.equal(connection.displayName, "oura@example.com");
  assert.equal(connection.tokens.refreshToken, "refresh-token");
  assert.deepEqual(connection.scopes, ["personal", "daily", "heartrate"]);
  assert.equal(connection.initialJobs?.[0]?.kind, "backfill");
  assert.deepEqual(connection.metadata?.personalInfo, {
    id: "oura-user-1",
    email: "oura@example.com",
  });
  assert.deepEqual(requests, [
    "https://api.ouraring.com/oauth/token",
    "https://api.ouraring.com/v2/usercollection/personal_info",
  ]);
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
  assert.equal(provider.webhookPath, undefined);
});
