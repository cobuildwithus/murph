import assert from "node:assert/strict";

import { test } from "vitest";

import { createOuraWebhookSubscriptionClient } from "../src/providers/oura-webhooks.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

test("Oura webhook subscription ensure creates missing subscriptions with client credential headers", async () => {
  const requests: Array<{ url: string; method: string; headers: HeadersInit | undefined; body: string | null }> = [];
  let nextId = 0;
  const client = createOuraWebhookSubscriptionClient({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = resolveUrl(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : null;
      requests.push({
        url,
        method,
        headers: init?.headers,
        body,
      });

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "GET") {
        return createJsonResponse({ data: [] });
      }

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "POST") {
        nextId += 1;
        const payload = JSON.parse(body ?? "{}");
        return createJsonResponse({
          data: {
            id: `sub-${nextId}`,
            callback_url: payload.callback_url,
            event_type: payload.event_type,
            data_type: payload.data_type,
            expiration_time: "2030-01-01T00:00:00.000Z",
          },
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  const result = await client.ensure({
    callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
    verificationToken: "verify-token-for-tests",
    desired: [
      { eventType: "create", dataType: "daily_sleep" },
      { eventType: "update", dataType: "daily_sleep" },
    ],
  });

  assert.deepEqual(result.retained, []);
  assert.deepEqual(result.renewed, []);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(
    result.created.map((subscription) => ({
      id: subscription.id,
      callbackUrl: subscription.callbackUrl,
      dataType: subscription.dataType,
      eventType: subscription.eventType,
    })),
    [
      {
        id: "sub-1",
        callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
        dataType: "daily_sleep",
        eventType: "create",
      },
      {
        id: "sub-2",
        callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
        dataType: "daily_sleep",
        eventType: "update",
      },
    ],
  );

  assert.equal(requests.length, 3);
  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.url, "https://api.ouraring.com/v2/webhook/subscription");

  for (const request of requests.slice(1)) {
    assert.equal(request.method, "POST");
    assert.equal(readHeader(request.headers, "x-client-id"), "oura-client-id");
    assert.equal(readHeader(request.headers, "x-client-secret"), "oura-client-secret");
    assert.equal(readHeader(request.headers, "content-type"), "application/json");
  }

  assert.deepEqual(
    requests.slice(1).map((request) => JSON.parse(request.body ?? "{}")),
    [
      {
        callback_url: "https://sync.example.test/api/device-sync/webhooks/oura",
        verification_token: "verify-token-for-tests",
        event_type: "create",
        data_type: "daily_sleep",
      },
      {
        callback_url: "https://sync.example.test/api/device-sync/webhooks/oura",
        verification_token: "verify-token-for-tests",
        event_type: "update",
        data_type: "daily_sleep",
      },
    ],
  );
});

test("Oura webhook subscription ensure re-lists after create and prunes stale managed callbacks across origins", async () => {
  const callbackUrl = "https://sync.example.test/api/device-sync/webhooks/oura";
  const otherCallbackUrl = "https://preview.example.test/api/device-sync/webhooks/oura";
  const soon = new Date(Date.now() + 60_000).toISOString();
  const later = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const operations: string[] = [];
  let listCount = 0;
  const client = createOuraWebhookSubscriptionClient({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = resolveUrl(input);
      const method = init?.method ?? "GET";
      operations.push(`${method} ${url}`);

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "GET") {
        listCount += 1;

        return createJsonResponse(
          listCount === 1
            ? {
                data: [
                  {
                    id: "sub-create-a-primary",
                    callback_url: callbackUrl,
                    event_type: "create",
                    data_type: "daily_sleep",
                    expiration_time: soon,
                  },
                  {
                    id: "sub-create-b-duplicate",
                    callback_url: callbackUrl,
                    event_type: "create",
                    data_type: "daily_sleep",
                    expiration_time: soon,
                  },
                  {
                    id: "sub-delete-retained",
                    callback_url: callbackUrl,
                    event_type: "delete",
                    data_type: "daily_sleep",
                    expiration_time: later,
                  },
                  {
                    id: "sub-other-callback",
                    callback_url: otherCallbackUrl,
                    event_type: "update",
                    data_type: "workout",
                    expiration_time: later,
                  },
                ],
              }
            : {
                data: [
                  {
                    id: "sub-create-a-primary",
                    callback_url: callbackUrl,
                    event_type: "create",
                    data_type: "daily_sleep",
                    expiration_time: later,
                  },
                  {
                    id: "sub-create-b-duplicate",
                    callback_url: callbackUrl,
                    event_type: "create",
                    data_type: "daily_sleep",
                    expiration_time: soon,
                  },
                  {
                    id: "sub-delete-retained",
                    callback_url: callbackUrl,
                    event_type: "delete",
                    data_type: "daily_sleep",
                    expiration_time: later,
                  },
                  {
                    id: "sub-update-current",
                    callback_url: callbackUrl,
                    event_type: "update",
                    data_type: "workout",
                    expiration_time: later,
                  },
                  {
                    id: "sub-other-callback",
                    callback_url: otherCallbackUrl,
                    event_type: "update",
                    data_type: "workout",
                    expiration_time: later,
                  },
                ],
              },
        );
      }

      if (url === "https://api.ouraring.com/v2/webhook/subscription/renew/sub-create-a-primary" && method === "PUT") {
        return createJsonResponse({
          data: {
            id: "sub-create-a-primary",
            callback_url: callbackUrl,
            event_type: "create",
            data_type: "daily_sleep",
            expiration_time: later,
          },
        });
      }

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "POST") {
        const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        return createJsonResponse({
          data: {
            id: "sub-update-current",
            callback_url: payload.callback_url,
            event_type: payload.event_type,
            data_type: payload.data_type,
            expiration_time: later,
          },
        });
      }

      if (
        (url === "https://api.ouraring.com/v2/webhook/subscription/sub-create-b-duplicate" ||
          url === "https://api.ouraring.com/v2/webhook/subscription/sub-other-callback") &&
        method === "DELETE"
      ) {
        return new Response(null, {
          status: url.endsWith("/sub-other-callback") ? 404 : 204,
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  const result = await client.ensure({
    callbackUrl,
    verificationToken: "verify-token-for-tests",
    desired: [
      { eventType: "create", dataType: "daily_sleep" },
      { eventType: "delete", dataType: "daily_sleep" },
      { eventType: "update", dataType: "workout" },
    ],
    pruneDuplicates: true,
    renewIfExpiringWithinMs: 7 * 24 * 60 * 60_000,
  });

  assert.deepEqual(
    result.renewed.map((subscription) => subscription.id),
    ["sub-create-a-primary"],
  );
  assert.deepEqual(
    result.retained.map((subscription) => subscription.id),
    ["sub-delete-retained"],
  );
  assert.deepEqual(
    result.created.map((subscription) => subscription.id),
    ["sub-update-current"],
  );
  assert.deepEqual(
    result.deleted.map((subscription) => subscription.id).sort(),
    ["sub-create-b-duplicate", "sub-other-callback"],
  );
  assert.deepEqual(operations, [
    "GET https://api.ouraring.com/v2/webhook/subscription",
    "PUT https://api.ouraring.com/v2/webhook/subscription/renew/sub-create-a-primary",
    "POST https://api.ouraring.com/v2/webhook/subscription",
    "GET https://api.ouraring.com/v2/webhook/subscription",
    "DELETE https://api.ouraring.com/v2/webhook/subscription/sub-create-b-duplicate",
    "DELETE https://api.ouraring.com/v2/webhook/subscription/sub-other-callback",
  ]);
});

test("Oura webhook subscription ensure retains current subscriptions when renewals and duplicate pruning are disabled", async () => {
  const callbackUrl = "https://sync.example.test/api/device-sync/webhooks/oura";
  const requests: string[] = [];
  const retainedExpiration = new Date(Date.now() + 60_000).toISOString();
  const client = createOuraWebhookSubscriptionClient({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = resolveUrl(input);
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url}`);

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "GET") {
        return createJsonResponse({
          data: [
            {
              id: "sub-primary",
              callback_url: callbackUrl,
              event_type: "create",
              data_type: "daily_sleep",
              expiration_time: retainedExpiration,
            },
            {
              id: "sub-duplicate",
              callback_url: callbackUrl,
              event_type: "create",
              data_type: "daily_sleep",
              expiration_time: null,
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  const result = await client.ensure({
    callbackUrl,
    verificationToken: "verify-token-for-tests",
    desired: [{ eventType: "create", dataType: "daily_sleep" }],
    pruneDuplicates: false,
    renewIfExpiringWithinMs: 0,
  });

  assert.deepEqual(result.created, []);
  assert.deepEqual(result.renewed, []);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.retained, [
    {
      id: "sub-primary",
      callbackUrl,
      dataType: "daily_sleep",
      eventType: "create",
      expirationTime: retainedExpiration,
    },
  ]);
  assert.deepEqual(requests, ["GET https://api.ouraring.com/v2/webhook/subscription"]);
});

test("Oura webhook subscription ensure does not prune managed subscriptions on a different callback path", async () => {
  const callbackUrl = "https://sync.example.test/api/device-sync/webhooks/oura";
  const otherPathCallbackUrl = "https://sync.example.test/api/device-sync/webhooks/oura-preview";
  const later = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const operations: string[] = [];
  const client = createOuraWebhookSubscriptionClient({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = resolveUrl(input);
      const method = init?.method ?? "GET";
      operations.push(`${method} ${url}`);

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "GET") {
        return createJsonResponse({
          data: [
            {
              id: "sub-retained-current-path",
              callback_url: callbackUrl,
              event_type: "update",
              data_type: "workout",
              expiration_time: later,
            },
            {
              id: "sub-retained-other-path",
              callback_url: otherPathCallbackUrl,
              event_type: "update",
              data_type: "workout",
              expiration_time: later,
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  const result = await client.ensure({
    callbackUrl,
    verificationToken: "verify-token-for-tests",
    desired: [
      { eventType: "update", dataType: "workout" },
    ],
    pruneDuplicates: true,
    renewIfExpiringWithinMs: 0,
  });

  assert.deepEqual(
    result.retained.map((subscription) => subscription.id),
    ["sub-retained-current-path"],
  );
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.renewed, []);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(operations, [
    "GET https://api.ouraring.com/v2/webhook/subscription",
    "GET https://api.ouraring.com/v2/webhook/subscription",
  ]);
});

test("Oura webhook subscription client normalizes nested list payloads and callback URLs", async () => {
  const client = createOuraWebhookSubscriptionClient({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = resolveUrl(input);
      const method = init?.method ?? "GET";

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "GET") {
        return createJsonResponse({
          data: {
            subscriptions: [
              {
                subscription_id: "sub-1",
                url: "https://sync.example.test/api/device-sync/webhooks/oura#fragment",
                event_type: "UPDATE",
                data_type: "workout",
                expires_at: "2030-01-01T00:00:00.000Z",
              },
            ],
          },
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  assert.deepEqual(await client.list(), [
    {
      id: "sub-1",
      callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
      eventType: "update",
      dataType: "workout",
      expirationTime: "2030-01-01T00:00:00.000Z",
    },
  ]);
});

test("Oura webhook subscription client validates invalid inputs and malformed responses before or after fetch", async () => {
  const client = createOuraWebhookSubscriptionClient({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = resolveUrl(input);
      const method = init?.method ?? "GET";

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "POST") {
        return createJsonResponse({
          data: {
            id: "sub-created",
            callback_url: "https://sync.example.test/api/device-sync/webhooks/oura",
            event_type: "create",
          },
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.create({
        callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
        verificationToken: "   ",
        eventType: "create",
        dataType: "daily_sleep",
      }),
    /create requires callbackUrl, verificationToken, eventType, and dataType/u,
  );
  await assert.rejects(() => client.renew("   "), /requires a subscription id/u);
  await assert.rejects(() => client.delete("   "), /requires a subscription id/u);
  await assert.rejects(
    () =>
      client.ensure({
        callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
        verificationToken: "verify-token-for-tests",
        desired: [
          { eventType: "create", dataType: " " },
        ],
      }),
    /targets require non-empty eventType and dataType values/u,
  );
  await assert.rejects(
    () =>
      client.create({
        callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
        verificationToken: "verify-token-for-tests",
        eventType: "create",
        dataType: "daily_sleep",
      }),
    /missing id, callback_url, event_type, or data_type/u,
  );
});

test("Oura webhook subscription client rejects missing ensure tokens, surfaces delete failures, and prunes stale managed subscriptions", async () => {
  const operations: string[] = [];
  const client = createOuraWebhookSubscriptionClient({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    fetchImpl: async (input, init) => {
      const url = resolveUrl(input);
      const method = init?.method ?? "GET";
      operations.push(`${method} ${url}`);

      if (url === "https://api.ouraring.com/v2/webhook/subscription" && method === "GET") {
        return createJsonResponse({
          data: [
            {
              id: "sub-keep",
              callback_url: "https://sync.example.test/api/device-sync/webhooks/oura",
              event_type: "update",
              data_type: "workout",
              expiration_time: "2030-01-01T00:00:00.000Z",
            },
            {
              id: "sub-stale",
              callback_url: "https://preview.example.test/api/device-sync/webhooks/oura",
              event_type: "delete",
              data_type: "session",
              expiration_time: "2030-01-01T00:00:00.000Z",
            },
          ],
        });
      }

      if (url === "https://api.ouraring.com/v2/webhook/subscription/sub-stale" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (url === "https://api.ouraring.com/v2/webhook/subscription/sub-delete-error" && method === "DELETE") {
        return createJsonResponse({ error: "boom" }, 500);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.ensure({
        callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
        verificationToken: "   ",
        desired: [{ eventType: "update", dataType: "workout" }],
      }),
    /requires a verification token/u,
  );

  const pruned = await client.ensure({
    callbackUrl: "https://sync.example.test/api/device-sync/webhooks/oura",
    verificationToken: "verify-token-for-tests",
    desired: [{ eventType: "update", dataType: "workout" }],
    pruneDuplicates: true,
    renewIfExpiringWithinMs: 0,
  });

  assert.deepEqual(pruned.retained.map((subscription) => subscription.id), ["sub-keep"]);
  assert.deepEqual(pruned.deleted.map((subscription) => subscription.id), ["sub-stale"]);

  await assert.rejects(
    () => client.delete("sub-delete-error"),
    /could not be deleted/u,
  );
  assert.deepEqual(operations, [
    "GET https://api.ouraring.com/v2/webhook/subscription",
    "GET https://api.ouraring.com/v2/webhook/subscription",
    "DELETE https://api.ouraring.com/v2/webhook/subscription/sub-stale",
    "DELETE https://api.ouraring.com/v2/webhook/subscription/sub-delete-error",
  ]);
});
