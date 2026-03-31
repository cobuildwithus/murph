import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.ts";
import { sha256Text, subtractDays } from "../src/shared.ts";

import type { DeviceSyncAccount, DeviceSyncJobRecord, ProviderJobContext, StoredDeviceSyncAccount } from "../src/types.ts";

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
    hostedObservedTokenVersion: null,
    hostedObservedUpdatedAt: null,
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

function readRequestBody(init?: RequestInit): string | null {
  if (typeof init?.body === "string") {
    return init.body;
  }

  return init?.body instanceof URLSearchParams ? init.body.toString() : null;
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
      callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
      scopes: ["offline", "read:profile"],
      now: "2026-03-16T10:00:00.000Z",
    }),
    "https://api.prod.whoop.com/oauth/oauth2/auth?client_id=whoop-client-id&response_type=code&redirect_uri=https%3A%2F%2Fsync.example.test%2Fdevice-sync%2Foauth%2Fwhoop%2Fcallback&scope=offline+read%3Aprofile&state=state-1",
  );

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
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
  assert.deepEqual(connection.initialJobs?.[0]?.payload, {
    windowStart: "2025-12-16T10:00:00.000Z",
    windowEnd: "2026-03-16T10:00:00.000Z",
  });
  assert.equal(connection.metadata, undefined);
  assert.deepEqual(requests, [
    "https://api.prod.whoop.com/oauth/oauth2/token",
    "https://api.prod.whoop.com/developer/v2/user/profile/basic",
  ]);
});

test("WHOOP provider avoids persisting connect-time profile or body measurement metadata", async () => {
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
          scope: "offline read:profile read:body_measurement",
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

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: [],
    },
    "auth-code-1",
  );

  assert.equal(connection.metadata, undefined);
  assert.deepEqual(requests, [
    "https://api.prod.whoop.com/oauth/oauth2/token",
    "https://api.prod.whoop.com/developer/v2/user/profile/basic",
  ]);
});

test("WHOOP provider keeps the stored refresh token when refresh omits a replacement", async () => {
  let requestBody: string | null = null;
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        requestBody = readRequestBody(init);
        return createJsonResponse({
          access_token: "refreshed-access-token",
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const tokens = await provider.refreshTokens(
    createAccount(["offline"], {
      refreshToken: "persisted-refresh-token",
    }),
  );

  assert.equal(tokens.accessToken, "refreshed-access-token");
  assert.equal(tokens.refreshToken, "persisted-refresh-token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("grant_type"), "refresh_token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("refresh_token"), "persisted-refresh-token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("scope"), "offline");
});

test("WHOOP provider requires an existing refresh token before attempting refresh", async () => {
  let fetchCalled = false;
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("refresh should not reach the token endpoint without a refresh token");
    },
  });

  await assert.rejects(
    provider.refreshTokens(
      createAccount(["offline"], {
        refreshToken: null,
      }),
    ),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_REFRESH_TOKEN_MISSING" &&
      error.accountStatus === "reauthorization_required",
  );
  assert.equal(fetchCalled, false);
});

test("WHOOP provider revokes with the persisted access token even when it is near expiry", async () => {
  const requests: Array<{ authorization: string | null; method: string; url: string }> = [];
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);
      requests.push({
        authorization: readAuthorizationHeader(init),
        method: init?.method ?? "GET",
        url,
      });

      if (url === "https://api.prod.whoop.com/developer/v2/user/access") {
        return new Response(null, {
          status: 204,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await provider.revokeAccess(
    createAccount(["offline"], {
      accessToken: "persisted-access-token",
      accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      refreshToken: "rotating-refresh-token",
    }),
  );

  assert.deepEqual(requests, [
    {
      authorization: "Bearer persisted-access-token",
      method: "DELETE",
      url: "https://api.prod.whoop.com/developer/v2/user/access",
    },
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

test("WHOOP provider schedules reconcile jobs without profile/body-measurement sync flags", () => {
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
  });
  assert.equal(scheduled?.nextReconcileAt, "2026-03-16T16:00:00.000Z");
});

test("WHOOP provider maps webhook events to the same job kinds, priorities, and payload fields", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });

  const cases = [
    { eventType: "sleep.updated", kind: "resource", resourceType: "sleep", priority: 90 },
    { eventType: "recovery.updated", kind: "resource", resourceType: "recovery", priority: 90 },
    { eventType: "workout.updated", kind: "resource", resourceType: "workout", priority: 90 },
    { eventType: "sleep.deleted", kind: "delete", resourceType: "sleep", priority: 95 },
    { eventType: "recovery.deleted", kind: "delete", resourceType: "recovery", priority: 95 },
    { eventType: "workout.deleted", kind: "delete", resourceType: "workout", priority: 95 },
  ] as const;

  for (const testCase of cases) {
    const webhookPayload = {
      user_id: "whoop-user-1",
      type: testCase.eventType,
      id: "resource-1",
      trace_id: `trace:${testCase.eventType}`,
    };
    const rawBody = Buffer.from(JSON.stringify(webhookPayload), "utf8");
    const now = "2026-03-16T10:00:00.000Z";
    const result = await provider.verifyAndParseWebhook?.({
      headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, String(Date.parse(now))),
      rawBody,
      now,
    });

    assert.ok(result);
    assert.equal(result?.eventType, testCase.eventType);
    assert.equal(result?.externalAccountId, "whoop-user-1");
    assert.equal(result?.traceId, `trace:${testCase.eventType}`);
    assert.deepEqual(result?.payload, {
      eventType: testCase.eventType,
      resourceType: testCase.resourceType,
    });
    assert.deepEqual(result?.jobs, [
      {
        kind: testCase.kind,
        priority: testCase.priority,
        dedupeKey: `whoop-webhook:trace:${testCase.eventType}`,
        payload: {
          resourceType: testCase.resourceType,
          resourceId: "resource-1",
          eventType: testCase.eventType,
        },
      },
    ]);
  }
});

test("WHOOP provider synthesizes a deterministic trace id and job dedupe key when trace_id is missing", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const webhookPayload = {
    user_id: "whoop-user-1",
    type: "sleep.updated",
    id: "resource-1",
  };
  const rawBody = Buffer.from(JSON.stringify(webhookPayload), "utf8");
  const timestamp = String(Date.parse("2026-03-16T10:00:00.000Z"));
  const parsed = await provider.verifyAndParseWebhook?.({
    headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, timestamp),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });

  const expectedTraceId = sha256Text(
    `whoop-user-1:sleep.updated:resource-1:${sha256Text(rawBody.toString("utf8"))}`,
  );

  assert.equal(parsed?.traceId, expectedTraceId);
  assert.equal(parsed?.jobs[0]?.dedupeKey, `whoop-webhook:${expectedTraceId}`);
  assert.deepEqual(parsed?.jobs[0]?.payload, {
    resourceType: "sleep",
    resourceId: "resource-1",
    eventType: "sleep.updated",
  });
});

test("WHOOP provider keeps the same synthetic trace id across retry deliveries with a new signature timestamp", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const webhookPayload = {
    user_id: "whoop-user-1",
    type: "sleep.deleted",
    id: "resource-1",
    occurred_at: "2026-03-16T10:00:00.000Z",
  };
  const rawBody = Buffer.from(JSON.stringify(webhookPayload), "utf8");
  const firstTimestamp = String(Date.parse("2026-03-16T10:00:00.000Z"));
  const retryTimestamp = String(Date.parse("2026-03-16T10:20:00.000Z"));

  const first = await provider.verifyAndParseWebhook?.({
    headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, firstTimestamp),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });
  const retry = await provider.verifyAndParseWebhook?.({
    headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, retryTimestamp),
    rawBody,
    now: "2026-03-16T10:20:00.000Z",
  });

  assert.equal(retry?.traceId, first?.traceId);
  assert.equal(retry?.jobs[0]?.dedupeKey, first?.jobs[0]?.dedupeKey);
});

test("WHOOP provider turns missing resource imports into the existing delete snapshot shape", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/developer/v2/activity/workout/workout-404") {
        return new Response(null, { status: 404 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["read:workout"]),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return {
        ok: true,
      };
    },
    async refreshAccountTokens() {
      throw new Error("refreshAccountTokens should not be called");
    },
  };

  await provider.executeJob(
    context,
    createJob("resource", {
      resourceType: "workout",
      resourceId: "workout-404",
      eventType: "workout.updated",
      occurredAt: "2026-03-15T09:00:00.000Z",
    }),
  );

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "whoop-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      deletions: [
        {
          resource_type: "workout",
          resource_id: "workout-404",
          occurred_at: "2026-03-15T09:00:00.000Z",
          source_event_type: "workout.updated",
        },
      ],
    },
  ]);
});

test("WHOOP webhook replay checks use the request context timestamp instead of process wall clock", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const rawBody = Buffer.from(
    JSON.stringify({
      user_id: "whoop-user-1",
      type: "sleep.updated",
      id: "resource-1",
      trace_id: "trace-context-now",
    }),
    "utf8",
  );
  const timestamp = String(Date.parse("2026-03-16T10:00:00.000Z"));
  const originalDateNow = Date.now;

  Date.now = () => Date.parse("2027-03-16T10:00:00.000Z");

  try {
    const parsed = await provider.verifyAndParseWebhook?.({
      headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, timestamp),
      rawBody,
      now: "2026-03-16T10:00:00.000Z",
    });

    assert.equal(parsed?.externalAccountId, "whoop-user-1");
    assert.equal(parsed?.traceId, "trace-context-now");
  } finally {
    Date.now = originalDateNow;
  }
});
