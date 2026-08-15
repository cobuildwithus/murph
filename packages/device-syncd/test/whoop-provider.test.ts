import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
import { createWhoopDeviceSyncProvider } from "../src/providers/whoop.ts";
import { sha256Text, subtractDays } from "../src/shared.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceConnectionHandler,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
  DeviceWebhookHandler,
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
    id: "acct-whoop-1",
    provider: "whoop",
    externalAccountId: "whoop-user-1",
    disconnectGeneration: 0,
    displayName: "WHOOP whoop-user-1",
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
    hostedObservedConnectionRevision: overrides.hostedObservedConnectionRevision ?? 0,
    hostedObservedTokenRevision: overrides.hostedObservedTokenRevision ?? 0,
    hostedObservedTokenVersion: null,
    hostedObservedUpdatedAt: null,
    localConnectionRevision: overrides.localConnectionRevision ?? 0,
    localTokenRevision: overrides.localTokenRevision ?? 0,
  };
}

function expectedWhoopRefreshRequestDiagnostics() {
  return {
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
  };
}

function expectedWhoopAuthorizationCodeRequestDiagnostics() {
  return {
    requestAuthKind: "oauth_client_secret_body",
    requestAuthPlacement: "body_parameters",
    requestBodyFieldCount: 5,
    requestBodyFieldNames: "client_id.client_secret.code.grant_type.redirect_uri",
    requestBodyKind: "form_urlencoded",
    requestContentType: "application_x_www_form_urlencoded",
    requestCredentialPresent: true,
    requestEndpointKind: "whoop_oauth_token",
    requestMethod: "POST",
    requestQueryParameterCount: 0,
    requestQueryParameterNames: null,
    oauthGrantType: "authorization_code",
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
    oauthRequestParameterCount: 5,
    oauthRequestParameterNames: "client_id.client_secret.code.grant_type.redirect_uri",
    oauthRequestRefreshCredentialPresent: false,
    oauthRequestScopeCount: 0,
    oauthRequestScopePresent: false,
    oauthRequestScopeValue: null,
    oauthRequestTokenEndpointKind: "whoop_oauth_token",
  };
}

function expectedWhoopJsonOAuthErrorResponseDiagnostics() {
  return {
    responseErrorDescriptionFieldPresent: true,
    responseErrorFieldPresent: true,
    responseShapeKind: "json_object",
    oauthResponseErrorDescriptionFieldPresent: true,
    oauthResponseErrorFieldPresent: true,
    oauthResponseShapeKind: "json_object",
  };
}

function requireOAuthTokens(connection: ProviderConnectionResult): ProviderAuthTokens {
  const tokens = connection.credential?.kind === "oauth_tokens"
    ? connection.credential.tokens
    : connection.tokens;
  assert.ok(tokens);
  return tokens;
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

function requireVerifyAndParseWebhook(
  provider: DeviceSyncProvider,
): NonNullable<DeviceWebhookHandler["verifyAndParseWebhook"]> {
  return requireValue(provider.webhookHandler?.verifyAndParseWebhook);
}

function requireRevokeAccess(provider: DeviceSyncProvider): NonNullable<DeviceConnectionHandler["revokeAccess"]> {
  return requireValue(provider.connectionHandler?.revokeAccess);
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
    provider.oauthAdapter.buildConnectUrl({
      state: "state-1",
      callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
      scopes: ["offline", "read:profile"],
      now: "2026-03-16T10:00:00.000Z",
    }),
    "https://api.prod.whoop.com/oauth/oauth2/auth?client_id=whoop-client-id&response_type=code&redirect_uri=https%3A%2F%2Fsync.example.test%2Fdevice-sync%2Foauth%2Fwhoop%2Fcallback&scope=offline+read%3Aprofile&state=state-1",
  );

  const connection = await provider.oauthAdapter.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
      state: "state-1",
      now: "2026-03-16T10:00:00.000Z",
      grantedScopes: [],
    },
    "auth-code-1",
  );

  assert.equal(connection.externalAccountId, "whoop-user-1");
  assert.equal(connection.displayName, "WHOOP whoop-user-1");
  assert.equal(requireOAuthTokens(connection).refreshToken, "refresh-token");
  assert.deepEqual(connection.scopes, ["offline", "read:profile", "read:workout"]);
  assert.equal(connection.initialJobs?.[0]?.kind, "backfill");
  assert.deepEqual(connection.initialJobs?.[0]?.payload, {
    windowStart: "2025-09-17T10:00:00.000Z",
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

  const connection = await provider.oauthAdapter.exchangeAuthorizationCode(
    {
      callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
      state: "state-1",
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

test("WHOOP provider reports connect-time profile failures with a semantic endpoint kind", async () => {
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
          code: "forbidden",
          message: "Provider access to the profile is forbidden.",
        }, 403);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
          state: "state-profile-failure",
          now: "2026-03-16T10:00:00.000Z",
          grantedScopes: [],
        },
        "auth-code-profile-failure",
      ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_API_REQUEST_FAILED");
      assert.equal(error.details?.requestEndpointKind, "whoop_user_profile");
      assert.equal(error.details?.responseErrorDescription, "Provider access to the profile is forbidden.");
      return true;
    },
  );
});

test("WHOOP provider rejects refresh responses that omit the rotated refresh token", async () => {
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

  await assert.rejects(
    provider.oauthAdapter.refreshTokens(
      createAccount(["offline"], {
        refreshToken: "persisted-refresh-token",
      }),
    ),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "TOKEN_REFRESH_STATE_UNKNOWN" &&
      error.accountStatus === "reauthorization_required",
  );
  assert.equal(new URLSearchParams(requestBody ?? "").get("grant_type"), "refresh_token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("refresh_token"), "persisted-refresh-token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("scope"), "offline");
});

test("WHOOP provider marks invalid refresh-token grants as reauthorization required", async () => {
  let requestBody: string | null = null;
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        requestBody = readRequestBody(init);
        return createJsonResponse({
          error: "invalid_grant",
          error_description: "The refresh token is invalid.",
        }, 400);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    provider.oauthAdapter.refreshTokens(
      createAccount(["offline"], {
        refreshToken: "persisted-refresh-token",
      }),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_TOKEN_REQUEST_FAILED");
      assert.equal(error.httpStatus, 400);
      assert.equal(error.retryable, false);
      assert.equal(error.accountStatus, "reauthorization_required");
      assert.deepEqual(error.details, {
        status: 400,
        retryable: false,
        accountStatus: "reauthorization_required",
        oauthErrorCode: "invalid_grant",
        oauthErrorDescription: "The refresh token is invalid.",
        responseErrorCode: "invalid_grant",
        responseErrorDescription: "The refresh token is invalid.",
        ...expectedWhoopRefreshRequestDiagnostics(),
        ...expectedWhoopJsonOAuthErrorResponseDiagnostics(),
      });
      return true;
    },
  );
  assert.equal(new URLSearchParams(requestBody ?? "").get("grant_type"), "refresh_token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("refresh_token"), "persisted-refresh-token");
  assert.equal(new URLSearchParams(requestBody ?? "").get("scope"), "offline");
});

test("WHOOP provider includes safe request-shape diagnostics for auth-code token failures", async () => {
  let requestBody: string | null = null;
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        requestBody = readRequestBody(init);
        return createJsonResponse({
          error: "invalid_request",
          error_description: "Authorization code expired. Restart WHOOP connection.",
        }, 400);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
          state: "state-auth-code-diagnostics",
          now: "2026-03-16T10:00:00.000Z",
          grantedScopes: [],
        },
        "auth-code-fixture",
      ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_TOKEN_REQUEST_FAILED");
      assert.equal(error.httpStatus, 400);
      assert.equal(error.retryable, false);
      assert.equal(error.accountStatus, null);
      assert.deepEqual(error.details, {
        status: 400,
        retryable: false,
        accountStatus: null,
        oauthErrorCode: "invalid_request",
        oauthErrorDescription: "Authorization code expired. Restart WHOOP connection.",
        responseErrorCode: "invalid_request",
        responseErrorDescription: "Authorization code expired. Restart WHOOP connection.",
        ...expectedWhoopAuthorizationCodeRequestDiagnostics(),
        ...expectedWhoopJsonOAuthErrorResponseDiagnostics(),
      });
      assert.equal(JSON.stringify(error.details).includes("auth-code-fixture"), false);
      assert.equal(JSON.stringify(error.details).includes("whoop-client-secret"), false);
      return true;
    },
  );
  assert.equal(new URLSearchParams(requestBody ?? "").get("grant_type"), "authorization_code");
  assert.equal(new URLSearchParams(requestBody ?? "").get("code"), "auth-code-fixture");
  assert.equal(new URLSearchParams(requestBody ?? "").get("redirect_uri"), "https://sync.example.test/device-sync/oauth/whoop/callback");
});

test("WHOOP provider treats token-specific refresh invalid_request errors as reauthorization required", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return createJsonResponse({
          error: "invalid_request",
          error_description: "The refresh token is invalid.",
        }, 400);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    provider.oauthAdapter.refreshTokens(
      createAccount(["offline"], {
        refreshToken: "persisted-refresh-token",
      }),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_TOKEN_REQUEST_FAILED");
      assert.equal(error.httpStatus, 400);
      assert.equal(error.retryable, false);
      assert.equal(error.accountStatus, "reauthorization_required");
      assert.deepEqual(error.details, {
        status: 400,
        retryable: false,
        accountStatus: "reauthorization_required",
        oauthErrorCode: "invalid_request",
        oauthErrorDescription: "The refresh token is invalid.",
        responseErrorCode: "invalid_request",
        responseErrorDescription: "The refresh token is invalid.",
        ...expectedWhoopRefreshRequestDiagnostics(),
        ...expectedWhoopJsonOAuthErrorResponseDiagnostics(),
      });
      return true;
    },
  );
});

test("WHOOP provider treats generic refresh invalid_request errors as reconnectable when request shape is complete", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return createJsonResponse({
          error: "invalid_request",
          error_description: "The token request is malformed.",
        }, 400);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    provider.oauthAdapter.refreshTokens(
      createAccount(["offline"], {
        refreshToken: "persisted-refresh-token",
      }),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_TOKEN_REQUEST_FAILED");
      assert.equal(error.httpStatus, 400);
      assert.equal(error.retryable, false);
      assert.equal(error.accountStatus, "reauthorization_required");
      assert.deepEqual(error.details, {
        status: 400,
        retryable: false,
        accountStatus: "reauthorization_required",
        oauthErrorCode: "invalid_request",
        oauthErrorDescription: "The token request is malformed.",
        responseErrorCode: "invalid_request",
        responseErrorDescription: "The token request is malformed.",
        ...expectedWhoopRefreshRequestDiagnostics(),
        ...expectedWhoopJsonOAuthErrorResponseDiagnostics(),
      });
      return true;
    },
  );
});

test("WHOOP provider does not mark client credential token failures as reauthorization required", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return createJsonResponse({
          error: "invalid_client",
          error_description: "The OAuth client credentials are invalid.",
        }, 401);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    provider.oauthAdapter.refreshTokens(
      createAccount(["offline"], {
        refreshToken: "persisted-refresh-token",
      }),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_TOKEN_REQUEST_FAILED");
      assert.equal(error.httpStatus, 401);
      assert.equal(error.retryable, false);
      assert.equal(error.accountStatus, null);
      assert.deepEqual(error.details, {
        status: 401,
        retryable: false,
        accountStatus: null,
        oauthErrorCode: "invalid_client",
        oauthErrorDescription: "The OAuth client credentials are invalid.",
        responseErrorCode: "invalid_client",
        responseErrorDescription: "The OAuth client credentials are invalid.",
        ...expectedWhoopRefreshRequestDiagnostics(),
        ...expectedWhoopJsonOAuthErrorResponseDiagnostics(),
      });
      return true;
    },
  );
});

test("WHOOP provider does not mark opaque token endpoint authorization failures as reauthorization required", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return new Response("", { status: 401 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    provider.oauthAdapter.refreshTokens(
      createAccount(["offline"], {
        refreshToken: "persisted-refresh-token",
      }),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_TOKEN_REQUEST_FAILED");
      assert.equal(error.httpStatus, 401);
      assert.equal(error.retryable, false);
      assert.equal(error.accountStatus, null);
      assert.deepEqual(error.details, {
        status: 401,
        retryable: false,
        accountStatus: null,
        ...expectedWhoopRefreshRequestDiagnostics(),
        responseErrorDescriptionFieldPresent: false,
        responseErrorFieldPresent: false,
        responseShapeKind: "empty",
        oauthResponseErrorDescriptionFieldPresent: false,
        oauthResponseErrorFieldPresent: false,
        oauthResponseShapeKind: "empty",
      });
      return true;
    },
  );
});

test("WHOOP provider treats rate-limited token requests as retryable", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return createJsonResponse({
          error: "rate_limited",
        }, 429);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    provider.oauthAdapter.refreshTokens(
      createAccount(["offline"], {
        refreshToken: "persisted-refresh-token",
      }),
    ),
    (error) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_TOKEN_REQUEST_FAILED" &&
      error.httpStatus === 429 &&
      error.retryable === true &&
      error.accountStatus === null,
  );
});

test("WHOOP provider includes safe request and response diagnostics for API failures", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/developer/v2/activity/sleep/sleep-sensitive-id") {
        assert.equal(readAuthorizationHeader(init), "Bearer stored-access-token");
        return createJsonResponse({
          code: "forbidden",
          message: "Provider access to this resource is forbidden.",
        }, 403);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(["read:sleep"], {
      accessToken: "stored-access-token",
    }),
    now: "2026-03-16T10:00:00.000Z",
    logger: {},
    async importSnapshot() {
      throw new Error("import should not run after an API failure");
    },
    async refreshAccountTokens() {
      throw new Error("refresh should not run after a non-retryable API failure");
    },
  };

  await assert.rejects(
    () =>
      provider.jobExecutor.executeJob(
        context,
        createJob("resource", {
          resourceId: "sleep-sensitive-id",
          resourceType: "sleep",
        }),
      ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "WHOOP_API_REQUEST_FAILED");
      assert.equal(error.message, "WHOOP API request failed for whoop_sleep_resource.");
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details, {
        accountStatus: null,
        requestAuthKind: "bearer_access_token",
        requestAuthPlacement: "headers",
        requestBodyFieldCount: 0,
        requestBodyFieldNames: null,
        requestBodyKind: "none",
        requestContentType: "none",
        requestCredentialPresent: true,
        requestEndpointKind: "whoop_sleep_resource",
        requestMethod: "GET",
        requestQueryParameterCount: 0,
        requestQueryParameterNames: null,
        responseErrorCode: "forbidden",
        responseErrorDescription: "Provider access to this resource is forbidden.",
        responseErrorDescriptionFieldPresent: true,
        responseErrorFieldPresent: true,
        responseShapeKind: "json_object",
        retryable: false,
        status: 403,
      });
      const serialized = JSON.stringify({
        message: error.message,
        details: error.details,
      });
      assert.equal(serialized.includes("sleep-sensitive-id"), false);
      assert.equal(serialized.includes("stored-access-token"), false);
      return true;
    },
  );
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
    provider.oauthAdapter.refreshTokens(
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

test("WHOOP provider rejects auth exchanges without a refresh token", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/oauth/oauth2/token") {
        return createJsonResponse({
          access_token: "access-token",
          expires_in: 3600,
          scope: "offline read:profile",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
          state: "state-missing-refresh",
          now: "2026-03-16T10:00:00.000Z",
          grantedScopes: [],
        },
        "auth-code-missing-refresh",
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_REFRESH_TOKEN_MISSING" &&
      error.httpStatus === 502,
  );
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
  const revokeAccess = requireRevokeAccess(provider);

  await revokeAccess(
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

  await provider.jobExecutor.executeJob(
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
    bodyMeasurements: {
      height_meter: 1.83,
    },
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
  assert.equal(requests.at(-1)?.url, "https://api.prod.whoop.com/developer/v2/user/measurement/body");
});

test("WHOOP provider rejects repeated cursors and excessive pagination", async () => {
  const windowStart = "2026-03-15T00:00:00.000Z";
  const windowEnd = "2026-03-16T00:00:00.000Z";
  const sleepUrl = `https://api.prod.whoop.com/developer/v2/activity/sleep?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`;
  const sleepCursorUrl = `${sleepUrl}&nextToken=cursor-1`;
  const loopingProvider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === sleepUrl || url === sleepCursorUrl) {
        return createJsonResponse({
          records: [{ id: "sleep-1" }],
          next_token: "cursor-1",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      loopingProvider.jobExecutor.executeJob(
        {
          account: createAccount(["offline", "read:sleep"]),
          now: "2026-03-16T10:00:00.000Z",
          logger: {},
          async importSnapshot() {
            return { ok: true };
          },
          async refreshAccountTokens() {
            return createAccount(["offline", "read:sleep"]);
          },
        },
        createJob("backfill", {
          windowStart,
          windowEnd,
        }),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_PAGINATION_LOOP" &&
      error.retryable === true,
  );

  const oversizedRecords = Array.from({ length: 25_001 }, (_, index) => ({
    id: `sleep-${index}`,
  }));
  const oversizedProvider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === sleepUrl) {
        return createJsonResponse({
          records: oversizedRecords,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      oversizedProvider.jobExecutor.executeJob(
        {
          account: createAccount(["offline", "read:sleep"]),
          now: "2026-03-16T10:00:00.000Z",
          logger: {},
          async importSnapshot() {
            return { ok: true };
          },
          async refreshAccountTokens() {
            return createAccount(["offline", "read:sleep"]);
          },
        },
        createJob("backfill", {
          windowStart,
          windowEnd,
        }),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_RECORD_LIMIT_EXCEEDED" &&
      error.retryable === true,
  );

  let paginatedRequests = 0;
  const unboundedProvider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url.startsWith(sleepUrl)) {
        paginatedRequests += 1;
        return createJsonResponse({
          records: [],
          next_token: `cursor-${paginatedRequests}`,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    () =>
      unboundedProvider.jobExecutor.executeJob(
        {
          account: createAccount(["offline", "read:sleep"]),
          now: "2026-03-16T10:00:00.000Z",
          logger: {},
          async importSnapshot() {
            return { ok: true };
          },
          async refreshAccountTokens() {
            return createAccount(["offline", "read:sleep"]);
          },
        },
        createJob("backfill", {
          windowStart,
          windowEnd,
        }),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_PAGINATION_LIMIT_EXCEEDED" &&
      error.retryable === true,
  );
  assert.equal(paginatedRequests, 100);
});

test("WHOOP provider schedules reconcile jobs without profile/body-measurement sync flags", () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const now = "2026-03-16T10:00:00.000Z";
  const scheduled = provider.jobExecutor.createScheduledJobs?.(
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

test("WHOOP provider skips body measurement fetches when the account did not grant the body scope", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const windowStart = "2026-03-15T00:00:00.000Z";
  const windowEnd = "2026-03-16T00:00:00.000Z";
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === `https://api.prod.whoop.com/developer/v2/activity/sleep?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`) {
        return createJsonResponse({ records: [] });
      }

      if (url === `https://api.prod.whoop.com/developer/v2/recovery?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`) {
        return createJsonResponse({ records: [] });
      }

      if (url === `https://api.prod.whoop.com/developer/v2/cycle?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`) {
        return createJsonResponse({ records: [] });
      }

      if (url === `https://api.prod.whoop.com/developer/v2/activity/workout?limit=25&start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`) {
        return createJsonResponse({ records: [] });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/user/measurement/body") {
        throw new Error("body measurement fetch should not run without the body scope");
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context: ProviderJobContext = {
    account: createAccount(
      ["read:sleep", "read:recovery", "read:cycles", "read:workout", "read:profile"],
      {
        accessToken: "scoped-access-token",
      },
    ),
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

  await provider.jobExecutor.executeJob(
    context,
    createJob("reconcile", {
      windowStart,
      windowEnd,
    }),
  );

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "whoop-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      sleeps: [],
      recoveries: [],
      cycles: [],
      workouts: [],
    },
  ]);
  assert.equal(requests.includes("https://api.prod.whoop.com/developer/v2/user/measurement/body"), false);
});

test("WHOOP provider maps webhook events to the same job kinds, priorities, and payload fields", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);

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
    const result = await verifyAndParseWebhook({
      headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, String(Date.parse(now))),
      rawBody,
      now,
    });

    assert.ok(result);
    assert.equal(result?.acceptanceMode, "durable_webhook_work");
    assert.equal(result?.eventType, testCase.eventType);
    assert.equal(result?.externalAccountId, "whoop-user-1");
    assert.equal(result?.traceId, `trace:${testCase.eventType}`);
    assert.equal(result?.providerSentAt, now);
    assert.equal(result?.resourceCategory, testCase.resourceType);
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
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const webhookPayload = {
    user_id: "whoop-user-1",
    type: "sleep.updated",
    id: "resource-1",
  };
  const rawBody = Buffer.from(JSON.stringify(webhookPayload), "utf8");
  const timestamp = String(Date.parse("2026-03-16T10:00:00.000Z"));
  const parsed = await verifyAndParseWebhook({
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
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const webhookPayload = {
    user_id: "whoop-user-1",
    type: "sleep.deleted",
    id: "resource-1",
    occurred_at: "2026-03-16T10:00:00.000Z",
  };
  const rawBody = Buffer.from(JSON.stringify(webhookPayload), "utf8");
  const firstTimestamp = String(Date.parse("2026-03-16T10:00:00.000Z"));
  const retryTimestamp = String(Date.parse("2026-03-16T10:20:00.000Z"));

  const first = await verifyAndParseWebhook({
    headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, firstTimestamp),
    rawBody,
    now: "2026-03-16T10:00:00.000Z",
  });
  const retry = await verifyAndParseWebhook({
    headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, retryTimestamp),
    rawBody,
    now: "2026-03-16T10:20:00.000Z",
  });

  assert.equal(retry?.traceId, first?.traceId);
  assert.equal(retry?.jobs[0]?.dedupeKey, first?.jobs[0]?.dedupeKey);
});

test("WHOOP provider accepts numeric-second timestamps and leaves unknown webhook events as no-op hints", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const now = "2026-03-16T10:00:00.000Z";
  const rawBody = Buffer.from(
    JSON.stringify({
      user_id: "whoop-user-1",
      type: "team.updated",
      id: "resource-1",
    }),
    "utf8",
  );
  const timestamp = String(Math.floor(Date.parse(now) / 1000));
  const expectedTraceId = sha256Text(
    `whoop-user-1:team.updated:resource-1:${sha256Text(rawBody.toString("utf8"))}`,
  );

  const parsed = await verifyAndParseWebhook({
    headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, timestamp),
    rawBody,
    now,
  });

  assert.deepEqual(parsed, {
    acceptanceMode: "durable_webhook_work",
    externalAccountId: "whoop-user-1",
    eventType: "team.updated",
    traceId: expectedTraceId,
    providerSentAt: now,
    resourceCategory: null,
    jobs: [],
  });
});

test("WHOOP provider rejects non-object webhook payloads after signature verification succeeds", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const now = "2026-03-16T10:00:00.000Z";
  const rawBody = Buffer.from('["not-an-object"]', "utf8");
  const timestamp = String(Date.parse(now));

  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, timestamp),
        rawBody,
        now,
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_WEBHOOK_INVALID_PAYLOAD" &&
      error.httpStatus === 400,
  );
});

test("WHOOP provider does not synthesize delete snapshots when an updated resource fetch returns 404", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/developer/v2/activity/workout/workout-404") {
        return new Response(null, { status: 404 });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/activity/sleep/sleep-404") {
        return new Response(null, { status: 404 });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const cases = [
    {
      resourceType: "workout",
      resourceId: "workout-404",
      eventType: "workout.updated",
      scopes: ["read:workout"],
    },
    {
      resourceType: "sleep",
      resourceId: "sleep-404",
      eventType: "sleep.updated",
      scopes: ["offline"],
    },
  ] as const;

  for (const testCase of cases) {
    const importedSnapshots: unknown[] = [];

    await provider.jobExecutor.executeJob(
      {
        account: createAccount([...testCase.scopes]),
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
      },
      createJob("resource", {
        resourceType: testCase.resourceType,
        resourceId: testCase.resourceId,
        eventType: testCase.eventType,
        occurredAt: "2026-03-15T09:00:00.000Z",
      }),
    );

    assert.deepEqual(importedSnapshots, []);
  }
});

test("WHOOP provider skips resource imports when the account did not grant the required resource scopes", async () => {
  const cases = [
    {
      scopes: ["offline"],
      resourceType: "workout",
      resourceId: "workout-77",
      eventType: "workout.updated",
    },
    {
      scopes: ["read:recovery"],
      resourceType: "recovery",
      resourceId: "sleep-42",
      eventType: "recovery.updated",
    },
  ] as const;

  for (const testCase of cases) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createWhoopDeviceSyncProvider({
      clientId: "whoop-client-id",
      clientSecret: "whoop-client-secret",
      fetchImpl: async (input) => {
        const url = readUrl(input);
        requests.push(url);
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await provider.jobExecutor.executeJob(
      {
        account: createAccount([...testCase.scopes]),
        now: "2026-03-16T10:00:00.000Z",
        logger: {},
        async importSnapshot(snapshot) {
          importedSnapshots.push(snapshot);
          return { ok: true };
        },
        async refreshAccountTokens() {
          throw new Error("refreshAccountTokens should not be called");
        },
      },
      createJob("resource", {
        resourceType: testCase.resourceType,
        resourceId: testCase.resourceId,
        eventType: testCase.eventType,
      }),
    );

    assert.deepEqual(importedSnapshots, []);
    assert.deepEqual(requests, []);
  }
});

test("WHOOP provider rejects missing, invalid, stale, and bad-signature webhook deliveries before parsing payloads", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      user_id: "whoop-user-1",
      type: "sleep.updated",
      id: "resource-1",
    }),
    "utf8",
  );

  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: new Headers(),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_WEBHOOK_SIGNATURE_MISSING" &&
      error.httpStatus === 401,
  );
  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: new Headers({
          "x-whoop-signature": "signature",
          "x-whoop-signature-timestamp": "not-a-number",
        }),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_WEBHOOK_TIMESTAMP_INVALID" &&
      error.httpStatus === 401,
  );
  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: createWhoopWebhookHeaders(
          "whoop-client-secret",
          rawBody,
          String(Date.parse("2026-03-16T09:40:00.000Z")),
        ),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_WEBHOOK_TIMESTAMP_STALE" &&
      error.httpStatus === 401,
  );
  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: new Headers({
          "x-whoop-signature": "invalid-signature",
          "x-whoop-signature-timestamp": String(Date.parse("2026-03-16T10:00:00.000Z")),
        }),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_WEBHOOK_SIGNATURE_INVALID" &&
      error.httpStatus === 401,
  );
});

test("WHOOP provider rejects profile responses without a stable user id and tolerates already-revoked access", async () => {
  const revokeStatuses = [401, 404];
  let revokeIndex = 0;
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
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
          email: "whoop@example.com",
        });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/user/access" && init?.method === "DELETE") {
        const status = revokeStatuses[revokeIndex] ?? 204;
        revokeIndex += 1;
        return new Response(null, { status });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const revokeAccess = requireRevokeAccess(provider);

  await assert.rejects(
    () =>
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://sync.example.test/device-sync/oauth/whoop/callback",
          state: "state-missing-profile-id",
          now: "2026-03-16T10:00:00.000Z",
          grantedScopes: [],
        },
        "auth-code-missing-profile-id",
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_PROFILE_INVALID" &&
      error.httpStatus === 502,
  );
  assert.equal(revokeIndex, 1);

  await revokeAccess(createAccount(["offline"]));
  await revokeAccess(createAccount(["offline"]));
  assert.equal(revokeIndex, 3);
});

test("WHOOP webhook replay checks use the request context timestamp instead of process wall clock", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
  });
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
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
    const parsed = await verifyAndParseWebhook({
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

test("WHOOP provider surfaces revoke failures, rejects payloads missing required fields, and handles direct delete or unsupported jobs", async () => {
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input, init) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/developer/v2/user/access" && init?.method === "DELETE") {
        return createJsonResponse({ error: "rate limited" }, 429);
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const revokeAccess = requireRevokeAccess(provider);
  const verifyAndParseWebhook = requireVerifyAndParseWebhook(provider);
  const rawBody = Buffer.from(
    JSON.stringify({
      type: "sleep.updated",
      id: "resource-1",
    }),
    "utf8",
  );
  const importedSnapshots: unknown[] = [];

  await assert.rejects(
    () => revokeAccess(createAccount(["offline"])),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_REVOKE_FAILED",
  );
  await assert.rejects(
    () =>
      verifyAndParseWebhook({
        headers: createWhoopWebhookHeaders("whoop-client-secret", rawBody, String(Date.parse("2026-03-16T10:00:00.000Z"))),
        rawBody,
        now: "2026-03-16T10:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_WEBHOOK_PAYLOAD_INVALID" &&
      error.httpStatus === 400,
  );
  await assert.rejects(
    () =>
      provider.jobExecutor.executeJob(
        {
          account: createAccount(["offline"]),
          now: "2026-03-16T10:00:00.000Z",
          logger: {},
          async importSnapshot() {
            return { ok: true };
          },
          async refreshAccountTokens() {
            return createAccount(["offline"]);
          },
        },
        createJob("resource", {
          resourceId: "sleep-99",
        }),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_JOB_INVALID",
  );

  await provider.jobExecutor.executeJob(
    {
      account: createAccount(["offline"]),
      now: "2026-03-16T10:00:00.000Z",
      logger: {},
      async importSnapshot(snapshot) {
        importedSnapshots.push(snapshot);
        return { ok: true };
      },
      async refreshAccountTokens() {
        return createAccount(["offline"]);
      },
    },
    createJob("delete", {
      resourceType: "sleep",
      resourceId: "sleep-99",
      eventType: "sleep.deleted",
      occurredAt: "2026-03-15T09:00:00.000Z",
    }),
  );

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "whoop-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      deletions: [
        {
          resource_type: "sleep",
          resource_id: "sleep-99",
          occurred_at: "2026-03-15T09:00:00.000Z",
          source_event_type: "sleep.deleted",
        },
      ],
    },
  ]);

  const resourceSnapshots: unknown[] = [];
  const importProvider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/developer/v2/activity/workout/workout-77") {
        return createJsonResponse({
          id: "workout-77",
          sport_name: "rowing",
        });
      }

      if (url.startsWith("https://api.prod.whoop.com/developer/v2/activity/sleep?")) {
        return createJsonResponse({ records: [] });
      }

      if (url.startsWith("https://api.prod.whoop.com/developer/v2/recovery?")) {
        return createJsonResponse({ records: [] });
      }

      if (url.startsWith("https://api.prod.whoop.com/developer/v2/cycle?")) {
        return createJsonResponse({ records: [] });
      }

      if (url.startsWith("https://api.prod.whoop.com/developer/v2/activity/workout?")) {
        return createJsonResponse({ records: [] });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await importProvider.jobExecutor.executeJob(
    {
      account: createAccount(["offline", "read:workout"]),
      now: "2026-03-16T10:00:00.000Z",
      logger: {},
      async importSnapshot(snapshot) {
        resourceSnapshots.push(snapshot);
        return { ok: true };
      },
      async refreshAccountTokens() {
        return createAccount(["offline", "read:workout"]);
      },
    },
    createJob("resource", {
      resourceType: "workout",
      resourceId: "workout-77",
    }),
  );
  await importProvider.jobExecutor.executeJob(
    {
      account: createAccount(["offline", "read:sleep", "read:recovery", "read:cycles", "read:workout"]),
      now: "2026-03-16T10:00:00.000Z",
      logger: {},
      async importSnapshot(snapshot) {
        resourceSnapshots.push(snapshot);
        return { ok: true };
      },
      async refreshAccountTokens() {
        return createAccount(["offline", "read:sleep", "read:recovery", "read:cycles", "read:workout"]);
      },
    },
    createJob("reconcile", {}),
  );

  assert.deepEqual(resourceSnapshots, [
    {
      accountId: "whoop-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      workouts: [
        {
          id: "workout-77",
          sport_name: "rowing",
        },
      ],
    },
    {
      accountId: "whoop-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      sleeps: [],
      recoveries: [],
      cycles: [],
      workouts: [],
    },
  ]);
  await assert.rejects(
    () =>
      importProvider.jobExecutor.executeJob(
        {
          account: createAccount(["offline"]),
          now: "2026-03-16T10:00:00.000Z",
          logger: {},
          async importSnapshot() {
            return { ok: true };
          },
          async refreshAccountTokens() {
            return createAccount(["offline"]);
          },
        },
        createJob("resource", {
          resourceType: "mystery",
          resourceId: "resource-1",
        }),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_RESOURCE_UNSUPPORTED",
  );

  await assert.rejects(
    () =>
      provider.jobExecutor.executeJob(
        {
          account: createAccount(["offline"]),
          now: "2026-03-16T10:00:00.000Z",
          logger: {},
          async importSnapshot() {
            return { ok: true };
          },
          async refreshAccountTokens() {
            return createAccount(["offline"]);
          },
        },
        createJob("webhook", {}),
      ),
    (error: unknown) =>
      error instanceof DeviceSyncError &&
      error.code === "WHOOP_JOB_KIND_UNSUPPORTED",
  );
});

test("WHOOP provider imports sleep-related resources with linked cycle and recovery snapshots", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createWhoopDeviceSyncProvider({
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    fetchImpl: async (input) => {
      const url = readUrl(input);

      if (url === "https://api.prod.whoop.com/developer/v2/activity/sleep/sleep-42") {
        return createJsonResponse({
          id: "sleep-42",
          cycle_id: "cycle-42",
        });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/cycle/cycle-42") {
        return createJsonResponse({
          id: "cycle-42",
        });
      }

      if (url === "https://api.prod.whoop.com/developer/v2/cycle/cycle-42/recovery") {
        return createJsonResponse({
          id: "recovery-42",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await provider.jobExecutor.executeJob(
    {
      account: createAccount(["offline", "read:sleep", "read:recovery", "read:cycles"]),
      now: "2026-03-16T10:00:00.000Z",
      logger: {},
      async importSnapshot(snapshot) {
        importedSnapshots.push(snapshot);
        return { ok: true };
      },
      async refreshAccountTokens() {
        return createAccount(["offline", "read:sleep", "read:recovery", "read:cycles"]);
      },
    },
    createJob("resource", {
      resourceType: "sleep",
      resourceId: "sleep-42",
    }),
  );

  assert.deepEqual(importedSnapshots, [
    {
      accountId: "whoop-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      sleeps: [{ id: "sleep-42", cycle_id: "cycle-42" }],
      cycles: [{ id: "cycle-42" }],
      recoveries: [{ id: "recovery-42" }],
    },
  ]);
});
