import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildWebReturnTo,
  loadDeviceSyncOverviewFromEnv,
} from "../src/lib/device-sync";

test("loadDeviceSyncOverviewFromEnv returns provider and account state from the local daemon", async () => {
  const result = await loadDeviceSyncOverviewFromEnv({
    fetchImpl: async (input) => {
      const url = String(input);

      if (url.endsWith("/providers")) {
        return new Response(
          JSON.stringify({
            providers: [
              {
                provider: "whoop",
                callbackPath: "/oauth/whoop/callback",
                callbackUrl: "http://127.0.0.1:8788/oauth/whoop/callback",
                webhookPath: "/webhooks/whoop",
                webhookUrl: "http://127.0.0.1:8788/webhooks/whoop",
                defaultScopes: ["offline", "read:profile", "read:sleep"],
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            accounts: [
              {
                id: "acct_whoop_01",
                provider: "whoop",
                externalAccountId: "whoop-user-1",
                displayName: "WHOOP Tester",
                status: "active",
                scopes: ["offline", "read:profile", "read:sleep"],
                metadata: {},
                connectedAt: "2026-03-17T12:00:00.000Z",
                lastWebhookAt: null,
                lastSyncStartedAt: null,
                lastSyncCompletedAt: null,
                lastSyncErrorAt: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                nextReconcileAt: null,
                createdAt: "2026-03-17T12:00:00.000Z",
                updatedAt: "2026-03-17T12:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") {
    return;
  }

  assert.equal(result.providers[0]?.provider, "whoop");
  assert.equal(result.accounts[0]?.id, "acct_whoop_01");
});

test("loadDeviceSyncOverviewFromEnv returns an unavailable summary when the daemon is offline", async () => {
  const result = await loadDeviceSyncOverviewFromEnv({
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  assert.equal(result.status, "unavailable");
  if (result.status !== "unavailable") {
    return;
  }

  assert.match(result.message, /offline/u);
  assert.match(result.suggestedCommand, /device-syncd/u);
});

test("buildWebReturnTo keeps relative paths on the current origin", () => {
  const result = buildWebReturnTo(
    new URL("http://127.0.0.1:3000/devices/connect/whoop?returnTo=/settings/devices"),
  );

  assert.equal(result, "http://127.0.0.1:3000/settings/devices");
});
