import assert from "node:assert/strict";
import { test } from "vitest";

import { createGarminDeviceSyncProvider } from "../src/providers/garmin.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

import type { DeviceSyncAccount, DeviceSyncJobRecord, ProviderJobContext, StoredDeviceSyncAccount } from "../src/types.ts";

function readRequestBody(init?: RequestInit): string | null {
  if (typeof init?.body === "string") {
    return init.body;
  }

  return init?.body instanceof URLSearchParams ? init.body.toString() : null;
}

function createAccount(scopes: string[], overrides: Partial<DeviceSyncAccount> = {}): DeviceSyncAccount {
  return {
    id: "acct-garmin-1",
    provider: "garmin",
    externalAccountId: "garmin-user-1",
    displayName: "Garmin garmin-user-1",
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
    provider: "garmin",
    accountId: "acct-garmin-1",
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

test("Garmin provider builds a PKCE connect URL and exchanges an auth code into a refreshable polling connection", async () => {
  const requests: Array<{ body: string | null; url: string }> = [];
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);
      requests.push({
        body: readRequestBody(init),
        url,
      });

      if (url === "https://connectapi.garmin.com/di-oauth2-service/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "HEALTH_EXPORT ACTIVITY_EXPORT",
        });
      }

      if (url === "https://apis.garmin.com/wellness-api/rest/user/id") {
        return createJsonResponse({
          userId: "garmin-user-1",
        });
      }

      if (url === "https://apis.garmin.com/wellness-api/rest/user/permissions") {
        return createJsonResponse(["HEALTH_EXPORT", "ACTIVITY_EXPORT"]);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const connectUrl = new URL(provider.buildConnectUrl({
    state: "state-1",
    callbackUrl: "https://sync.example.test/device-sync/oauth/garmin/callback",
    scopes: [],
    now: "2026-03-16T10:00:00.000Z",
  }));

  assert.equal(connectUrl.origin, "https://connect.garmin.com");
  assert.equal(connectUrl.pathname, "/oauth2Confirm");
  assert.equal(connectUrl.searchParams.get("client_id"), "garmin-client-id");
  assert.equal(connectUrl.searchParams.get("state"), "state-1");
  assert.equal(connectUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(connectUrl.searchParams.get("code_challenge"));

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/garmin/callback",
      grantedScopes: [],
      now: "2026-03-16T10:00:00.000Z",
      state: "state-1",
    },
    "auth-code-1",
  );

  assert.equal(connection.externalAccountId, "garmin-user-1");
  assert.equal(connection.displayName, "Garmin garmin-user-1");
  assert.equal(connection.tokens.refreshToken, "refresh-token");
  assert.deepEqual(connection.scopes, ["HEALTH_EXPORT", "ACTIVITY_EXPORT"]);
  assert.equal(connection.metadata?.syncMode, "polling");
  assert.equal(connection.initialJobs?.[0]?.kind, "backfill");
  assert.deepEqual(connection.initialJobs?.[0]?.payload, {
    includeProfile: true,
    windowEnd: "2026-03-16T10:00:00.000Z",
    windowStart: "2026-02-14T10:00:00.000Z",
  });

  const tokenRequest = requests[0];
  assert.equal(tokenRequest?.url, "https://connectapi.garmin.com/di-oauth2-service/oauth/token");
  assert.equal(new URLSearchParams(tokenRequest?.body ?? "").get("code_verifier")?.length, 43);
});

test("Garmin provider keeps the stored refresh token when refresh omits a replacement", async () => {
  let requestBody: string | null = null;
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);

      if (url === "https://connectapi.garmin.com/di-oauth2-service/oauth/token") {
        requestBody = readRequestBody(init);
        return createJsonResponse({
          access_token: "refreshed-access-token",
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const tokens = await provider.refreshTokens(createAccount(["HEALTH_EXPORT"]));

  assert.equal(tokens.accessToken, "refreshed-access-token");
  assert.equal(tokens.refreshToken, "refresh-token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("grant_type"), "refresh_token");
});

test("Garmin provider honors token base URL overrides for non-production OAuth exchanges", async () => {
  const requests: string[] = [];
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    tokenBaseUrl: "https://garmin-token.test",
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://garmin-token.test/di-oauth2-service/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await provider.refreshTokens(createAccount(["HEALTH_EXPORT"]));

  assert.deepEqual(requests, ["https://garmin-token.test/di-oauth2-service/oauth/token"]);
});

test("Garmin provider schedules reconcile polling and imports requested collections", async () => {
  const fetchedUrls: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);
      fetchedUrls.push(url);

      if (url.includes("/wellness-api/rest/sleeps?")) {
        return createJsonResponse([{ summaryId: "sleep-1" }]);
      }

      if (url.includes("/wellness-api/rest/activities?")) {
        return createJsonResponse([{ activityId: "activity-1" }]);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const scheduled = provider.createScheduledJobs(
    createStoredAccount(["HEALTH_EXPORT"], {
      nextReconcileAt: "2026-03-16T11:00:00.000Z",
    }),
    "2026-03-16T12:00:00.000Z",
  );

  assert.equal(scheduled.jobs[0]?.kind, "reconcile");

  const context: ProviderJobContext = {
    account: createAccount(["HEALTH_EXPORT"]),
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return {};
    },
    logger: {},
    now: "2026-03-16T12:00:00.000Z",
    async refreshAccountTokens() {
      return createAccount(["HEALTH_EXPORT"], {
        accessToken: "refreshed-access-token",
      });
    },
  };

  await provider.executeJob(context, createJob("reconcile", {
    dataTypes: ["sleeps", "activities"],
    includeProfile: true,
    windowEnd: "2026-03-16T12:00:00.000Z",
    windowStart: "2026-03-15T12:00:00.000Z",
  }));

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(importedSnapshots[0], {
    accountId: "garmin-user-1",
    activities: [{ activityId: "activity-1" }],
    importedAt: "2026-03-16T12:00:00.000Z",
    profile: {
      id: "garmin-user-1",
      permissions: ["HEALTH_EXPORT"],
    },
    sleeps: [{ summaryId: "sleep-1" }],
  });
  assert.equal(fetchedUrls.length, 2);
  assert.match(fetchedUrls[0] ?? "", /uploadStartTimeInSeconds=/u);
  assert.match(fetchedUrls[0] ?? "", /uploadEndTimeInSeconds=/u);
});

test("Garmin provider falls back to token scopes when permissions cannot be fetched", async () => {
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://connectapi.garmin.com/di-oauth2-service/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "HEALTH_EXPORT SLEEP_EXPORT",
        });
      }

      if (url === "https://apis.garmin.com/wellness-api/rest/user/id") {
        return createJsonResponse({
          account_id: "garmin-user-fallback",
        });
      }

      if (url === "https://apis.garmin.com/wellness-api/rest/user/permissions") {
        return createJsonResponse({ error: "forbidden" }, 403);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const connection = await provider.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/garmin/callback",
      grantedScopes: [],
      now: "2026-03-16T10:00:00.000Z",
      state: "state-2",
    },
    "auth-code-2",
  );

  assert.equal(connection.externalAccountId, "garmin-user-fallback");
  assert.deepEqual(connection.scopes, ["HEALTH_EXPORT", "SLEEP_EXPORT"]);
});

test("Garmin provider rejects authorization responses without a refresh token", async () => {
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://connectapi.garmin.com/di-oauth2-service/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      provider.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/garmin/callback",
          grantedScopes: [],
          now: "2026-03-16T10:00:00.000Z",
          state: "state-3",
        },
        "auth-code-3",
      ),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "GARMIN_REFRESH_TOKEN_MISSING",
  );
});

test("Garmin provider requires an existing refresh token before token refresh", async () => {
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async () => {
      throw new Error("refresh request should not run without a refresh token");
    },
  });

  await assert.rejects(
    () =>
      provider.refreshTokens(
        createAccount(["HEALTH_EXPORT"], {
          refreshToken: null,
        }),
      ),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "GARMIN_REFRESH_TOKEN_MISSING",
  );
});

test("Garmin provider backfill normalizes aliases, swaps inverted windows, and skips empty imports", async () => {
  const fetchedUrls: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);
      fetchedUrls.push(url);

      if (url.includes("/wellness-api/rest/dailies?")) {
        return createJsonResponse({
          records: [{ summaryId: "daily-1" }],
        });
      }

      if (url.includes("/wellness-api/rest/activityDetails?")) {
        return createJsonResponse({
          items: [{ fileId: "activity-file-1" }],
        });
      }

      if (url.includes("/wellness-api/rest/sleeps?")) {
        return new Response("", {
          status: 404,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const context: ProviderJobContext = {
    account: createAccount(["HEALTH_EXPORT"]),
    async importSnapshot(snapshot) {
      importedSnapshots.push(snapshot);
      return {};
    },
    logger: {},
    now: "2026-03-16T12:00:00.000Z",
    async refreshAccountTokens() {
      return createAccount(["HEALTH_EXPORT"]);
    },
  };

  await provider.executeJob(
    context,
    createJob("backfill", {
      dataType: "day summaries",
      dataTypes: ["activityDetails", "sleep", "activity-files"],
      includeProfile: false,
      windowEnd: "2026-03-14T00:00:00.000Z",
      windowStart: "2026-03-16T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(importedSnapshots[0], {
    accountId: "garmin-user-1",
    activityFiles: [{ fileId: "activity-file-1" }],
    dailySummaries: [{ summaryId: "daily-1" }],
    importedAt: "2026-03-16T12:00:00.000Z",
    sleeps: [],
  });
  assert.equal(fetchedUrls.length, 3);
  const firstRequestSearch = new URL(fetchedUrls[0] ?? "").searchParams;
  assert.equal(firstRequestSearch.get("uploadStartTimeInSeconds"), "1773446400");
  assert.equal(firstRequestSearch.get("uploadEndTimeInSeconds"), "1773619200");

  const emptyImportProvider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url.includes("/wellness-api/rest/")) {
        return new Response("", {
          status: 404,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  let emptyImportCount = 0;
  await emptyImportProvider.executeJob(
    {
      ...context,
      async importSnapshot() {
        emptyImportCount += 1;
        return {};
      },
    },
    createJob("reconcile", {
      dataType: "unsupported-type",
      includeProfile: false,
    }),
  );

  assert.equal(emptyImportCount, 0);
});

test("Garmin provider rethrows collection request failures that are not tolerated", async () => {
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url.includes("/wellness-api/rest/sleeps?")) {
        return createJsonResponse({ error: "rate limited" }, 429);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      provider.executeJob(
        {
          account: createAccount(["HEALTH_EXPORT"]),
          async importSnapshot() {
            return {};
          },
          logger: {},
          now: "2026-03-16T12:00:00.000Z",
          async refreshAccountTokens() {
            return createAccount(["HEALTH_EXPORT"]);
          },
        },
        createJob("reconcile", {
          dataTypes: ["sleeps"],
        }),
      ),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "GARMIN_API_REQUEST_FAILED",
  );
});

test("Garmin provider revokes access tolerantly and surfaces revoke failures", async () => {
  const requests: Array<{ method: string | undefined; url: string }> = [];
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);
      requests.push({
        method: init?.method,
        url,
      });

      if (requests.length === 1) {
        return new Response(null, { status: 204 });
      }

      if (requests.length === 2) {
        return createJsonResponse({ error: "rate limited" }, 429);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await provider.revokeAccess?.(createAccount(["HEALTH_EXPORT"]));

  await assert.rejects(
    () => provider.revokeAccess?.(createAccount(["HEALTH_EXPORT"])),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "GARMIN_REVOKE_FAILED",
  );

  assert.deepEqual(requests, [
    {
      method: "DELETE",
      url: "https://apis.garmin.com/wellness-api/rest/user/registration",
    },
    {
      method: "DELETE",
      url: "https://apis.garmin.com/wellness-api/rest/user/registration",
    },
  ]);
});

test("Garmin provider rejects unsupported job kinds", async () => {
  const provider = createGarminDeviceSyncProvider({
    clientId: "garmin-client-id",
    clientSecret: "garmin-client-secret",
  });

  await assert.rejects(
    () =>
      provider.executeJob(
        {
          account: createAccount(["HEALTH_EXPORT"]),
          async importSnapshot() {
            return {};
          },
          logger: {},
          now: "2026-03-16T12:00:00.000Z",
          async refreshAccountTokens() {
            return createAccount(["HEALTH_EXPORT"]);
          },
        },
        createJob("webhook", {}),
      ),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "GARMIN_JOB_KIND_UNSUPPORTED",
  );
});
