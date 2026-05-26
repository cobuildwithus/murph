import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";

import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

import type { DeviceSyncAccount } from "../src/types.ts";

function createAccount(): DeviceSyncAccount {
  return {
    id: "acct-junction-1",
    provider: "junction",
    externalAccountId: "junction-user-1",
    disconnectGeneration: 0,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    displayName: "Junction",
    status: "active",
    scopes: [],
    accessTokenExpiresAt: null,
    metadata: {},
    connectedAt: "2026-04-01T00:00:00.000Z",
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function createProvider(fetchImpl: typeof fetch) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_junction-test",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    fetchImpl,
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
}

function createJunctionSvixWebhook(input: {
  body: Record<string, unknown>;
  messageId: string;
}): { headers: Headers; rawBody: Buffer } {
  const timestamp = "1775174400";
  const secret = "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${input.messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": input.messageId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    }),
    rawBody,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("Junction webhooks canonicalize resource aliases before category inference", async () => {
  const provider = createProvider(async () => createJsonResponse({}));
  const webhookHandler = provider.webhookHandler;
  assert.ok(webhookHandler);

  const cases = [
    ["daily.data.heart_rate.created", "heartrate", "timeseries"],
    ["daily.data.body_weight.created", "weight", "timeseries"],
    ["daily.data.sleep_cycle.created", "sleep_cycle", "summary"],
    ["daily.data.hypnogram.created", "sleep_cycle", "summary"],
    ["daily.data.calories_active.updated", "calories_active", "timeseries"],
    ["daily.data.distance.updated", "distance", "timeseries"],
  ] as const;

  for (const [eventType, resource, resourceCategory] of cases) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: eventType,
        user_id: "junction-user-1",
        data: {
          id: `${resource}-record-1`,
          source: {
            provider: "garmin",
            type: "watch",
          },
        },
      },
      messageId: `msg_${resource}`,
    });

    const parsed = await webhookHandler.verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });
    const payload = parsed.jobs[0]?.payload;

    assert.equal(parsed.resourceCategory, resourceCategory);
    assert.ok(payload);
    assert.equal(payload.resource, resource);
    assert.equal(payload.resourceCategory, resourceCategory);
  }
});

test("Junction REST diagnostics canonicalize resource aliases before allowlist checks", async () => {
  const seenUrls: string[] = [];
  const provider = createProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.includes("/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    if (
      url.includes("/v2/timeseries/junction-user-1/body_weight/grouped") ||
      url.includes("/v2/timeseries/junction-user-1/calories_active/grouped") ||
      url.includes("/v2/timeseries/junction-user-1/distance/grouped")
    ) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const cases = [
    {
      resource: "body_weight",
      canonicalResource: "weight",
      category: "timeseries",
      path: /\/v2\/timeseries\/junction-user-1\/body_weight\/grouped/u,
    },
    {
      resource: "calories_active",
      canonicalResource: "calories_active",
      category: "timeseries",
      path: /\/v2\/timeseries\/junction-user-1\/calories_active\/grouped/u,
    },
    {
      resource: "distance",
      canonicalResource: "distance",
      category: "timeseries",
      path: /\/v2\/timeseries\/junction-user-1\/distance\/grouped/u,
    },
    {
      resource: "hypnogram",
      canonicalResource: "sleep_cycle",
      category: "summary",
      path: /\/v2\/summary\/sleep_cycle\/junction-user-1/u,
    },
  ] as const;

  for (const { resource, canonicalResource, category, path } of cases) {
    seenUrls.length = 0;
    const result = await probeRest({
      account: createAccount(),
      endpoint: "auto",
      now: "2026-04-03T12:00:00.000Z",
      resource,
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    });
    const request = requireRecord(result.result.request);
    const url = seenUrls[0];

    assert.equal(request.configuredResource, true);
    assert.equal(request.resource, canonicalResource);
    assert.equal(request.resourceCategory, category);
    assert.ok(url);
    assert.match(url, path);
  }
});
