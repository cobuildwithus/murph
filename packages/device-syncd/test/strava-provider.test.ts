import { describe, expect, it, vi } from "vitest";

import { createStravaDeviceSyncProvider } from "../src/providers/strava.ts";

describe("Strava device-sync provider", () => {
  it("builds an OAuth connect URL with comma-delimited scopes", () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      scopes: ["activity:read", "activity:read_all"],
    });
    const connectUrl = new URL(
      provider.buildConnectUrl({
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
    const createScheduledJobs = provider.createScheduledJobs;

    expect(createScheduledJobs).toBeTypeOf("function");

    if (!createScheduledJobs) {
      throw new TypeError("Strava provider must define createScheduledJobs.");
    }

    const schedule = createScheduledJobs({
      id: "connection-1",
      provider: "strava",
      externalAccountId: "12345",
      displayName: "Runner",
      status: "active",
      scopes: ["activity:read"],
      metadata: {},
      connectedAt: "2026-04-16T00:00:00.000Z",
      lastWebhookAt: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-04-16T06:00:00.000Z",
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      accessTokenExpiresAt: null,
      disconnectGeneration: 0,
      accessTokenEncrypted: "ciphertext",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: null,
      refreshTokenEncrypted: "refresh-ciphertext",
    }, "2026-04-16T06:00:00.000Z");

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

    const result = await provider.exchangeAuthorizationCode(
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
      displayName: "Runner One",
      scopes: ["activity:read", "read"],
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
    });
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

  it("parses Strava activity webhook events into resource or delete jobs", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
    });

    const createResult = await provider.verifyAndParseWebhook?.({
      headers: new Headers(),
      rawBody: Buffer.from(JSON.stringify({
        aspect_type: "create",
        event_time: 1_776_297_600,
        object_id: 987654321,
        object_type: "activity",
        owner_id: 12345,
        subscription_id: 444,
      })),
      now: "2026-04-16T00:00:00.000Z",
    });

    expect(createResult?.externalAccountId).toBe("12345");
    expect(createResult?.eventType).toBe("activity.create");
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

    const deleteResult = await provider.verifyAndParseWebhook?.({
      headers: new Headers(),
      rawBody: Buffer.from(JSON.stringify({
        aspect_type: "delete",
        event_time: 1_776_297_600,
        object_id: 987654321,
        object_type: "activity",
        owner_id: 12345,
        subscription_id: 444,
      })),
      now: "2026-04-16T00:00:00.000Z",
    });

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

  it("treats Strava athlete authorization revocation as a deauthorize job", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
    });

    const result = await provider.verifyAndParseWebhook?.({
      headers: new Headers(),
      rawBody: Buffer.from(JSON.stringify({
        aspect_type: "update",
        event_time: 1_776_297_600,
        object_id: 12345,
        object_type: "athlete",
        owner_id: 12345,
        subscription_id: 444,
        updates: {
          authorized: "false",
        },
      })),
      now: "2026-04-16T00:00:00.000Z",
    });

    expect(result).toMatchObject({
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

  it("disconnects Strava accounts when deauthorization jobs execute", async () => {
    const provider = createStravaDeviceSyncProvider({
      clientId: "12345",
      clientSecret: "secret",
    });
    const disconnectAccount = vi.fn(async () => undefined);

    await expect(
      provider.executeJob(
        {
          account: {
            id: "connection-1",
            provider: "strava",
            externalAccountId: "123456",
            status: "active",
            accessToken: "token",
            refreshToken: "refresh",
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-16T00:00:00.000Z",
            disconnectGeneration: 0,
            displayName: "Runner",
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
          },
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
      provider.executeJob(
        {
          account: {
            id: "connection-1",
            provider: "strava",
            externalAccountId: "123456",
            status: "active",
            accessToken: "token",
            refreshToken: "refresh",
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-16T00:00:00.000Z",
            disconnectGeneration: 0,
            displayName: "Runner",
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
          },
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
});
