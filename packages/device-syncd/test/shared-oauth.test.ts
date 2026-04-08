import assert from "node:assert/strict";

import { test, vi } from "vitest";

import {
  buildOAuthConnectUrl,
  buildProviderApiError,
  buildScheduledReconcileJobs,
  exchangeOAuthAuthorizationCode,
  createRefreshingApiSession,
  extractRetryMetadata,
  fetchBearerJson,
  isoFromExpiresIn,
  isTokenNearExpiry,
  parseResponseBody,
  postOAuthTokenRequest,
  refreshOAuthTokens,
  requestWithRefreshAndRetry,
  requireRefreshToken,
  splitScopes,
  tokenResponseToAuthTokens,
} from "../src/providers/shared-oauth.ts";

import type { DeviceSyncAccount } from "../src/types.ts";

function createAccount(overrides: Partial<DeviceSyncAccount> = {}): DeviceSyncAccount {
  return {
    id: "acct-shared-oauth-1",
    provider: "demo",
    externalAccountId: "demo-user-1",
    displayName: "Demo User",
    status: "active",
    scopes: ["offline"],
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

test("shared oauth helpers normalize response parsing, retry metadata, scopes, and expiry helpers", async () => {
  assert.equal(await parseResponseBody(new Response("ok")), "ok");
  assert.equal(
    await parseResponseBody({
      async text() {
        throw new Error("boom");
      },
    } as Response),
    "",
  );

  const rateLimited = buildProviderApiError(
    "RATE_LIMITED",
    "Rate limited",
    new Response("{}", { status: 429 }),
    "{}",
  );
  assert.equal(rateLimited.retryable, true);
  assert.equal(rateLimited.httpStatus, 429);

  const unauthorized = buildProviderApiError(
    "UNAUTHORIZED",
    "Unauthorized",
    new Response("{}", { status: 401 }),
    "{}",
    {
      retryable: false,
      accountStatus: "reauthorization_required",
    },
  );
  assert.equal(unauthorized.retryable, false);
  assert.equal(unauthorized.accountStatus, "reauthorization_required");

  assert.deepEqual(extractRetryMetadata({ retryable: true, httpStatus: "503" }), {
    retryable: true,
    httpStatus: 503,
  });
  assert.deepEqual(extractRetryMetadata(new Error("plain-error")), {
    retryable: false,
    httpStatus: undefined,
  });

  assert.equal(isoFromExpiresIn("60", "2026-03-16T10:00:00.000Z"), "2026-03-16T10:01:00.000Z");
  assert.equal(isoFromExpiresIn("not-a-number", "2026-03-16T10:00:00.000Z"), undefined);
  assert.deepEqual(splitScopes(" offline   read:data  "), ["offline", "read:data"]);
  assert.deepEqual(splitScopes(["offline"]), []);
  assert.equal(isTokenNearExpiry(createAccount()), false);
  assert.equal(
    isTokenNearExpiry(
      createAccount({
        accessTokenExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    ),
    true,
  );

  const normalizedTokens = tokenResponseToAuthTokens(
    {
      access_token: 123,
      expires_in: "60",
      refresh_token: 456,
    },
    () => new Error("missing access token"),
  );
  assert.equal(normalizedTokens.accessToken, "123");
  assert.equal(normalizedTokens.refreshToken, "456");
  assert.match(normalizedTokens.accessTokenExpiresAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
  assert.throws(
    () =>
      tokenResponseToAuthTokens(
        {
          access_token: "   ",
        },
        () => new Error("missing access token"),
      ),
    /missing access token/u,
  );
  assert.equal(requireRefreshToken("  refreshed-token  ", () => new Error("missing refresh token")), "refreshed-token");
  assert.throws(() => requireRefreshToken("   ", () => new Error("missing refresh token")), /missing refresh token/u);
});

test("shared oauth token request and bearer fetch helpers cover success, optional 404s, and error bodies", async () => {
  const tokenPayload = await postOAuthTokenRequest<{ access_token: string }>({
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("Content-Type"), "application/x-www-form-urlencoded");
      assert.equal(init?.body instanceof URLSearchParams, true);
      return new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    url: "https://provider.test/oauth/token",
    timeoutMs: 1_000,
    parameters: {
      grant_type: "client_credentials",
    },
    buildError(response) {
      return new Error(`unexpected ${response.status}`);
    },
  });
  assert.deepEqual(tokenPayload, {
    access_token: "access-token",
  });

  await assert.rejects(
    () =>
      postOAuthTokenRequest({
        fetchImpl: async () => new Response("temporarily unavailable", { status: 503 }),
        url: "https://provider.test/oauth/token",
        timeoutMs: 1_000,
        parameters: {
          grant_type: "refresh_token",
        },
        buildError(_response, body) {
          return new Error(`token request failed: ${body}`);
        },
      }),
    /token request failed: temporarily unavailable/u,
  );

  assert.equal(
    await fetchBearerJson({
      fetchImpl: async () => new Response(null, { status: 404 }),
      url: "https://provider.test/resource",
      accessToken: "access-token",
      timeoutMs: 1_000,
      optional: true,
      buildError(response) {
        return new Error(`unexpected ${response.status}`);
      },
    }),
    null,
  );

  await assert.rejects(
    () =>
      fetchBearerJson({
        fetchImpl: async () => new Response("bad gateway", { status: 502 }),
        url: "https://provider.test/resource",
        accessToken: "access-token",
        timeoutMs: 1_000,
        buildError(_response, body) {
          return new Error(`fetch failed: ${body}`);
        },
      }),
    /fetch failed: bad gateway/u,
  );
});

test("shared oauth retry helpers refresh before requests, recover from a first 401, and retry retryable failures", async () => {
  const refreshOrder: string[] = [];
  const refreshedFirst = await requestWithRefreshAndRetry({
    shouldRefresh: () => true,
    async refresh() {
      refreshOrder.push("refresh");
    },
    async request() {
      refreshOrder.push("request");
      return "ok";
    },
  });
  assert.equal(refreshedFirst, "ok");
  assert.deepEqual(refreshOrder, ["refresh", "request"]);

  let unauthorizedRefreshCount = 0;
  let unauthorizedRequestCount = 0;
  const recovered = await requestWithRefreshAndRetry({
    shouldRefresh: () => false,
    async refresh() {
      unauthorizedRefreshCount += 1;
    },
    async request() {
      unauthorizedRequestCount += 1;

      if (unauthorizedRequestCount === 1) {
        throw {
          httpStatus: 401,
          retryable: false,
        };
      }

      return "refreshed";
    },
  });
  assert.equal(recovered, "refreshed");
  assert.equal(unauthorizedRefreshCount, 1);
  assert.equal(unauthorizedRequestCount, 2);

  vi.useFakeTimers();
  try {
    let retryAttempts = 0;
    const retryPromise = requestWithRefreshAndRetry({
      shouldRefresh: () => false,
      async refresh() {
        throw new Error("refresh should not run for retryable errors");
      },
      async request() {
        retryAttempts += 1;

        if (retryAttempts < 3) {
          throw {
            retryable: true,
            httpStatus: 503,
          };
        }

        return "retried";
      },
      maxRetries: 3,
    });

    await vi.runAllTimersAsync();
    assert.equal(await retryPromise, "retried");
    assert.equal(retryAttempts, 3);
  } finally {
    vi.useRealTimers();
  }
});

test("shared oauth helper flows cover auth-code exchange, refresh rotation, bearer fetch success, and scheduling", async () => {
  const exchanged = await exchangeOAuthAuthorizationCode({
    async postTokenRequest(parameters) {
      assert.deepEqual(parameters, {
        grant_type: "authorization_code",
        client_id: "client-id",
        client_secret: "client-secret",
        redirect_uri: "https://sync.example.test/oauth/callback",
        code: "auth-code",
        audience: "device-sync",
      });
      return {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 300,
      };
    },
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackUrl: "https://sync.example.test/oauth/callback",
    code: "auth-code",
    tokenResponseToAuthTokens(payload) {
      return tokenResponseToAuthTokens(payload, () => new Error("missing access token"));
    },
    buildMissingRefreshTokenError: () => new Error("missing refresh token"),
    extraParameters: {
      audience: "device-sync",
    },
  });
  assert.deepEqual(exchanged.tokenPayload, {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 300,
  });
  assert.equal(exchanged.tokens.accessToken, "access-token");
  assert.equal(exchanged.tokens.refreshToken, "refresh-token");

  const refreshed = await refreshOAuthTokens({
    async postTokenRequest(parameters) {
      assert.deepEqual(parameters, {
        grant_type: "refresh_token",
        refresh_token: "refresh-token",
        client_id: "client-id",
        client_secret: "client-secret",
        resource: "wearables",
      });
      return {
        access_token: "refreshed-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 120,
      };
    },
    account: createAccount(),
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenResponseToAuthTokens(payload) {
      return tokenResponseToAuthTokens(payload, () => new Error("missing access token"));
    },
    buildMissingRefreshTokenError: () => new Error("missing refresh token"),
    resolveRefreshToken({ currentRefreshToken, responseRefreshToken }) {
      return responseRefreshToken ?? `${currentRefreshToken}-fallback`;
    },
    extraParameters: {
      resource: "wearables",
    },
  });
  assert.equal(refreshed.accessToken, "refreshed-access-token");
  assert.equal(refreshed.refreshToken, "rotated-refresh-token");

  const fetched = await fetchBearerJson<{ ok: boolean }>({
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access-token");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    },
    url: "https://provider.test/resource",
    accessToken: "access-token",
    timeoutMs: 1_000,
    buildError(response) {
      return new Error(`unexpected ${response.status}`);
    },
  });
  assert.deepEqual(fetched, { ok: true });

  assert.equal(
    buildOAuthConnectUrl({
      baseUrl: "https://provider.test",
      authorizePath: "/oauth/authorize",
      clientId: "client-id",
      callbackUrl: "https://sync.example.test/oauth/callback",
      scopes: ["offline", "read:data"],
      state: "state-1",
    }),
    "https://provider.test/oauth/authorize?client_id=client-id&response_type=code&redirect_uri=https%3A%2F%2Fsync.example.test%2Foauth%2Fcallback&scope=offline+read%3Adata&state=state-1",
  );
  assert.deepEqual(
    buildScheduledReconcileJobs({
      accountId: "acct-shared-oauth-1",
      nextReconcileAt: null,
      now: "2026-03-16T10:00:00.000Z",
      reconcileDays: 7,
      reconcileIntervalMs: 60_000,
      payload: {
        includePersonalInfo: false,
      },
    }),
    {
      jobs: [
        {
          kind: "reconcile",
          dedupeKey: buildScheduledReconcileJobs({
            accountId: "acct-shared-oauth-1",
            nextReconcileAt: null,
            now: "2026-03-16T10:00:00.000Z",
            reconcileDays: 7,
            reconcileIntervalMs: 60_000,
            payload: {
              includePersonalInfo: false,
            },
          }).jobs[0]?.dedupeKey,
          priority: 25,
          payload: {
            windowStart: "2026-03-09T10:00:00.000Z",
            windowEnd: "2026-03-16T10:00:00.000Z",
            includePersonalInfo: false,
          },
        },
      ],
      nextReconcileAt: "2026-03-16T10:01:00.000Z",
    },
  );
});

test("shared oauth refreshing sessions reuse refreshed credentials and rethrow non-retryable request failures", async () => {
  const requestedTokens: string[] = [];
  const session = createRefreshingApiSession({
    context: {
      account: createAccount({
        accessToken: "stale-access-token",
      }),
      async refreshAccountTokens() {
        return createAccount({
          accessToken: "fresh-access-token",
          accessTokenExpiresAt: null,
        });
      },
    },
    requestJsonWithAccessToken: async (accessToken, path) => {
      requestedTokens.push(`${accessToken}:${path}`);
      return {
        ok: true,
      };
    },
    shouldRefresh() {
      return requestedTokens.length === 0;
    },
  });

  assert.deepEqual(await session.requestJson("/resource"), { ok: true });
  assert.equal(session.account.accessToken, "fresh-access-token");
  assert.deepEqual(requestedTokens, ["fresh-access-token:/resource"]);

  await assert.rejects(
    () =>
      requestWithRefreshAndRetry({
        shouldRefresh: () => false,
        async refresh() {
          throw new Error("refresh should not run");
        },
        async request() {
          throw new Error("plain failure");
        },
      }),
    /plain failure/u,
  );
});

test("shared oauth refreshing sessions update their current account and scheduled helpers stay deterministic", async () => {
  const accessTokens: string[] = [];
  const session = createRefreshingApiSession({
    context: {
      account: createAccount({
        accessToken: "stale-access-token",
        accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      async refreshAccountTokens() {
        return createAccount({
          accessToken: "fresh-access-token",
        });
      },
    },
    async requestJsonWithAccessToken<T>(accessToken: string, path: string): Promise<T | null> {
      accessTokens.push(`${accessToken}:${path}`);
      return { ok: true } as T;
    },
  });

  const response = await session.requestJson<{ ok: boolean }>("/collection");

  assert.deepEqual(response, { ok: true });
  assert.equal(session.account.accessToken, "fresh-access-token");
  assert.deepEqual(accessTokens, ["fresh-access-token:/collection"]);

  assert.equal(
    buildOAuthConnectUrl({
      baseUrl: "https://provider.test",
      authorizePath: "/oauth/authorize",
      clientId: "client-id",
      callbackUrl: "https://sync.example.test/callback",
      scopes: ["offline", "read:data"],
      state: "state-1",
    }),
    "https://provider.test/oauth/authorize?client_id=client-id&response_type=code&redirect_uri=https%3A%2F%2Fsync.example.test%2Fcallback&scope=offline+read%3Adata&state=state-1",
  );
  const scheduled = buildScheduledReconcileJobs({
    accountId: "acct-shared-oauth-1",
    nextReconcileAt: "2026-03-16T09:00:00.000Z",
    now: "2026-03-16T10:00:00.000Z",
    reconcileDays: 7,
    reconcileIntervalMs: 60_000,
    payload: {
      includeProfile: false,
    },
  });
  assert.match(scheduled.jobs[0]?.dedupeKey ?? "", /^reconcile:[a-f0-9]{64}$/u);
  assert.deepEqual(
    scheduled,
    {
      jobs: [
        {
          kind: "reconcile",
          dedupeKey: scheduled.jobs[0]?.dedupeKey ?? "",
          priority: 25,
          payload: {
            windowStart: "2026-03-09T10:00:00.000Z",
            windowEnd: "2026-03-16T10:00:00.000Z",
            includeProfile: false,
          },
        },
      ],
      nextReconcileAt: "2026-03-16T10:01:00.000Z",
    },
  );
});
