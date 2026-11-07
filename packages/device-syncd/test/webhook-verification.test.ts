import assert from "node:assert/strict";

import { test } from "vitest";

import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createDeviceSyncRegistry } from "../src/registry.ts";
import { resolveDeviceSyncWebhookPreflightResponse } from "../src/webhook-verification.ts";

test("device sync webhook preflight helper returns null when the request is not a provider challenge", async () => {
  const registry = createDeviceSyncRegistry([
    createJunctionDeviceSyncProvider({
      apiKey: "sk_us_test", clientUserIdSecret: "synthetic-junction-secret", environment: "sandbox", region: "us",
    }),
  ]);

  const result = await resolveDeviceSyncWebhookPreflightResponse({
    provider: "junction",
    registry,
    method: "GET",
    url: new URL("https://sync.example.test/device-sync/webhooks/oura"),
    headers: new Headers(),
    rawBody: Buffer.alloc(0),
  });

  assert.equal(result, null);
});

test("device sync webhook preflight helper rejects unknown providers and providers without webhooks", async () => {
  await assert.rejects(
    () =>
      resolveDeviceSyncWebhookPreflightResponse({
        provider: "missing",
        registry: createDeviceSyncRegistry([]),
        method: "GET",
        url: new URL("https://sync.example.test/device-sync/webhooks/missing"),
        headers: new Headers(),
        rawBody: Buffer.alloc(0),
      }),
    /not registered/u,
  );

  const providerWithoutWebhook = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test", clientUserIdSecret: "synthetic-junction-secret", environment: "sandbox", region: "us",
  });
  providerWithoutWebhook.descriptor = {
    ...providerWithoutWebhook.descriptor,
    webhook: undefined,
  };

  await assert.rejects(
    () =>
      resolveDeviceSyncWebhookPreflightResponse({
        provider: "junction",
        registry: createDeviceSyncRegistry([providerWithoutWebhook]),
        method: "GET",
        url: new URL("https://sync.example.test/device-sync/webhooks/oura"),
        headers: new Headers(),
        rawBody: Buffer.alloc(0),
      }),
    /does not accept webhooks/u,
  );
});

test("device sync webhook preflight helper passes generic request context through to the provider-owned handler", async () => {
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test", clientUserIdSecret: "synthetic-junction-secret", environment: "sandbox", region: "us",
  });
  let seenMethod: string | null = null;
  let seenPathname: string | null = null;
  let seenHeader: string | null = null;
  let seenBody = "";
  provider.webhookAdmin = { handleWebhookPreflight: async ({ method, url, headers, rawBody }) => {
    seenMethod = method;
    seenPathname = url.pathname;
    seenHeader = headers.get("x-provider-preflight");
    seenBody = rawBody.toString("utf8");

    return {
      status: 202,
      body: {
        ok: true,
      },
      headers: {
        "x-preflight-provider": "oura",
      },
    };
  } };

  const result = await resolveDeviceSyncWebhookPreflightResponse({
    provider: "junction",
    registry: createDeviceSyncRegistry([provider]),
    method: "POST",
    url: new URL("https://sync.example.test/device-sync/webhooks/oura"),
    headers: new Headers({
      "x-provider-preflight": "trace-123",
    }),
    rawBody: Buffer.from('{"event":"sleep.updated"}', "utf8"),
    now: "2026-03-16T10:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: 202,
    body: {
      ok: true,
    },
    headers: {
      "x-preflight-provider": "oura",
    },
  });
  assert.equal(seenMethod, "POST");
  assert.equal(seenPathname, "/device-sync/webhooks/oura");
  assert.equal(seenHeader, "trace-123");
  assert.equal(seenBody, '{"event":"sleep.updated"}');
});
