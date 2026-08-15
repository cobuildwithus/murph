import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";
import { prepareDeviceProviderSnapshotImport } from "@murphai/importers";

import { DeviceSyncError } from "../src/errors.ts";
import { createOuraDeviceSyncProvider, resolveOuraWebhookPreflightResponse } from "../src/providers/oura.ts";
import { OURA_DEFAULT_WEBHOOK_TARGETS } from "../src/providers/oura-webhooks.ts";
import { subtractDays } from "../src/shared.ts";
import { createJsonResponse, requireValue } from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceWebhookHandler,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
  ProviderAuthTokens,
  ProviderConnectionResult,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

type DeviceSyncAccountOverrides = Partial<Omit<DeviceSyncAccount, "credential">> & {
  accessToken?: string;
  refreshToken?: string | null;
  credential?: DeviceSyncAccount["credential"];
};

type StoredDeviceSyncAccountOverrides = Partial<Omit<StoredDeviceSyncAccount, "credential">> & {
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string | null;
  credential?: StoredDeviceSyncAccount["credential"];
};

function createAccount(scopes: string[], overrides: DeviceSyncAccountOverrides = {}): DeviceSyncAccount {
  const {
    accessToken = "access-token",
    refreshToken = "refresh-token",
    credential,
    ...accountOverrides
  } = overrides;
  const accessTokenExpiresAt = accountOverrides.accessTokenExpiresAt ?? null;

  return {
    id: "acct-oura-1",
    provider: "oura",
    externalAccountId: "oura-user-1",
    disconnectGeneration: 0,
    displayName: "Oura",
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
    credential: credential ?? {
      kind: "oauth_tokens",
      tokens: {
        accessToken,
        refreshToken,
        accessTokenExpiresAt,
      },
    },
    ...accountOverrides,
  };
}

function createStoredAccount(scopes: string[], overrides: StoredDeviceSyncAccountOverrides = {}): StoredDeviceSyncAccount {
  const {
    accessTokenEncrypted = "encrypted-access-token",
    refreshTokenEncrypted = "encrypted-refresh-token",
    credential,
    ...accountOverrides
  } = overrides;
  const { credential: _decryptedCredential, ...publicAccount } = createAccount(scopes);

  return {
    ...publicAccount,
    ...accountOverrides,
    credential: credential ?? {
      kind: "oauth_tokens",
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessTokenExpiresAt: accountOverrides.accessTokenExpiresAt ?? null,
      credentialMetadata: {},
    },
    hostedObservedConnectionRevision: accountOverrides.hostedObservedConnectionRevision ?? 0,
    hostedObservedTokenRevision: accountOverrides.hostedObservedTokenRevision ?? 0,
    hostedObservedTokenVersion: accountOverrides.hostedObservedTokenVersion ?? null,
    hostedObservedUpdatedAt: accountOverrides.hostedObservedUpdatedAt ?? null,
    localConnectionRevision: accountOverrides.localConnectionRevision ?? 0,
    localTokenRevision: accountOverrides.localTokenRevision ?? 0,
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

function requireOAuthTokens(connection: ProviderConnectionResult): ProviderAuthTokens {
  const tokens = connection.credential?.kind === "oauth_tokens"
    ? connection.credential.tokens
    : connection.tokens;
  assert.ok(tokens);
  return tokens;
}

function requireVerifyAndParseWebhook(
  provider: DeviceSyncProvider,
): NonNullable<DeviceWebhookHandler["verifyAndParseWebhook"]> {
  return requireValue(provider.webhookHandler?.verifyAndParseWebhook);
}

test("Oura provider exchanges an auth code into a refreshable connection", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "<REDACTED_OURA_CLIENT_SECRET>",
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

  const connection = await provider.oauthAdapter.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      state: "state-1",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: [],
    },
    "auth-code-1",
  );

  assert.equal(connection.externalAccountId, "oura-user-1");
  assert.equal(connection.displayName, "Oura");
  assert.equal(requireOAuthTokens(connection).refreshToken, "refresh-token");
  assert.deepEqual(connection.scopes, ["personal", "daily", "heartrate"]);
  assert.equal(connection.initialJobs?.[0]?.kind, "backfill");
  assert.deepEqual(connection.initialJobs?.[0]?.payload, {
    windowStart: "2025-09-17T10:00:00.000Z",
    windowEnd: "2026-03-16T10:00:00.000Z",
    includePersonalInfo: true,
  });
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

  const connection = await provider.oauthAdapter.exchangeAuthorizationCode(
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
    provider.oauthAdapter.refreshTokens(createAccount(["personal"])),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_REFRESH_TOKEN_ROTATION_MISSING" &&
      error.accountStatus === null,
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
    provider.oauthAdapter.refreshTokens(createAccount(["personal"], {
      refreshToken: null,
    })),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_REFRESH_TOKEN_MISSING" &&
      error.accountStatus === "reauthorization_required",
  );
  assert.equal(fetchCalled, false);
});

test("Oura provider includes safe OAuth diagnostics for token request failures", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          error: "invalid_grant",
          error_description: "Refresh token expired. Reconnect Oura.",
        }, 400);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () => provider.oauthAdapter.refreshTokens(createAccount(["personal"], {
      refreshToken: "stored-refresh-token",
    })),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "OURA_TOKEN_REQUEST_FAILED");
      assert.equal(error.accountStatus, "reauthorization_required");
      assert.deepEqual(error.details, {
        accountStatus: "reauthorization_required",
        oauthErrorCode: "invalid_grant",
        oauthErrorDescription: "Refresh token expired. Reconnect Oura.",
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
        oauthRequestOfflineScopePresent: false,
        oauthRequestParameterCount: 4,
        oauthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token",
        oauthRequestRefreshCredentialPresent: true,
        oauthRequestScopeCount: 0,
        oauthRequestScopePresent: false,
        oauthRequestScopeValue: null,
        oauthRequestTokenEndpointKind: "oura_oauth_token",
        oauthResponseErrorDescriptionFieldPresent: true,
        oauthResponseErrorFieldPresent: true,
        oauthResponseShapeKind: "json_object",
        requestAuthKind: "oauth_client_secret_body",
        requestAuthPlacement: "body_parameters",
        requestBodyFieldCount: 4,
        requestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token",
        requestBodyKind: "form_urlencoded",
        requestContentType: "application_x_www_form_urlencoded",
        requestCredentialPresent: true,
        requestEndpointKind: "oura_oauth_token",
        requestMethod: "POST",
        requestQueryParameterCount: 0,
        requestQueryParameterNames: null,
        responseErrorCode: "invalid_grant",
        responseErrorDescription: "Refresh token expired. Reconnect Oura.",
        responseErrorDescriptionFieldPresent: true,
        responseErrorFieldPresent: true,
        responseShapeKind: "json_object",
        retryable: false,
        status: 400,
      });
      const serialized = JSON.stringify(error.details);
      assert.equal(serialized.includes("stored-refresh-token"), false);
      assert.equal(serialized.includes("oura-client-secret"), false);
      return true;
    },
  );
});

test("Oura provider revokes access tokens through the OAuth revoke endpoint", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(`${init?.method ?? "GET"} ${url}`);

      if (url === "https://api.ouraring.com/oauth/revoke?access_token=access-token") {
        return new Response(null, { status: 204 });
      }

      if (url === "https://api.ouraring.com/oauth/revoke?access_token=stale-token") {
        return new Response(null, { status: 401 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const revokeAccess = requireValue(provider.connectionHandler.revokeAccess);

  await revokeAccess(createAccount(["personal"]));
  await revokeAccess(createAccount(["personal"], {
    accessToken: "stale-token",
  }));

  assert.deepEqual(requests, [
    "GET https://api.ouraring.com/oauth/revoke?access_token=access-token",
    "GET https://api.ouraring.com/oauth/revoke?access_token=stale-token",
  ]);
});

test("Oura provider rejects auth exchanges without a refresh token and personal-info ids", async () => {
  const missingRefreshRequests: string[] = [];
  const missingRefreshProvider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      missingRefreshRequests.push(`${init?.method ?? "GET"} ${url}`);

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          expires_in: 3600,
          scope: "extapi:personal",
        });
      }

      if (url === "https://api.ouraring.com/oauth/revoke?access_token=access-token") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      missingRefreshProvider.oauthAdapter.exchangeAuthorizationCode(
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
  assert.deepEqual(missingRefreshRequests, [
    "POST https://api.ouraring.com/oauth/token",
    "GET https://api.ouraring.com/oauth/revoke?access_token=access-token",
  ]);

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

      if (url === "https://api.ouraring.com/oauth/revoke?access_token=access-token") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      missingProfileIdProvider.oauthAdapter.exchangeAuthorizationCode(
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

  await provider.jobExecutor.executeJob(
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
  });
  assert.ok(requests.some((url) => url.includes("/v2/usercollection/daily_activity?")));
  assert.equal(requests.some((url) => url.includes("/v2/usercollection/heartrate?")), false);
  assert.equal(provider.descriptor.webhook?.path, "/webhooks/oura");
});

test("Oura provider rejects repeated pagination tokens before accumulating unbounded records", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/daily_activity?")) {
        return createJsonResponse({
          data: [{ day: "2026-03-15", score: 80 }],
          next_token: "same-token",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["daily"]),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot() {
      throw new Error("import should not be called when pagination loops");
    },
    async refreshAccountTokens() {
      throw new Error("refresh should not be called in this test");
    },
  };

  await assert.rejects(
    () =>
      provider.jobExecutor.executeJob(
        context,
        createJob("backfill", {
          windowStart: "2026-03-15T00:00:00.000Z",
          windowEnd: "2026-03-16T00:00:00.000Z",
          includePersonalInfo: false,
        }),
      ),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_PAGINATION_LOOP",
  );

  assert.equal(
    requests.filter((url) => url.startsWith("https://api.ouraring.com/v2/usercollection/daily_activity?")).length,
    2,
  );
});

test("Oura provider rejects excessive unique pagination tokens", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);

      if (url.startsWith("https://api.ouraring.com/v2/usercollection/daily_activity?")) {
        return createJsonResponse({
          data: [],
          next_token: `token-${requests.length}`,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["daily"]),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot() {
      throw new Error("import should not be called when pagination exceeds the page limit");
    },
    async refreshAccountTokens() {
      throw new Error("refresh should not be called in this test");
    },
  };

  await assert.rejects(
    () =>
      provider.jobExecutor.executeJob(
        context,
        createJob("backfill", {
          windowStart: "2026-03-15T00:00:00.000Z",
          windowEnd: "2026-03-16T00:00:00.000Z",
          includePersonalInfo: false,
        }),
      ),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "OURA_PAGINATION_LIMIT_EXCEEDED",
  );

  assert.equal(
    requests.filter((url) => url.startsWith("https://api.ouraring.com/v2/usercollection/daily_activity?")).length,
    500,
  );
});

test("Oura provider ignores old heartrate-only grants during backfill", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["heartrate"]),
    now: "2026-01-04T12:00:00.000Z",
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

  await provider.jobExecutor.executeJob(
    context,
    createJob("backfill", {
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-04T12:00:00.000Z",
      includePersonalInfo: false,
    }),
  );

  assert.deepEqual(requests, []);
  assert.deepEqual(importedSnapshots, []);
});

test("Oura heartrate resource jobs are ignored for current partial days", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await provider.jobExecutor.executeJob(
    {
      account: createAccount(["heartrate"]),
      now: "2026-03-16T10:00:00.000Z",
      logger: {},
      async importSnapshot(snapshot) {
        importedSnapshots.push(snapshot);
        return { ok: true };
      },
      async refreshAccountTokens() {
        throw new Error("refresh should not be called in this test");
      },
    },
    createJob("resource", {
      dataType: "heartrate",
      objectId: "2026-03-16T09:30:00.000Z",
      occurredAt: "2026-03-16T09:30:00.000Z",
      sourceEventType: "heartrate.updated",
    }),
  );

  assert.deepEqual(requests, []);
  assert.deepEqual(importedSnapshots, []);
});

test("Oura heartrate resource jobs are ignored for historical days", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await provider.jobExecutor.executeJob(
    {
      account: createAccount(["heartrate"]),
      now: "2026-03-16T10:00:00.000Z",
      logger: {},
      async importSnapshot(snapshot) {
        importedSnapshots.push(snapshot);
        return { ok: true };
      },
      async refreshAccountTokens() {
        throw new Error("refresh should not be called in this test");
      },
    },
    createJob("resource", {
      dataType: "heartrate",
      objectId: "2026-03-15T09:30:00.000Z",
      occurredAt: "2026-03-15T09:30:00.000Z",
      sourceEventType: "heartrate.updated",
    }),
  );

  assert.deepEqual(requests, []);
  assert.deepEqual(importedSnapshots, []);
});

test("Oura heartrate delete jobs are ignored", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
  });

  await provider.jobExecutor.executeJob(
    {
      account: createAccount(["heartrate"]),
      now: "2026-03-16T10:00:00.000Z",
      logger: {},
      async importSnapshot(snapshot) {
        importedSnapshots.push(snapshot);
        return { ok: true };
      },
      async refreshAccountTokens() {
        throw new Error("refresh should not be called in this test");
      },
    },
    createJob("delete", {
      dataType: "heartrate",
      objectId: "2026-03-16T09:30:00.000Z",
      occurredAt: "2026-03-16T09:30:00.000Z",
      sourceEventType: "heartrate.deleted",
    }),
  );

  assert.deepEqual(importedSnapshots, []);
});

test("Oura old heartrate-only backfills ignore invalid dense windows without fetching", async () => {
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

  await provider.jobExecutor.executeJob(
    context,
    createJob("backfill", {
      windowStart: "not-a-date",
      windowEnd: "2026-03-16T00:00:00.000Z",
      includePersonalInfo: false,
    }),
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

      if (url === "https://api.ouraring.com/oauth/revoke?access_token=access-token") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const grantedScopeConnection = await provider.oauthAdapter.exchangeAuthorizationCode(
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
      provider.oauthAdapter.exchangeAuthorizationCode(
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

test("Oura provider best-effort revokes exchanged access tokens when post-token-exchange validation fails", async () => {
  const requests: string[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(`${init?.method ?? "GET"} ${url}`);

      if (url === "https://api.ouraring.com/oauth/token") {
        return createJsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }

      if (url === "https://api.ouraring.com/oauth/revoke?access_token=access-token") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
          state: "state-revoke-on-failure",
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

  assert.deepEqual(requests, [
    "POST https://api.ouraring.com/oauth/token",
    "GET https://api.ouraring.com/oauth/revoke?access_token=access-token",
  ]);
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
    acceptanceMode: "level_dirty_hint",
    externalAccountId: "oura-user-1",
    eventType: "sync_completed",
    traceId: parsed?.traceId,
    providerSentAt: timestamp,
    resourceCategory: "workout",
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
    acceptanceMode: "durable_webhook_work",
    externalAccountId: "oura-user-1",
    eventType: "daily_sleep.updated",
    traceId: parsed?.traceId,
    occurredAt: "2026-03-16T09:58:00.000Z",
    providerSentAt: "2026-03-16T09:58:10.000Z",
    resourceCategory: "daily_sleep",
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

test("Oura old heartrate webhooks are accepted and no-op at execution", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "heartrate.updated",
      data_type: "heartrate",
      object_id: "heartrate-1",
      user_id: "oura-user-1",
      timestamp: "2026-03-16T09:58:00.000Z",
    }),
    "utf8",
  );

  const parsed = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", "2026-03-16T09:58:10.000Z", rawBody),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });
  const job = parsed?.jobs[0];
  assert.ok(job);
  assert.equal(job.kind, "resource");
  assert.deepEqual(job.payload, {
    dataType: "heartrate",
    objectId: "heartrate-1",
    occurredAt: "2026-03-16T09:58:00.000Z",
    windowStart: "2026-02-23T10:00:00.000Z",
    windowEnd: "2026-03-16T10:00:00.000Z",
    includePersonalInfo: false,
  });

  await provider.jobExecutor?.executeJob(
    {
      account: createAccount(["heartrate"]),
      async importSnapshot(snapshot) {
        importedSnapshots.push(snapshot);
        return { ok: true };
      },
      logger: {},
      now: "2026-03-16T10:00:00.000Z",
      async refreshAccountTokens() {
        throw new Error("refresh should not be called in this test");
      },
    },
    createJob("resource", job.payload),
  );

  assert.deepEqual(requests, []);
  assert.deepEqual(importedSnapshots, []);
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
  assert.equal(parsed?.resourceCategory, "daily_sleep");
});

test("Oura provider keeps the request-time import fallback without claiming a missing event time", async () => {
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
    acceptanceMode: "durable_webhook_work",
    externalAccountId: "oura-user-1",
    eventType: "workout.updated",
    traceId: parsed?.traceId,
    providerSentAt: timestamp,
    resourceCategory: "workout",
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

test("Oura webhook preflight helper returns the challenge only for the configured token", () => {
  const challenge = resolveOuraWebhookPreflightResponse({
    method: "GET",
    url: new URL(
      "https://sync.example.test/api/device-sync/webhooks/oura?verification_token=verify-token&challenge=random-challenge",
    ),
    verificationToken: "verify-token",
  });

  assert.deepEqual(challenge, {
    status: 200,
    body: {
      challenge: "random-challenge",
    },
  });
  assert.throws(
    () =>
      resolveOuraWebhookPreflightResponse({
        method: "GET",
        url: new URL(
          "https://sync.example.test/api/device-sync/webhooks/oura?verification_token=wrong&challenge=random-challenge",
        ),
        verificationToken: "verify-token",
      }),
    /verification token/u,
  );
});

test("Oura provider webhook admin no-ops without a verification token and reuses the shared subscription client when one is configured", async () => {
  const defaultWebhookDataTypes = [...new Set(OURA_DEFAULT_WEBHOOK_TARGETS.map((target) => target.dataType))].sort();
  assert.deepEqual(defaultWebhookDataTypes, [
    "daily_activity",
    "daily_readiness",
    "daily_sleep",
    "daily_spo2",
    "session",
    "sleep",
    "workout",
  ]);
  assert.equal(defaultWebhookDataTypes.includes("heartrate"), false);

  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
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
  };
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl,
  });
  const webhookAdmin = requireValue(provider.webhookAdmin);
  const ensureSubscriptions = requireValue(webhookAdmin.ensureSubscriptions);

  await ensureSubscriptions({
    publicBaseUrl: "https://sync.example.test/device-sync",
  });
  assert.deepEqual(requests, []);

  const configuredEnsureSubscriptions = requireValue(createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl,
    webhookVerificationToken: "verify-token-for-tests",
  }).webhookAdmin?.ensureSubscriptions);

  await configuredEnsureSubscriptions({
    publicBaseUrl: "https://sync.example.test/device-sync",
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
    acceptanceMode: "durable_webhook_work",
    externalAccountId: "oura-user-1",
    eventType: "session.deleted",
    traceId: parsed?.traceId,
    occurredAt: "2026-03-16T09:58:00.000Z",
    providerSentAt: "2026-03-16T10:00:00.000Z",
    resourceCategory: "session",
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

  await provider.jobExecutor.executeJob(context, createJob("delete", parsed?.jobs[0]?.payload ?? {}));

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

  await provider.jobExecutor.executeJob(context, createJob("delete", {
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

test("Oura provider fallback trace ids ignore transport timestamps when the webhook body includes event_time", async () => {
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

test("Oura provider prefers payload trace_id over fallback trace derivation", async () => {
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
      trace_id: "provided-trace-id",
    }),
    "utf8",
  );
  const parsed = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", "2026-03-16T10:00:00.000Z", rawBody),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });

  assert.equal(parsed?.traceId, "provided-trace-id");
  assert.equal(parsed?.jobs[0]?.dedupeKey, "oura-webhook:provided-trace-id");
});

test("Oura provider prefers payload event_id when trace_id is absent", async () => {
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
      event_id: "provided-event-id",
    }),
    "utf8",
  );
  const parsed = await verifyAndParseWebhook({
    headers: createOuraWebhookHeaders("oura-client-secret", "2026-03-16T10:00:00.000Z", rawBody),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });

  assert.equal(parsed?.traceId, "provided-event-id");
  assert.equal(parsed?.jobs[0]?.dedupeKey, "oura-webhook:provided-event-id");
});

test("Oura provider fallback trace ids use the webhook transport timestamp when the body omits ids and event time", async () => {
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

  assert.notEqual(first?.traceId, second?.traceId);
  assert.notEqual(first?.jobs[0]?.dedupeKey, second?.jobs[0]?.dedupeKey);
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

  await provider.jobExecutor.executeJob(
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

  await provider.jobExecutor.executeJob(
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

  const scheduled = reconcileProvider.jobExecutor.createScheduledJobs?.(
    createStoredAccount(["personal"], {
      nextReconcileAt: "2026-03-16T09:00:00.000Z",
    }),
    "2026-03-16T10:00:00.000Z",
  );
  assert.equal(scheduled?.jobs[0]?.kind, "reconcile");
  assert.deepEqual(scheduled?.jobs[0]?.payload, {
    windowStart: subtractDays("2026-03-16T10:00:00.000Z", 21),
    windowEnd: "2026-03-16T10:00:00.000Z",
    includePersonalInfo: false,
  });

  const importedSnapshots: unknown[] = [];
  await reconcileProvider.jobExecutor.executeJob(
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
      provider.jobExecutor.executeJob(
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
    webhookVerificationToken: "verify-token",
  });
  const webhookAdmin = requireValue(provider.webhookAdmin);
  const handleWebhookPreflight = requireValue(webhookAdmin.handleWebhookPreflight);
  const fallbackSnapshots: unknown[] = [];
  const defaultScopes = provider.descriptor.oauth?.defaultScopes ?? [];

  assert.deepEqual(defaultScopes, ["personal", "daily", "workout", "session", "spo2"]);
  assert.equal(defaultScopes.includes("heartrate"), false);
  assert.equal(
    provider.oauthAdapter.buildConnectUrl({
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      scopes: defaultScopes,
      state: "state-default-connect",
      now: "2026-03-16T10:00:00.000Z",
    }).includes("heartrate"),
    false,
  );

  const staleScopeProvider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    scopes: ["personal", "daily", "heartrate", "extapi:heartrate", "workout"],
  });
  const staleConfiguredScopes = staleScopeProvider.descriptor.oauth?.defaultScopes ?? [];
  assert.deepEqual(staleConfiguredScopes, ["personal", "daily", "workout", "session", "spo2"]);
  assert.equal(
    staleScopeProvider.oauthAdapter.buildConnectUrl({
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      scopes: staleConfiguredScopes,
      state: "state-stale-scope-connect",
      now: "2026-03-16T10:00:00.000Z",
    }).includes("heartrate"),
    false,
  );

  assert.equal(
    provider.oauthAdapter.buildConnectUrl({
      callbackUrl: "https://sync.example.test/device-sync/oauth/oura/callback",
      scopes: ["personal", "workout"],
      state: "state-connect",
      now: "2026-03-16T10:00:00.000Z",
    }),
    "https://cloud.ouraring.com/oauth/authorize?client_id=oura-client-id&response_type=code&redirect_uri=https%3A%2F%2Fsync.example.test%2Fdevice-sync%2Foauth%2Foura%2Fcallback&scope=personal+workout&state=state-connect",
  );
  assert.deepEqual(
    handleWebhookPreflight({
      method: "GET",
      url: new URL("https://sync.example.test/device-sync/webhooks/oura?verification_token=verify-token&challenge=challenge-123"),
      headers: new Headers(),
      rawBody: Buffer.alloc(0),
      now: "2026-03-16T10:00:00.000Z",
    }),
    {
      status: 200,
      body: {
        challenge: "challenge-123",
      },
    },
  );

  await provider.jobExecutor.executeJob(
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
      provider.jobExecutor.executeJob(
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
