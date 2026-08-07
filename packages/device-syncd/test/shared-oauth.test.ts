import assert from "node:assert/strict";

import { test, vi } from "vitest";

import {
  adaptDeviceSyncOAuthProvider,
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

type DeviceSyncAccountOverrides = Partial<Omit<DeviceSyncAccount, "credential">> & {
  accessToken?: string;
  refreshToken?: string | null;
  credential?: DeviceSyncAccount["credential"];
};

function createAccount(overrides: DeviceSyncAccountOverrides = {}): DeviceSyncAccount {
  const {
    accessToken = "access-token",
    refreshToken = "refresh-token",
    credential,
    ...accountOverrides
  } = overrides;
  const accessTokenExpiresAt = accountOverrides.accessTokenExpiresAt ?? null;

  return {
    id: "acct-shared-oauth-1",
    provider: "demo",
    externalAccountId: "demo-user-1",
    disconnectGeneration: 0,
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

function requireOAuthTokens(account: DeviceSyncAccount) {
  if (account.credential.kind !== "oauth_tokens") {
    throw new TypeError("Expected OAuth account.");
  }

  return account.credential.tokens;
}

test("shared oauth helpers normalize response parsing, retry metadata, scopes, and expiry helpers", async () => {
  assert.equal(await parseResponseBody(new Response("ok")), "ok");
  const unreadableResponse = new Response("ok");
  vi.spyOn(unreadableResponse, "text").mockRejectedValue(new Error("boom"));
  assert.equal(
    await parseResponseBody(unreadableResponse),
    "",
  );
  const abortController = new AbortController();
  const abortReason = new Error("body parent abort");
  const abortedResponse = new Response("ok");
  vi.spyOn(abortedResponse, "text").mockImplementation(async () => {
    abortController.abort(abortReason);
    throw new DOMException("The operation was aborted.", "AbortError");
  });
  await assert.rejects(
    () => parseResponseBody(abortedResponse, abortController.signal),
    (error) => error === abortReason,
  );

  const rateLimited = buildProviderApiError(
    "RATE_LIMITED",
    "Rate limited",
    new Response("{}", { status: 429 }),
    "{}",
  );
  assert.equal(rateLimited.retryable, true);
  assert.equal(rateLimited.httpStatus, 429);
  assert.deepEqual(rateLimited.details, {
    accountStatus: null,
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: true,
    status: 429,
  });

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
  assert.deepEqual(unauthorized.details, {
    accountStatus: "reauthorization_required",
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: false,
    status: 401,
  });

  const withDiagnostics = buildProviderApiError(
    "TOKEN_FAILED",
    "Token failed",
    new Response("{}", { status: 400 }),
    "{}",
    {
      diagnostics: {
        oauthErrorDescription: "Refresh token expired at https://api.example.test/token?access_token=secret",
        oauthErrorCode: "invalid_grant",
        oauthGrantType: "refresh_token",
        unsafeText: "contains spaces",
      },
    },
  );
  assert.deepEqual(withDiagnostics.details, {
    accountStatus: null,
    oauthErrorDescription: "Refresh token expired at <redacted-url>",
    oauthErrorCode: "invalid_grant",
    oauthGrantType: "refresh_token",
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: false,
    status: 400,
  });

  const withUnsafeDiagnostics = buildProviderApiError(
    "TOKEN_FAILED",
    "Token failed",
    new Response("{}", { status: 400 }),
    "{}",
    {
      diagnostics: {
        oauthErrorDescription: '{"refresh_token":"fixture-secret","user_id":"user-sensitive"}',
        oauthErrorCode: "invalid_grant",
      },
    },
  );
  assert.deepEqual(withUnsafeDiagnostics.details, {
    accountStatus: null,
    oauthErrorCode: "invalid_grant",
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: false,
    status: 400,
  });

  const withProviderReason = buildProviderApiError(
    "PROVIDER_FAILED",
    "Provider failed",
    new Response(null, { status: 502 }),
    JSON.stringify({
      code: "upstream_timeout",
      message: "Provider timed out after retrying.",
    }),
  );
  assert.deepEqual(withProviderReason.details, {
    accountStatus: null,
    responseErrorCode: "upstream_timeout",
    responseErrorDescription: "Provider timed out after retrying.",
    responseErrorDescriptionFieldPresent: true,
    responseErrorFieldPresent: true,
    responseShapeKind: "json_object",
    retryable: true,
    status: 502,
  });

  const withValidationDetail = buildProviderApiError(
    "PROVIDER_FAILED",
    "Provider failed",
    new Response(null, { status: 422 }),
    JSON.stringify({
      detail: [{
        type: "value_error.date",
        loc: ["query", "start_date"],
        msg: "start_date must be before end_date.",
      }],
    }),
  );
  assert.deepEqual(withValidationDetail.details, {
    accountStatus: null,
    responseErrorCode: "value_error.date",
    responseErrorDescription: "start_date must be before end_date.",
    responseErrorDescriptionFieldPresent: true,
    responseErrorFieldPresent: true,
    responseShapeKind: "json_object",
    retryable: false,
    status: 422,
  });

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

test("shared oauth bearer fetch helper honors caller abort signals", async () => {
  const controller = new AbortController();
  const abortReason = new Error("caller abort");

  await assert.rejects(
    () =>
      fetchBearerJson({
        fetchImpl: async (_input, init) => {
          const signal = init?.signal;
          assert.ok(signal);
          return await new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            controller.abort(abortReason);
          });
        },
        url: "https://provider.test/resource",
        accessToken: "access-token",
        timeoutMs: 1_000,
        signal: controller.signal,
        buildError(response) {
          return new Error(`unexpected ${response.status}`);
        },
      }),
    /caller abort/u,
  );
});

test("shared oauth fetch helpers preserve caller abort reasons when fetch reports a generic AbortError", async () => {
  const createAbortFetch = (controller: AbortController, reason: Error): typeof fetch =>
    async (_input, init) => {
      const signal = init?.signal;
      assert.ok(signal);

      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
        controller.abort(reason);
      });
    };

  const tokenAbortController = new AbortController();
  const tokenAbortReason = new Error("token parent abort");
  await assert.rejects(
    () =>
      postOAuthTokenRequest({
        fetchImpl: createAbortFetch(tokenAbortController, tokenAbortReason),
        url: "https://provider.test/oauth/token",
        timeoutMs: 1_000,
        parameters: {
          grant_type: "client_credentials",
        },
        signal: tokenAbortController.signal,
        buildError(response) {
          return new Error(`unexpected ${response.status}`);
        },
      }),
    (error) => error === tokenAbortReason,
  );

  const bearerAbortController = new AbortController();
  const bearerAbortReason = new Error("bearer parent abort");
  await assert.rejects(
    () =>
      fetchBearerJson({
        fetchImpl: createAbortFetch(bearerAbortController, bearerAbortReason),
        url: "https://provider.test/resource",
        accessToken: "access-token",
        timeoutMs: 1_000,
        signal: bearerAbortController.signal,
        buildError(response) {
          return new Error(`unexpected ${response.status}`);
        },
      }),
    (error) => error === bearerAbortReason,
  );
});

test("shared oauth fetch helpers do not misclassify request timeouts as late caller aborts", async () => {
  const abortController = new AbortController();
  const abortReason = new Error("late caller abort");

  await assert.rejects(
    () =>
      fetchBearerJson({
        fetchImpl: async (_input, init) => {
          const signal = init?.signal;
          assert.ok(signal);

          return await new Promise<Response>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                abortController.abort(abortReason);
                reject(new DOMException("The operation was aborted.", "AbortError"));
              },
              { once: true },
            );
          });
        },
        url: "https://provider.test/resource",
        accessToken: "access-token",
        timeoutMs: 1,
        signal: abortController.signal,
        buildError(response) {
          return new Error(`unexpected ${response.status}`);
        },
      }),
    (error) => {
      assert.notEqual(error, abortReason);
      assert.equal(error instanceof DOMException, true);
      assert.equal((error as DOMException).name, "AbortError");
      return true;
    },
  );
});

test("shared oauth request helpers keep caller abort active through response body parsing", async () => {
  const createSlowBodyFetch = (controller: AbortController, reason: Error): typeof fetch =>
    async (_input, init) => {
      const signal = init?.signal;
      assert.ok(signal);
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          signal.addEventListener("abort", () => {
            streamController.error(signal.reason);
          }, { once: true });
          queueMicrotask(() => controller.abort(reason));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    };
  const expectRejectsBeforeTimeout = async (
    promise: Promise<unknown>,
    pattern: RegExp,
    timeoutMessage: string,
  ): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await assert.rejects(
        Promise.race([
          promise,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error(timeoutMessage)), 1_000);
          }),
        ]),
        pattern,
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  const tokenController = new AbortController();
  await expectRejectsBeforeTimeout(
    postOAuthTokenRequest({
      fetchImpl: createSlowBodyFetch(tokenController, new Error("token body abort")),
      url: "https://provider.test/oauth/token",
      timeoutMs: 1_000,
      parameters: {
        grant_type: "client_credentials",
      },
      signal: tokenController.signal,
      buildError(response) {
        return new Error(`unexpected ${response.status}`);
      },
    }),
    /token body abort/u,
    "token body abort timed out",
  );

  const bearerController = new AbortController();
  await expectRejectsBeforeTimeout(
    fetchBearerJson({
      fetchImpl: createSlowBodyFetch(bearerController, new Error("bearer body abort")),
      url: "https://provider.test/resource",
      accessToken: "access-token",
      timeoutMs: 1_000,
      signal: bearerController.signal,
      buildError(response) {
        return new Error(`unexpected ${response.status}`);
      },
    }),
    /bearer body abort/u,
    "bearer body abort timed out",
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

  const retryAbortController = new AbortController();
  let abortedRetryAttempts = 0;
  await assert.rejects(
    () =>
      requestWithRefreshAndRetry({
        shouldRefresh: () => false,
        async refresh() {
          throw new Error("refresh should not run for aborted retries");
        },
        async request() {
          abortedRetryAttempts += 1;
          retryAbortController.abort(new Error("stop retry"));
          throw {
            retryable: true,
            httpStatus: 503,
          };
        },
        signal: retryAbortController.signal,
      }),
    /stop retry/u,
  );
  assert.equal(abortedRetryAttempts, 1);

  vi.useFakeTimers();
  try {
    const delayAbortController = new AbortController();
    let delayRetryAttempts = 0;
    const delayRetryPromise = requestWithRefreshAndRetry({
      shouldRefresh: () => false,
      async refresh() {
        throw new Error("refresh should not run during retry delay abort");
      },
      async request() {
        delayRetryAttempts += 1;
        throw {
          retryable: true,
          httpStatus: 503,
        };
      },
      signal: delayAbortController.signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    assert.equal(delayRetryAttempts, 1);
    delayAbortController.abort(new Error("stop during retry delay"));
    await assert.rejects(() => delayRetryPromise, /stop during retry delay/u);
    assert.equal(delayRetryAttempts, 1);
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

test("shared oauth helpers reject extension parameters that override protocol-owned fields", async () => {
  let exchangeRequests = 0;
  await assert.rejects(
    () => exchangeOAuthAuthorizationCode({
      async postTokenRequest() {
        exchangeRequests += 1;
        return {
          access_token: "access-token",
          refresh_token: "refresh-token",
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
      extraParameters: dynamicStringRecord("client_id", "override-client-id"),
    }),
    /must not override protocol-owned field client_id/u,
  );
  assert.equal(exchangeRequests, 0);

  await assert.rejects(
    () => exchangeOAuthAuthorizationCode({
      async postTokenRequest() {
        exchangeRequests += 1;
        return {
          access_token: "access-token",
          refresh_token: "refresh-token",
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
      extraParameters: dynamicStringRecord(
        "refresh_token",
        "unexpected-refresh-token",
      ),
    }),
    /must not override protocol-owned field refresh_token/u,
  );
  assert.equal(exchangeRequests, 0);

  let refreshRequests = 0;
  await assert.rejects(
    () => refreshOAuthTokens({
      async postTokenRequest() {
        refreshRequests += 1;
        return {
          access_token: "refreshed-access-token",
          refresh_token: "rotated-refresh-token",
        };
      },
      account: createAccount(),
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenResponseToAuthTokens(payload) {
        return tokenResponseToAuthTokens(payload, () => new Error("missing access token"));
      },
      buildMissingRefreshTokenError: () => new Error("missing refresh token"),
      extraParameters: dynamicStringRecord(
        "refresh_token",
        "override-refresh-token",
      ),
    }),
    /must not override protocol-owned field refresh_token/u,
  );
  assert.equal(refreshRequests, 0);

  await assert.rejects(
    () => refreshOAuthTokens({
      async postTokenRequest() {
        refreshRequests += 1;
        return {
          access_token: "refreshed-access-token",
          refresh_token: "rotated-refresh-token",
        };
      },
      account: createAccount(),
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenResponseToAuthTokens(payload) {
        return tokenResponseToAuthTokens(payload, () => new Error("missing access token"));
      },
      buildMissingRefreshTokenError: () => new Error("missing refresh token"),
      extraParameters: dynamicStringRecord("code", "unexpected-code"),
    }),
    /must not override protocol-owned field code/u,
  );
  assert.equal(refreshRequests, 0);

  assert.throws(
    () => buildOAuthConnectUrl({
      baseUrl: "https://provider.test",
      authorizePath: "/oauth/authorize",
      clientId: "client-id",
      callbackUrl: "https://sync.example.test/oauth/callback",
      scopes: ["offline"],
      state: "state-1",
      extraSearchParams: dynamicStringRecord("state", "override-state"),
    }),
    /must not override protocol-owned field state/u,
  );
});

function dynamicStringRecord(key: string, value: string): Record<string, string> {
  return Object.fromEntries([[key, value]]);
}

test("shared oauth adapter exposes nested oauthAdapter and routes refresh and revoke through connectionHandler", async () => {
  const refreshTokens = vi.fn(async () => ({
    accessToken: "refreshed-access-token",
    refreshToken: "refreshed-refresh-token",
  }));
  const revokeAccess = vi.fn(async () => {});
  const provider = adaptDeviceSyncOAuthProvider({
    provider: "demo",
    descriptor: {
      provider: "demo",
      displayName: "Demo",
      transportModes: ["oauth_callback"],
      oauth: {
        callbackPath: "/oauth/demo/callback",
        defaultScopes: ["offline"],
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
    buildConnectUrl({ state, callbackUrl }) {
      return `https://provider.test/oauth?state=${state}&callback=${encodeURIComponent(callbackUrl)}`;
    },
    async exchangeAuthorizationCode(context, code) {
      assert.equal(context.state, "state-1");
      assert.equal(context.callbackUrl, "https://sync.example.test/oauth/callback");
      assert.deepEqual(context.grantedScopes, ["offline"]);
      assert.equal(code, "auth-code");

      return {
        externalAccountId: `external-${code}`,
        scopes: ["offline"],
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
        },
      };
    },
    refreshTokens,
    revokeAccess,
    async executeJob() {
      return {};
    },
  });

  assert.ok(provider.oauthAdapter);
  assert.ok(provider.connectionHandler);
  assert.ok(provider.jobExecutor);
  assert.equal("buildConnectUrl" in provider, false);
  assert.equal("exchangeAuthorizationCode" in provider, false);
  assert.equal("refreshTokens" in provider, false);
  assert.equal("revokeAccess" in provider, false);
  assert.equal(provider.connectionHandler.refreshTokens, provider.oauthAdapter.refreshTokens);

  const begin = await provider.connectionHandler.beginConnection({
    state: "state-1",
    callbackUrl: "https://sync.example.test/oauth/callback",
    publicBaseUrl: "https://sync.example.test/device-sync",
    scopes: ["offline"],
    now: "2026-03-16T10:00:00.000Z",
  });
  assert.equal(
    begin.authorizationUrl,
    "https://provider.test/oauth?state=state-1&callback=https%3A%2F%2Fsync.example.test%2Foauth%2Fcallback",
  );

  const connection = await provider.connectionHandler.completeConnection({
    callbackUrl: "https://sync.example.test/oauth/callback",
    state: "state-1",
    now: "2026-03-16T10:00:00.000Z",
    grantedScopes: ["offline"],
    query: new URLSearchParams({ code: "auth-code" }),
  });

  assert.equal(connection.externalAccountId, "external-auth-code");
  assert.equal(refreshTokens.mock.calls.length, 0);

  const connectionRefreshTokens = provider.connectionHandler.refreshTokens;
  if (!connectionRefreshTokens) {
    throw new Error("Expected connectionHandler.refreshTokens.");
  }
  const refreshed = await connectionRefreshTokens(createAccount());
  assert.deepEqual(refreshed, {
    accessToken: "refreshed-access-token",
    refreshToken: "refreshed-refresh-token",
  });
  assert.equal(refreshTokens.mock.calls.length, 1);

  const connectionRevokeAccess = provider.connectionHandler.revokeAccess;
  if (!connectionRevokeAccess) {
    throw new Error("Expected connectionHandler.revokeAccess.");
  }
  await connectionRevokeAccess(createAccount());
  assert.equal(revokeAccess.mock.calls.length, 1);
});

test("shared oauth adapter omits revokeAccess when it is not supplied", () => {
  const provider = adaptDeviceSyncOAuthProvider({
    provider: "demo",
    descriptor: {
      provider: "demo",
      displayName: "Demo",
      transportModes: ["oauth_callback"],
      oauth: {
        callbackPath: "/oauth/demo/callback",
        defaultScopes: ["offline"],
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
    buildConnectUrl() {
      return "https://provider.test/oauth";
    },
    async exchangeAuthorizationCode() {
      return {
        externalAccountId: "external-auth-code",
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
        },
      };
    },
    async refreshTokens() {
      return {
        accessToken: "refreshed-access-token",
      };
    },
    async executeJob() {
      return {};
    },
  });

  assert.equal(provider.connectionHandler.revokeAccess, undefined);
  assert.equal("revokeAccess" in provider.connectionHandler, false);
  assert.equal("revokeAccess" in provider, false);
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
    requestJsonWithAccessToken: async <T>(
      accessToken: string,
      path: string,
      _options: { optional?: boolean },
    ) => {
      requestedTokens.push(`${accessToken}:${path}`);
      return {
        ok: true,
      } as T;
    },
    shouldRefresh() {
      return requestedTokens.length === 0;
    },
  });

  assert.deepEqual(await session.requestJson("/resource"), { ok: true });
  assert.equal(requireOAuthTokens(session.account).accessToken, "fresh-access-token");
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
  assert.equal(requireOAuthTokens(session.account).accessToken, "fresh-access-token");
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
