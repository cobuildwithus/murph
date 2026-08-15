import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createStravaDeviceSyncProvider,
  resolveStravaWebhookPreflightResponse,
  revokeStravaDeviceSyncAccess,
} from "../src/providers/strava.ts";
import { readUrl } from "./helpers.ts";
import type {
  DeviceSyncAccount,
  DeviceSyncJobRecord,
  DeviceSyncOAuthProvider,
  DeviceWebhookHandler,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

const STRAVA_WEBHOOK_SIGNING_SECRET = "strava-webhook-signing-secret";
const STRAVA_WEBHOOK_NOW = "2026-04-16T00:00:00.000Z";
const STRAVA_WEBHOOK_TIMESTAMP = String(Math.floor(Date.parse(STRAVA_WEBHOOK_NOW) / 1000));

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

function buildStravaAccount(overrides: DeviceSyncAccountOverrides = {}): DeviceSyncAccount {
  const {
    accessToken = "token",
    refreshToken = "refresh",
    credential,
    ...accountOverrides
  } = overrides;
  const accessTokenExpiresAt = accountOverrides.accessTokenExpiresAt ?? null;

  return {
    id: "connection-1",
    provider: "strava",
    externalAccountId: "123456",
    status: "active",
    accessTokenExpiresAt: null,
    connectedAt: "2026-04-16T00:00:00.000Z",
    disconnectGeneration: 0,
    displayName: "Strava 123456",
    metadata: {},
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    scopes: ["activity:read"],
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
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

function buildStravaStoredAccount(overrides: StoredDeviceSyncAccountOverrides = {}): StoredDeviceSyncAccount {
  const {
    accessTokenEncrypted = "ciphertext",
    refreshTokenEncrypted = "refresh-ciphertext",
    credential,
    ...accountOverrides
  } = overrides;
  const { credential: _decryptedCredential, ...publicAccount } = buildStravaAccount();

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

function requireStravaOAuthTokens(account: DeviceSyncAccount) {
  if (account.credential.kind !== "oauth_tokens") {
    throw new TypeError("Expected OAuth token account.");
  }

  return account.credential.tokens;
}

function signedStravaWebhookHeaders(
  rawBody: Buffer,
  options: {
    secret?: string;
    timestamp?: string;
  } = {},
): Headers {
  const timestamp = options.timestamp ?? STRAVA_WEBHOOK_TIMESTAMP;
  const signature = createHmac("sha256", options.secret ?? STRAVA_WEBHOOK_SIGNING_SECRET)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]))
    .digest("hex");

  return new Headers({
    "x-strava-signature": `t=${timestamp},v1=${signature}`,
  });
}

function requireStravaWebhookVerifier(
  provider: DeviceSyncOAuthProvider,
): NonNullable<DeviceWebhookHandler["verifyAndParseWebhook"]> {
  const verifyAndParseWebhook = provider.webhookHandler?.verifyAndParseWebhook;
  if (!verifyAndParseWebhook) {
    throw new TypeError("Strava provider must define verifyAndParseWebhook.");
  }

  return verifyAndParseWebhook;
}

function buildStravaJob(kind: string, payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    id: `job-${kind}`,
    accountId: "connection-1",
    provider: "strava",
    kind,
    payload,
    priority: 100,
    attempts: 0,
    maxAttempts: 5,
    availableAt: "2026-04-16T00:00:00.000Z",
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
    status: "queued",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    dedupeKey: null,
    startedAt: null,
    finishedAt: null,
  };
}

describe("Strava device-sync provider", () => {
  it("builds an OAuth connect URL with comma-delimited scopes", () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      scopes: ["activity:read", "activity:read_all"],
    });
    const connectUrl = new URL(
      provider.oauthAdapter.buildConnectUrl({
        state: "state-token",
        callbackUrl: "https://murph.example.com/api/device-sync/oauth/strava/callback",
        scopes: [],
        now: "2026-04-16T00:00:00.000Z",
      }),
    );

    expect(connectUrl.origin).toBe("https://www.strava.com");
    expect(connectUrl.pathname).toBe("/oauth/authorize");
    expect(connectUrl.searchParams.get("approval_prompt")).toBe("auto");
    expect(connectUrl.searchParams.get("scope")).toBe("activity:read,activity:read_all");
  });


  it("schedules reconcile jobs through the shared generic window seam", () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
    });
    const createScheduledJobs = provider.jobExecutor.createScheduledJobs;

    expect(createScheduledJobs).toBeTypeOf("function");

    if (!createScheduledJobs) {
      throw new TypeError("Strava provider must define createScheduledJobs.");
    }

    const schedule = createScheduledJobs(buildStravaStoredAccount({
      externalAccountId: "12345",
      displayName: "Runner",
      nextReconcileAt: "2026-04-16T06:00:00.000Z",
    }), "2026-04-16T06:00:00.000Z");

    expect(schedule.jobs).toEqual([
      expect.objectContaining({
        kind: "reconcile",
        payload: expect.objectContaining({
          windowKind: "reconcile",
          windowEnd: "2026-04-16T06:00:00.000Z",
        }),
      }),
    ]);
  });

  it("exchanges authorization codes with Strava's token contract", async () => {
    const tokenRequests: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const body = init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === "string"
          ? init.body
          : init?.body
            ? String(init.body)
            : "";

      tokenRequests.push({
        url,
        body,
      });

      return new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_at: 1_776_297_600,
          refresh_token: "refresh-token",
          athlete: {
            id: 12345,
            firstname: "Runner",
            lastname: "One",
          },
          scope: "activity:read,read",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });

    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl,
    });

    const result = await provider.oauthAdapter.exchangeAuthorizationCode(
      {
        callbackUrl: "https://murph.example.com/api/device-sync/oauth/strava/callback",
        state: "state-token",
        now: "2026-04-16T00:00:00.000Z",
        grantedScopes: [],
      },
      "authorization-code",
    );

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toEqual({
      url: "https://www.strava.com/oauth/token",
      body: expect.stringContaining("grant_type=authorization_code"),
    });
    expect(tokenRequests[0]?.body).toContain("client_id=strava-client-id");
    expect(tokenRequests[0]?.body).toContain("client_secret=strava-client-secret");
    expect(tokenRequests[0]?.body).toContain("code=authorization-code");
    expect(tokenRequests[0]?.body).not.toContain("redirect_uri=");
    expect(result).toMatchObject({
      externalAccountId: "12345",
      displayName: "Strava 12345",
      scopes: ["activity:read", "read"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
    });
    expect(result.metadata).toBeUndefined();
  });

  it("fetches the athlete profile when the token response omits athlete details", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === "https://www.strava.com/oauth/token") {
        return new Response(JSON.stringify({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url === "https://www.strava.com/api/v3/athlete") {
        return new Response(JSON.stringify({
          id: 54321,
          username: "fallback-runner",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected Strava fetch: ${url}`);
    });

    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl,
    });

    await expect(
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://murph.example.com/api/device-sync/oauth/strava/callback",
          state: "state-token",
          now: "2026-04-16T00:00:00.000Z",
          grantedScopes: ["activity:read_all"],
        },
        "authorization-code",
      ),
    ).resolves.toMatchObject({
      externalAccountId: "54321",
      displayName: "Strava 54321",
      scopes: ["activity:read_all"],
    });
  });

  it("marks refresh-token invalid grants as reauthorization required", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = readUrl(input);

        if (url === "https://www.strava.com/oauth/token") {
          return new Response(JSON.stringify({
            error: "invalid_grant",
            message: "Refresh token expired. Reconnect Strava.",
          }), {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    await expect(
      provider.oauthAdapter.refreshTokens(buildStravaAccount({
        refreshToken: "stored-refresh-token",
      })),
    ).rejects.toMatchObject({
      accountStatus: "reauthorization_required",
      code: "STRAVA_TOKEN_REQUEST_FAILED",
      details: {
        accountStatus: "reauthorization_required",
        oauthErrorCode: "invalid_grant",
        oauthErrorDescription: "Refresh token expired. Reconnect Strava.",
        oauthGrantType: "refresh_token",
        oauthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token",
        requestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token",
        responseErrorCode: "invalid_grant",
        responseErrorDescription: "Refresh token expired. Reconnect Strava.",
        status: 400,
      },
    });
  });

  it("marks an incomplete rotated token generation as provider-state unknown", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = readUrl(input);

        if (url === "https://www.strava.com/oauth/token") {
          return new Response(JSON.stringify({
            access_token: "rotated-access-token",
            expires_in: 3600,
          }), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    await expect(
      provider.oauthAdapter.refreshTokens(buildStravaAccount({
        refreshToken: "stored-refresh-token",
      })),
    ).rejects.toMatchObject({
      accountStatus: null,
      code: "STRAVA_REFRESH_TOKEN_MISSING",
    });
  });

  it("rejects authorization when neither the token response nor the athlete profile provides a stable id", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

        if (url === "https://www.strava.com/oauth/token") {
          return new Response(JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
          }), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        if (url === "https://www.strava.com/api/v3/athlete") {
          return new Response(JSON.stringify({
            username: "fallback-runner",
          }), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    await expect(
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://murph.example.com/api/device-sync/oauth/strava/callback",
          state: "state-token",
          now: "2026-04-16T00:00:00.000Z",
          grantedScopes: ["activity:read_all"],
        },
        "authorization-code",
      ),
    ).rejects.toMatchObject({
      code: "STRAVA_ATHLETE_INVALID",
    });
  });

  it("rejects authorization responses that do not grant an activity scope", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
          athlete: {
            id: 12345,
          },
          scope: "read",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })),
    });

    await expect(
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://murph.example.com/api/device-sync/oauth/strava/callback",
          state: "state-token",
          now: "2026-04-16T00:00:00.000Z",
          grantedScopes: [],
        },
        "authorization-code",
      ),
    ).rejects.toMatchObject({
      code: "STRAVA_ACTIVITY_SCOPE_REQUIRED",
    });
  });

  it("uses token-response scopes as the authority before accepting callback scopes", async () => {
    const requests: string[] = [];
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = readUrl(input);
        requests.push(url);

        if (url === "https://www.strava.com/oauth/token") {
          return new Response(JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
            athlete: {
              id: 12345,
            },
            scope: "read",
          }), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        if (url.startsWith("https://www.strava.com/oauth/deauthorize")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    await expect(
      provider.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: "https://murph.example.com/api/device-sync/oauth/strava/callback",
          state: "state-token-scopes",
          now: "2026-04-16T00:00:00.000Z",
          grantedScopes: ["activity:read_all"],
        },
        "authorization-code",
      ),
    ).rejects.toMatchObject({
      code: "STRAVA_ACTIVITY_SCOPE_REQUIRED",
    });
    expect(requests).toEqual([
      "https://www.strava.com/oauth/token",
      "https://www.strava.com/oauth/deauthorize?access_token=access-token",
    ]);
  });

  it("answers Strava webhook verification challenges through the provider-owned preflight seam", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      webhookVerifyToken: "verify-me",
    });

    const preflight = await provider.webhookAdmin?.handleWebhookPreflight?.({
      method: "GET",
      url: new URL(
        "https://murph.example.com/api/device-sync/webhooks/strava?hub.mode=subscribe&hub.challenge=challenge-value&hub.verify_token=verify-me",
      ),
      headers: new Headers(),
      rawBody: Buffer.alloc(0),
      now: "2026-04-16T00:00:00.000Z",
    });

    expect(preflight).toEqual({
      status: 200,
      body: {
        "hub.challenge": "challenge-value",
      },
    });
  });

  it("covers Strava webhook preflight validation failures and ignored methods", () => {
    expect(
      resolveStravaWebhookPreflightResponse({
        method: "POST",
        url: new URL("https://murph.example.com/api/device-sync/webhooks/strava"),
        verifyToken: "verify-me",
      }),
    ).toBeNull();

    expect(
      resolveStravaWebhookPreflightResponse({
        method: "GET",
        url: new URL("https://murph.example.com/api/device-sync/webhooks/strava"),
        verifyToken: "verify-me",
      }),
    ).toBeNull();

    expect(() =>
      resolveStravaWebhookPreflightResponse({
        method: "GET",
        url: new URL(
          "https://murph.example.com/api/device-sync/webhooks/strava?hub.mode=unsubscribe",
        ),
        verifyToken: "verify-me",
      })
    ).toThrow(/missing hub\.mode=subscribe or hub\.challenge/u);

    expect(() =>
      resolveStravaWebhookPreflightResponse({
        method: "GET",
        url: new URL(
          "https://murph.example.com/api/device-sync/webhooks/strava?hub.mode=subscribe&hub.challenge=challenge-value&hub.verify_token=verify-me",
        ),
        verifyToken: null,
      })
    ).toThrow(/verification token is not configured/u);

    expect(() =>
      resolveStravaWebhookPreflightResponse({
        method: "GET",
        url: new URL(
          "https://murph.example.com/api/device-sync/webhooks/strava?hub.mode=subscribe&hub.challenge=challenge-value&hub.verify_token=wrong",
        ),
        verifyToken: "verify-me",
      })
    ).toThrow(/did not include the configured verify token/u);
  });

  it("rejects Strava webhook events without a valid delivery signature", async () => {
    const rawBody = Buffer.from(JSON.stringify({
      aspect_type: "create",
      event_time: 1_776_297_600,
      object_id: 987654321,
      object_type: "activity",
      owner_id: 12345,
      subscription_id: 444,
    }));
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
      webhookTimestampToleranceMs: 60_000,
    });
    const verifyAndParseWebhook = requireStravaWebhookVerifier(provider);

    await expect(
      verifyAndParseWebhook({
        headers: new Headers(),
        rawBody,
        now: STRAVA_WEBHOOK_NOW,
      }),
    ).rejects.toMatchObject({
      code: "STRAVA_WEBHOOK_SIGNATURE_MISSING",
    });

    await expect(
      verifyAndParseWebhook({
        headers: new Headers({
          "x-strava-signature": `t=${STRAVA_WEBHOOK_TIMESTAMP},v1=${"0".repeat(64)}`,
        }),
        rawBody,
        now: STRAVA_WEBHOOK_NOW,
      }),
    ).rejects.toMatchObject({
      code: "STRAVA_WEBHOOK_SIGNATURE_INVALID",
    });

    await expect(
      verifyAndParseWebhook({
        headers: signedStravaWebhookHeaders(rawBody, {
          timestamp: "1",
        }),
        rawBody,
        now: STRAVA_WEBHOOK_NOW,
      }),
    ).rejects.toMatchObject({
      code: "STRAVA_WEBHOOK_TIMESTAMP_STALE",
    });

    const providerWithoutSecret = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
    });
    const verifyWithoutSecret = requireStravaWebhookVerifier(providerWithoutSecret);

    await expect(
      verifyWithoutSecret({
        headers: signedStravaWebhookHeaders(rawBody),
        rawBody,
        now: STRAVA_WEBHOOK_NOW,
      }),
    ).rejects.toMatchObject({
      code: "STRAVA_WEBHOOK_SIGNING_SECRET_MISSING",
    });
  });

  it("rejects malformed Strava webhook payloads on signature verification before JSON parsing", async () => {
    const rawBody = Buffer.from("{not-json");
    const wrongSignedBody = Buffer.from(JSON.stringify({
      aspect_type: "create",
      event_time: 1_776_297_600,
      object_id: 987654321,
      object_type: "activity",
      owner_id: 12345,
      subscription_id: 444,
    }));
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
      webhookTimestampToleranceMs: 60_000,
    });
    const verifyAndParseWebhook = requireStravaWebhookVerifier(provider);

    await expect(
      verifyAndParseWebhook({
        headers: signedStravaWebhookHeaders(wrongSignedBody),
        rawBody,
        now: STRAVA_WEBHOOK_NOW,
      }),
    ).rejects.toMatchObject({
      code: "STRAVA_WEBHOOK_SIGNATURE_INVALID",
    });
  });

  it("parses Strava activity webhook events into resource or delete jobs", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
    });
    const verifyAndParseWebhook = requireStravaWebhookVerifier(provider);
    const createBody = Buffer.from(JSON.stringify({
      aspect_type: "create",
      event_time: 1_776_297_600,
      object_id: 987654321,
      object_type: "activity",
      owner_id: 12345,
      subscription_id: 444,
    }));

    const createResult = await verifyAndParseWebhook({
      headers: signedStravaWebhookHeaders(createBody),
      rawBody: createBody,
      now: STRAVA_WEBHOOK_NOW,
    });

    expect(createResult?.acceptanceMode).toBe("durable_webhook_work");
    expect(createResult?.externalAccountId).toBe("12345");
    expect(createResult?.eventType).toBe("activity.create");
    expect(createResult?.occurredAt).toBe("2026-04-16T00:00:00.000Z");
    expect(createResult?.providerSentAt).toBe(STRAVA_WEBHOOK_NOW);
    expect(createResult?.jobs).toEqual([
      {
        kind: "resource",
        priority: 90,
        dedupeKey: expect.any(String),
        payload: {
          eventType: "activity.create",
          occurredAt: expect.any(String),
          resourceId: "987654321",
          resourceType: "activity",
        },
      },
    ]);

    const deleteBody = Buffer.from(JSON.stringify({
      aspect_type: "delete",
      event_time: 1_776_297_600,
      object_id: 987654321,
      object_type: "activity",
      owner_id: 12345,
      subscription_id: 444,
    }));
    const deleteResult = await verifyAndParseWebhook({
      headers: signedStravaWebhookHeaders(deleteBody),
      rawBody: deleteBody,
      now: STRAVA_WEBHOOK_NOW,
    });

    expect(deleteResult?.acceptanceMode).toBe("durable_webhook_work");
    expect(deleteResult?.jobs).toEqual([
      {
        kind: "delete",
        priority: 95,
        dedupeKey: expect.any(String),
        payload: {
          eventType: "activity.delete",
          occurredAt: expect.any(String),
          resourceId: "987654321",
          resourceType: "activity",
        },
      },
    ]);
  });

  it("does not invent a top-level event occurrence when Strava omits event_time", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
    });
    const verifyAndParseWebhook = requireStravaWebhookVerifier(provider);
    const rawBody = Buffer.from(JSON.stringify({
      aspect_type: "create",
      object_id: 987654321,
      object_type: "activity",
      owner_id: 12345,
      subscription_id: 444,
    }));

    const result = await verifyAndParseWebhook({
      headers: signedStravaWebhookHeaders(rawBody),
      rawBody,
      now: STRAVA_WEBHOOK_NOW,
    });

    expect(result).not.toHaveProperty("occurredAt");
    expect(result?.jobs[0]?.payload).toMatchObject({
      occurredAt: STRAVA_WEBHOOK_NOW,
    });
  });

  it("does not invent a top-level event occurrence when Strava event_time is malformed", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
    });
    const verifyAndParseWebhook = requireStravaWebhookVerifier(provider);
    const rawBody = Buffer.from(JSON.stringify({
      aspect_type: "create",
      event_time: "not-an-instant",
      object_id: 987654321,
      object_type: "activity",
      owner_id: 12345,
      subscription_id: 444,
    }));

    const result = await verifyAndParseWebhook({
      headers: signedStravaWebhookHeaders(rawBody),
      rawBody,
      now: STRAVA_WEBHOOK_NOW,
    });

    expect(result).not.toHaveProperty("occurredAt");
    expect(result?.jobs[0]?.payload).toMatchObject({
      occurredAt: STRAVA_WEBHOOK_NOW,
    });
  });

  it("treats Strava athlete authorization revocation as a deauthorize job", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
    });
    const verifyAndParseWebhook = requireStravaWebhookVerifier(provider);
    const rawBody = Buffer.from(JSON.stringify({
      aspect_type: "update",
      event_time: 1_776_297_600,
      object_id: 12345,
      object_type: "athlete",
      owner_id: 12345,
      subscription_id: 444,
      updates: {
        authorized: "false",
      },
    }));

    const result = await verifyAndParseWebhook({
      headers: signedStravaWebhookHeaders(rawBody),
      rawBody,
      now: STRAVA_WEBHOOK_NOW,
    });

    expect(result).toMatchObject({
      acceptanceMode: "durable_webhook_work",
      externalAccountId: "12345",
      eventType: "athlete.deauthorized",
      jobs: [
        {
          kind: "deauthorize",
          priority: 100,
          dedupeKey: "deauthorize:12345",
          payload: {
            eventType: "athlete.deauthorized",
            resourceId: "12345",
            resourceType: "athlete",
          },
        },
      ],
    });
  });

  it("invokes the disconnect callback when deauthorization jobs execute", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
    });
    const disconnectAccount = vi.fn(async () => undefined);

    await expect(
      provider.jobExecutor.executeJob(
        {
          account: buildStravaAccount({
            displayName: "Runner",
          }),
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot: async () => undefined,
          refreshAccountTokens: async () => {
            throw new Error("not needed");
          },
          disconnectAccount,
          logger: {},
        },
        {
          id: "job-1",
          accountId: "connection-1",
          provider: "strava",
          kind: "deauthorize",
          payload: {
            eventType: "athlete.deauthorized",
            occurredAt: "2026-04-16T00:00:00.000Z",
            resourceId: "123456",
            resourceType: "athlete",
          },
          priority: 100,
          attempts: 0,
          maxAttempts: 5,
          availableAt: "2026-04-16T00:00:00.000Z",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          dedupeKey: null,
          startedAt: null,
          finishedAt: null,
        },
      ),
    ).resolves.toEqual({});

    expect(disconnectAccount).toHaveBeenCalledTimes(1);
  });

  it("does not emit delete imports when a resource webhook fetch returns 404", async () => {
    const importSnapshot = vi.fn(async () => undefined);
    const provider = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

        if (url.endsWith("/activities/987654321")) {
          return new Response("", { status: 404 });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    await expect(
      provider.jobExecutor.executeJob(
        {
          account: buildStravaAccount({
            displayName: "Runner",
          }),
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot,
          refreshAccountTokens: async () => {
            throw new Error("not needed");
          },
          logger: {},
        },
        {
          id: "job-1",
          accountId: "connection-1",
          provider: "strava",
          kind: "resource",
          payload: {
            eventType: "activity.create",
            occurredAt: "2026-04-16T00:00:00.000Z",
            resourceId: "987654321",
            resourceType: "activity",
          },
          priority: 90,
          attempts: 0,
          maxAttempts: 5,
          availableAt: "2026-04-16T00:00:00.000Z",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          dedupeKey: null,
          startedAt: null,
          finishedAt: null,
        },
      ),
    ).resolves.toEqual({});

    expect(importSnapshot).not.toHaveBeenCalled();
  });

  it("executes backfill imports, refreshes tokens, and ignores non-activity resource jobs", async () => {
    const importSnapshot = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === "https://www.strava.com/oauth/token") {
        return new Response(JSON.stringify({
          access_token: "next-access-token",
          expires_at: 1_776_297_600,
          refresh_token: "next-refresh-token",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url === "https://www.strava.com/api/v3/athlete") {
        return new Response(JSON.stringify({
          id: 123456,
          username: "runner",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url.startsWith("https://www.strava.com/api/v3/athlete/activities?")) {
        return new Response(JSON.stringify([
          {
            id: 987654321,
            name: "Morning Run",
            sport_type: "Run",
            start_date: "2026-04-15T06:00:00.000Z",
            updated_at: "2026-04-15T06:31:00.000Z",
            elapsed_time: 1800,
            distance: 5000,
          },
        ]), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected Strava fetch: ${url}`);
    });

    const provider = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      fetchImpl,
    });

    const expiringAccount = buildStravaAccount({
      accessTokenExpiresAt: "2026-04-16T00:05:00.000Z",
    });

    const refreshAccountTokens = vi.fn(async () => {
      const refreshed = await provider.oauthAdapter.refreshTokens(expiringAccount);
      return buildStravaAccount({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? requireStravaOAuthTokens(expiringAccount).refreshToken,
        accessTokenExpiresAt:
          refreshed.accessTokenExpiresAt ?? expiringAccount.accessTokenExpiresAt,
      });
    });

    await expect(
      provider.jobExecutor.executeJob(
        {
          account: expiringAccount,
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot,
          refreshAccountTokens,
          logger: {},
        },
        {
          id: "job-1",
          accountId: "connection-1",
          provider: "strava",
          kind: "backfill",
          payload: {
            includeAthlete: true,
            windowKind: "backfill",
            windowStart: "2026-04-10T00:00:00.000Z",
            windowEnd: "2026-04-16T00:00:00.000Z",
          },
          priority: 100,
          attempts: 0,
          maxAttempts: 5,
          availableAt: "2026-04-16T00:00:00.000Z",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          dedupeKey: null,
          startedAt: null,
          finishedAt: null,
        },
      ),
    ).resolves.toEqual({});
    expect(refreshAccountTokens).toHaveBeenCalled();

    expect(importSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        athlete: expect.objectContaining({
          id: 123456,
          username: "runner",
        }),
        activities: [expect.objectContaining({ id: 987654321 })],
      }),
    );
    importSnapshot.mockClear();

    await expect(
      provider.jobExecutor.executeJob(
        {
          account: buildStravaAccount(),
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot,
          refreshAccountTokens: async () => {
            throw new Error("not needed");
          },
          logger: {},
        },
        {
          id: "job-2",
          accountId: "connection-1",
          provider: "strava",
          kind: "resource",
          payload: {
            eventType: "athlete.update",
            occurredAt: "2026-04-16T00:00:00.000Z",
            resourceId: "123456",
            resourceType: "athlete",
          },
          priority: 90,
          attempts: 0,
          maxAttempts: 5,
          availableAt: "2026-04-16T00:00:00.000Z",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          dedupeKey: null,
          startedAt: null,
          finishedAt: null,
        },
      ),
    ).resolves.toEqual({});
    expect(importSnapshot).not.toHaveBeenCalled();
  });

  it("rejects Strava activity pagination that exceeds page or record caps", async () => {
    const fullActivityPage = Array.from({ length: 200 }, (_, index) => ({
      id: `activity-${index}`,
    }));
    const providerWithEndlessPages = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = readUrl(input);

        if (url.startsWith("https://www.strava.com/api/v3/athlete/activities?")) {
          return new Response(JSON.stringify(fullActivityPage), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    await expect(
      providerWithEndlessPages.jobExecutor.executeJob(
        {
          account: buildStravaAccount(),
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot: vi.fn(async () => undefined),
          refreshAccountTokens: async () => {
            throw new Error("not needed");
          },
          logger: {},
        },
        buildStravaJob("backfill", {
          windowStart: "2026-04-10T00:00:00.000Z",
          windowEnd: "2026-04-16T00:00:00.000Z",
        }),
      ),
    ).rejects.toMatchObject({
      code: "STRAVA_ACTIVITY_PAGINATION_LIMIT_EXCEEDED",
      retryable: true,
    });

    const oversizedActivityPage = Array.from({ length: 25_001 }, (_, index) => ({
      id: `activity-${index}`,
    }));
    const providerWithOversizedPage = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = readUrl(input);

        if (url.startsWith("https://www.strava.com/api/v3/athlete/activities?")) {
          return new Response(JSON.stringify(oversizedActivityPage), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    await expect(
      providerWithOversizedPage.jobExecutor.executeJob(
        {
          account: buildStravaAccount(),
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot: vi.fn(async () => undefined),
          refreshAccountTokens: async () => {
            throw new Error("not needed");
          },
          logger: {},
        },
        buildStravaJob("backfill", {
          windowStart: "2026-04-10T00:00:00.000Z",
          windowEnd: "2026-04-16T00:00:00.000Z",
        }),
      ),
    ).rejects.toMatchObject({
      code: "STRAVA_ACTIVITY_RECORD_LIMIT_EXCEEDED",
      retryable: true,
    });
  });

  it("ensures Strava webhook subscriptions only when a verify token is configured and tolerates benign deauthorization responses", async () => {
    const calls: Array<{ body?: string; method: string }> = [];
    const providerWithoutToken = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      fetchImpl: vi.fn(async () => {
        throw new Error("should not run without a verify token");
      }),
    });

    await expect(
      providerWithoutToken.webhookAdmin?.ensureSubscriptions?.({
        publicBaseUrl: "https://murph.example.com",
      }),
    ).resolves.toBeUndefined();

    const providerWithToken = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      webhookVerifyToken: "verify-me",
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({
          method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });

        if (method === "GET") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        if (method === "POST") {
          return new Response(JSON.stringify({
            id: 77,
            callback_url: "https://murph.example.com/webhooks/strava",
          }), {
            status: 201,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch method: ${method}`);
      }),
    });

    await expect(
      providerWithToken.webhookAdmin?.ensureSubscriptions?.({
        publicBaseUrl: "https://murph.example.com",
      }),
    ).resolves.toBeUndefined();
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(calls[1]?.body).toContain(
      "callback_url=https%3A%2F%2Fmurph.example.com%2Fwebhooks%2Fstrava",
    );

    const revokeAccess = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      fetchImpl: vi.fn(async () => new Response("", { status: 404 })),
    }).connectionHandler.revokeAccess;

    if (!revokeAccess) {
      throw new TypeError("Strava provider must define revokeAccess.");
    }

    await expect(
      revokeAccess(buildStravaAccount()),
    ).resolves.toBeUndefined();
  });

  it("revokes stored Strava access without client credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));

    await revokeStravaDeviceSyncAccess(buildStravaAccount({
      accessToken: "cleanup-access-token",
    }), {
      authBaseUrl: "https://strava.example.test",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://strava.example.test/oauth/deauthorize?access_token=cleanup-access-token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("imports delete jobs, validates malformed jobs and webhook payloads, and handles deauthorize edge cases", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
      webhookSigningSecret: STRAVA_WEBHOOK_SIGNING_SECRET,
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

        if (url.startsWith("https://www.strava.com/oauth/deauthorize")) {
          return new Response(JSON.stringify({ message: "boom" }), {
            status: 500,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`Unexpected Strava fetch: ${url}`);
      }),
    });

    const importSnapshot = vi.fn(async () => undefined);
    const revokeAccess = provider.connectionHandler.revokeAccess;

    if (!revokeAccess) {
      throw new TypeError("Strava provider must define revokeAccess.");
    }

    await expect(
      provider.jobExecutor.executeJob(
        {
          account: buildStravaAccount(),
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot,
          refreshAccountTokens: async () => {
            throw new Error("not needed");
          },
          logger: {},
        },
        {
          id: "job-1",
          accountId: "connection-1",
          provider: "strava",
          kind: "delete",
          payload: {
            resourceId: "activity-123",
          },
          priority: 95,
          attempts: 0,
          maxAttempts: 5,
          availableAt: "2026-04-16T00:00:00.000Z",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          dedupeKey: null,
          startedAt: null,
          finishedAt: null,
        },
      ),
    ).resolves.toEqual({});

    expect(importSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        deletions: [
          expect.objectContaining({
            resource_id: "activity-123",
            resource_type: "activity",
            source_event_type: "strava:activity:delete",
          }),
        ],
      }),
    );

    await expect(
      provider.jobExecutor.executeJob(
        {
          account: buildStravaAccount(),
          now: "2026-04-16T00:00:00.000Z",
          importSnapshot,
          refreshAccountTokens: async () => {
            throw new Error("not needed");
          },
          logger: {},
        },
        {
          id: "job-2",
          accountId: "connection-1",
          provider: "strava",
          kind: "delete",
          payload: {},
          priority: 95,
          attempts: 0,
          maxAttempts: 5,
          availableAt: "2026-04-16T00:00:00.000Z",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          dedupeKey: null,
          startedAt: null,
          finishedAt: null,
        },
      ),
    ).rejects.toMatchObject({
      code: "STRAVA_DELETE_JOB_INVALID",
    });

    const invalidJsonBody = Buffer.from("{not-json");
    const verifyAndParseWebhook = requireStravaWebhookVerifier(provider);

    await expect(
      verifyAndParseWebhook({
        headers: signedStravaWebhookHeaders(invalidJsonBody),
        rawBody: invalidJsonBody,
        now: STRAVA_WEBHOOK_NOW,
      }),
    ).rejects.toMatchObject({
      code: "STRAVA_WEBHOOK_JSON_INVALID",
    });

    const athleteUpdateBody = Buffer.from(JSON.stringify({
      aspect_type: "update",
      object_type: "athlete",
      owner_id: 12345,
      object_id: 12345,
      updates: {
        authorized: true,
      },
    }));

    await expect(
      verifyAndParseWebhook({
        headers: signedStravaWebhookHeaders(athleteUpdateBody),
        rawBody: athleteUpdateBody,
        now: STRAVA_WEBHOOK_NOW,
      }),
    ).resolves.toMatchObject({
      eventType: "athlete.update",
      jobs: [],
    });

    await expect(
      revokeAccess(buildStravaAccount()),
    ).rejects.toMatchObject({
      code: "STRAVA_DEAUTHORIZE_FAILED",
    });
  });
});
