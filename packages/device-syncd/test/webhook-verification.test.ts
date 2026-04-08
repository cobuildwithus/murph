import assert from "node:assert/strict";

import { test } from "vitest";

import { createOuraDeviceSyncProvider } from "../src/providers/oura.ts";
import { createDeviceSyncRegistry } from "../src/registry.ts";
import { resolveDeviceSyncWebhookVerificationResponse } from "../src/webhook-verification.ts";

test("device sync webhook verification helper returns ok when the request is not a provider challenge", () => {
  const registry = createDeviceSyncRegistry([
    createOuraDeviceSyncProvider({
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
    }),
  ]);

  const result = resolveDeviceSyncWebhookVerificationResponse({
    provider: "oura",
    registry,
    url: new URL("https://sync.example.test/device-sync/webhooks/oura"),
    verificationToken: "verify-token",
  });

  assert.deepEqual(result, {
    ok: true,
    provider: "oura",
  });
});

test("device sync webhook verification helper returns provider challenges and surfaces provider verification errors", () => {
  const registry = createDeviceSyncRegistry([
    createOuraDeviceSyncProvider({
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
    }),
  ]);

  const challenge = resolveDeviceSyncWebhookVerificationResponse({
    provider: "oura",
    registry,
    url: new URL(
      "https://sync.example.test/device-sync/webhooks/oura?verification_token=verify-token&challenge=random-challenge",
    ),
    verificationToken: "verify-token",
  });

  assert.deepEqual(challenge, {
    challenge: "random-challenge",
  });
  assert.throws(
    () =>
      resolveDeviceSyncWebhookVerificationResponse({
        provider: "oura",
        registry,
        url: new URL(
          "https://sync.example.test/device-sync/webhooks/oura?verification_token=verify-token&challenge=random-challenge",
        ),
        verificationToken: null,
      }),
    /verification requires OURA_WEBHOOK_VERIFICATION_TOKEN/u,
  );
});
