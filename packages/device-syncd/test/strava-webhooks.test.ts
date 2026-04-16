import { describe, expect, it } from "vitest";

import { createStravaWebhookSubscriptionClient } from "../src/providers/strava-webhooks.ts";

describe("Strava webhook subscription client", () => {
  it("retains an existing matching app-global subscription without recreating it", async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const callbackUrl = "https://murph.example.com/api/device-sync/webhooks/strava";
    const client = createStravaWebhookSubscriptionClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: async (input, init) => {
        const method = init?.method ?? "GET";
        calls.push({
          method,
          url: String(input),
          body: typeof init?.body === "string" ? init.body : undefined,
        });

        if (method === "GET") {
          return new Response(JSON.stringify([
            {
              id: 99,
              callback_url: callbackUrl,
              updated_at: "2026-04-16T00:00:00.000Z",
            },
          ]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        throw new Error(`unexpected ${method} request during retain test`);
      },
    });

    const result = await client.ensure({
      callbackUrl,
      verifyToken: "verify-me",
    });

    expect(result.retained).toMatchObject({
      id: "99",
      callbackUrl,
    });
    expect(result.created).toBeNull();
    expect(result.deleted).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("replaces a stale app-global subscription when the callback URL changes", async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const callbackUrl = "https://murph.example.com/api/device-sync/webhooks/strava";
    const client = createStravaWebhookSubscriptionClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: async (input, init) => {
        const method = init?.method ?? "GET";
        calls.push({
          method,
          url: String(input),
          body: typeof init?.body === "string" ? init.body : undefined,
        });

        if (method === "GET") {
          return new Response(JSON.stringify([
            {
              id: 12,
              callback_url: "https://old.example.com/api/device-sync/webhooks/strava",
              updated_at: "2026-04-15T00:00:00.000Z",
            },
          ]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        if (method === "DELETE") {
          return new Response(null, { status: 204 });
        }

        if (method === "POST") {
          return new Response(JSON.stringify({
            id: 44,
            callback_url: callbackUrl,
            updated_at: "2026-04-16T00:00:00.000Z",
          }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }

        throw new Error(`unexpected ${method} request during replace test`);
      },
    });

    const result = await client.ensure({
      callbackUrl,
      verifyToken: "verify-me",
    });

    expect(result.retained).toBeNull();
    expect(result.deleted).toEqual([
      {
        id: "12",
        callbackUrl: "https://old.example.com/api/device-sync/webhooks/strava",
        createdAt: null,
        updatedAt: "2026-04-15T00:00:00.000Z",
      },
    ]);
    expect(result.created).toMatchObject({
      id: "44",
      callbackUrl,
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "DELETE", "POST"]);
    expect(calls[2]?.body).toContain("callback_url=https%3A%2F%2Fmurph.example.com%2Fapi%2Fdevice-sync%2Fwebhooks%2Fstrava");
  });
});
