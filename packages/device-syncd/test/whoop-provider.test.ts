import assert from "node:assert/strict";
import { test } from "vitest";

import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.js";
import { subtractDays } from "../src/shared.js";

import type { DeviceSyncAccount, DeviceSyncJobRecord, ProviderJobContext, StoredDeviceSyncAccount } from "../src/types.js";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createAccount(scopes: string[], overrides: Partial<DeviceSyncAccount> = {}): DeviceSyncAccount {
  return {
    id: "acct-whoop-1",
    provider: "whoop",
    externalAccountId: "whoop-user-1",
    displayName: "whoop@example.com",
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
    ...overrides,
  };
}

function createStoredAccount(scopes: string[], overrides: Partial<StoredDeviceSyncAccount> = {}): StoredDeviceSyncAccount {
  return {
    ...createAccount(scopes),
    accessTokenEncrypted: "encrypted-access-token",
    refreshTokenEncrypted: "encrypted-refresh-token",
    ...overrides,
  };
}

function createJob(kind: string, payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    id: `job-${kind}`,
    provider: "whoop",
    accountId: "acct-whoop-1",
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

function readUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function readAuthorizationHeader(init?: RequestInit): string | null {
  return new Headers(init?.headers).get("Authorization");
}

test("WHOOP provider builds a connect URL and exchanges an auth code into a refreshable connection", async () => {
  const requests: string[] = [];
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "offline read:profile read:workout",
        });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/user/profile/basic") {
        return createJsonResponse({
          user_id: "whoop-user-1",
          first_name: "Whoop",
          last_name: "User",
          email: "whoop@example.com",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  assert.equal(
    provider.buildConnectUrl({
      state: "state-1",
      callbackUrl: "https://healthybob.test/device-sync/oauth/whoop/callback",
      scopes: ["offline", "read:profile"],
      now: "2026-03-16T10:00:00.000Z",
    }),
    "https://api.prod.whoop.com/oauth/oauth2/auth?client_id=whoop-client-id&response_type=code&redirect_uri=https%3A%2F%2Fhealthybob.test%2Fdevice-sync%2Foauth%2Fwhoop%2Fcallback&scope=offline+read%3Aprofile&state=state-1",
  );

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://healthybob.test/device-sync/oauth/whoop/callback",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: [],
    },
    "auth-code-1",
  );

  assert.equal(connection.externalAccountId, "whoop-user-1");
  assert.equal(connection.displayName, "Whoop User");
  assert.equal(connection.tokens.refreshToken, "refresh-token");
  assert.deepEqual(connection.scopes, ["offline", "read:profile", "read:workout"]);
  assert.equal(connection.initialJobs?.[0]?.kind, "backfill");
  assert.equal(connection.initialJobs?.[0]?.payload.includeProfile, true);
  assert.equal(connection.initialJobs?.[0]?.payload.includeBodyMeasurement, true);
  assert.deepEqual(connection.metadata?.profile, {
    user_id: "whoop-user-1",
    first_name: "Whoop",
    last_name: "User",
    email: "whoop@example.com",
  });
  assert.deepEqual(requests, [
    "https://api.prod.whoop.com/oauth/oauth2/token",
    "https://api.prod.whoop.com/developer/v2/user/profile/basic",
  ]);
});

test("WHOOP provider backfills snapshot windows and refreshes once after a 401", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const importedSnapshots: unknown[] = [];
  let sleepRequestCount = 0;
  let refreshCount = 0;
  const windowStart = "2026-03-15T00:00:00.000Z";
  const windowEnd = "2026-03-16T00:00:00.000Z";
  const sleepUrl = `https://api.prod.whoop.com/developer/v2/activity/sleep?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`;
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);
      const authorization = readAuthorizationHeader(init);
      requests.push({ url, authorization });

      if (url === sleepUrl) {
        sleepRequestCount += 1;

        if (sleepRequestCount === 1) {
          return createJsonResponse({ error: "unauthorized" }, 401);
        }

        return createJsonResponse({
          records: [{ id: "sleep-1", cycle_id: "cycle-1" }],
        });
      }

      if (url === `https://api.prod.whoop.com/developer/v2/recovery?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`) {
        return createJsonResponse({
          records: [{ id: "recovery-1", cycle_id: "cycle-1", score: 79 }],
        });
      }

      if (url === `https://api.prod.whoop.com/developer/v2/cycle?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`) {
        return createJsonResponse({
          records: [{ id: "cycle-1", score: 82 }],
        });
      }

      if (url === `https://api.prod.whoop.com/developer/v2/activity/workout?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`) {
        return createJsonResponse({
          records: [{ id: "workout-1", sport_name: "running" }],
        });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/user/profile/basic") {
        return createJsonResponse({
          user_id: "whoop-user-1",
          first_name: "Whoop",
          last_name: "User",
        });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/user/measurement/body") {
        return createJsonResponse({
          height_meter: 1.83,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const account = createAccount(
    ["read:sleep", "read:recovery", "read:cycles", "read:workout", "read:profile", "read:body_measurement"],
    {
      accessToken: "stale-access-token",
    },
  );
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
      refreshCount += 1;
      return createAccount(account.scopes, {
        accessToken: "fresh-access-token",
      });
    },
  };

  await provider.executeJob(
    context,
    createJob("backfill", {
      windowStart,
      windowEnd,
      includeProfile: true,
      includeBodyMeasurement: true,
    }),
  );

  assert.equal(refreshCount, 1);
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(importedSnapshots[0], {
    accountId: "whoop-user-1",
    importedAt: "2026-03-16T10:00:00.000Z",
    sleeps: [{ id: "sleep-1", cycle_id: "cycle-1" }],
    recoveries: [{ id: "recovery-1", cycle_id: "cycle-1", score: 79 }],
    cycles: [{ id: "cycle-1", score: 82 }],
    workouts: [{ id: "workout-1", sport_name: "running" }],
    profile: {
      user_id: "whoop-user-1",
      first_name: "Whoop",
      last_name: "User",
    },
    bodyMeasurement: {
      height_meter: 1.83,
    },
  });
  assert.deepEqual(
    requests.slice(0, 2),
    [
      {
        url: sleepUrl,
        authorization: "Bearer stale-access-token",
      },
      {
        url: sleepUrl,
        authorization: "Bearer fresh-access-token",
      },
    ],
  );
  assert.ok(requests.slice(2).every((request) => request.authorization === "Bearer fresh-access-token"));
});

test("WHOOP provider schedules reconcile jobs with provider-specific payload flags", () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const now = "2026-03-16T10:00:00.000Z";
  const scheduled = provider.createScheduledJobs?.(
    createStoredAccount(["offline"], {
      nextReconcileAt: "2026-03-16T04:00:00.000Z",
    }),
    now,
  );

  assert.ok(scheduled);
  assert.equal(scheduled?.jobs[0]?.kind, "reconcile");
  assert.equal(scheduled?.jobs[0]?.priority, 25);
  assert.match(scheduled?.jobs[0]?.dedupeKey ?? "", /^reconcile:[a-f0-9]{64}$/u);
  assert.deepEqual(scheduled?.jobs[0]?.payload, {
    windowStart: subtractDays(now, 21),
    windowEnd: now,
    includeProfile: false,
    includeBodyMeasurement: false,
  });
  assert.equal(scheduled?.nextReconcileAt, "2026-03-16T16:00:00.000Z");
});
