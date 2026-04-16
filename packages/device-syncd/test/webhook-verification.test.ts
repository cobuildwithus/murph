import assert from "node:assert/strict";

import { test } from "vitest";

import { createOuraDeviceSyncProvider } from "../src/providers/oura.ts";
import { createDeviceSyncRegistry } from "../src/registry.ts";
import { resolveDeviceSyncWebhookPreflightResponse } from "../src/webhook-verification.ts";

test("device sync webhook preflight helper returns null when the request is not a provider challenge", async () => {
  const registry = createDeviceSyncRegistry([
    createOuraDeviceSyncProvider({
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      webhookVerificationToken: "verify-token",
    }),
  ]);

  const result = await resolveDeviceSyncWebhookPreflightResponse({
    provider: "oura",
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

  const providerWithoutWebhook = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    webhookVerificationToken: "verify-token",
  });
  providerWithoutWebhook.descriptor = {
    ...providerWithoutWebhook.descriptor,
    webhook: undefined,
  };

  await assert.rejects(
    () =>
      resolveDeviceSyncWebhookPreflightResponse({
        provider: "oura",
        registry: createDeviceSyncRegistry([providerWithoutWebhook]),
        method: "GET",
        url: new URL("https://sync.example.test/device-sync/webhooks/oura"),
        headers: new Headers(),
        rawBody: Buffer.alloc(0),
      }),
    /does not accept webhooks/u,
  );
});

test("device sync webhook preflight helper returns provider challenges and surfaces provider verification errors", async () => {
  const registry = createDeviceSyncRegistry([
    createOuraDeviceSyncProvider({
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      webhookVerificationToken: "verify-token",
    }),
  ]);

  const challenge = await resolveDeviceSyncWebhookPreflightResponse({
    provider: "oura",
    registry,
    method: "GET",
    url: new URL(
      "https://sync.example.test/device-sync/webhooks/oura?verification_token=verify-token&challenge=random-challenge",
    ),
    headers: new Headers(),
    rawBody: Buffer.alloc(0),
  });

  assert.deepEqual(challenge, {
    status: 200,
    body: {
      challenge: "random-challenge",
    },
  });
  await assert.rejects(
    () =>
      resolveDeviceSyncWebhookPreflightResponse({
        provider: "oura",
        registry: createDeviceSyncRegistry([
          createOuraDeviceSyncProvider({
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
          }),
        ]),
        method: "GET",
        url: new URL(
          "https://sync.example.test/device-sync/webhooks/oura?verification_token=verify-token&challenge=random-challenge",
        ),
        headers: new Headers(),
        rawBody: Buffer.alloc(0),
      }),
    /verification requires OURA_WEBHOOK_VERIFICATION_TOKEN/u,
  );
});

test("device sync webhook preflight helper passes generic request context through to the provider-owned handler", async () => {
  const provider = createOuraDeviceSyncProvider({
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    webhookVerificationToken: "verify-token",
  });
  let seenMethod: string | null = null;
  let seenPathname: string | null = null;
  let seenHeader: string | null = null;
  let seenBody = "";
  provider.webhookAdmin!.handleWebhookPreflight = async ({ method, url, headers, rawBody }) => {
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
  };

  const result = await resolveDeviceSyncWebhookPreflightResponse({
    provider: "oura",
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
