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
