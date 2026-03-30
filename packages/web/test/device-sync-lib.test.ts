import assert from "node:assert/strict";

import { test } from "vitest";

import {
  beginDeviceConnection,
  buildWebReturnTo,
  loadDeviceSyncOverviewFromEnv,
} from "../src/lib/device-sync";

test("loadDeviceSyncOverviewFromEnv returns provider and account state from the local daemon", async () => {
  const authorizationHeaders: string[] = [];
  const cacheModes: Array<RequestCache | null> = [];
  const result = await loadDeviceSyncOverviewFromEnv({
    env: {
      NODE_ENV: "test",
      DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      authorizationHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
      cacheModes.push(init?.cache ?? null);

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
                supportsWebhooks: true,
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
  assert.deepEqual(authorizationHeaders, [
    "Bearer control-token-for-tests",
    "Bearer control-token-for-tests",
  ]);
  assert.deepEqual(cacheModes, ["no-store", "no-store"]);
});

test("beginDeviceConnection posts the return target with control-plane auth", async () => {
  const observedRequests: Array<{
    url: string;
    method: string | null;
    cache: RequestCache | null;
    authorization: string | null;
    contentType: string | null;
    body: string;
  }> = [];

  const result = await beginDeviceConnection({
    provider: "whoop",
    returnTo: "http://127.0.0.1:3000/settings/devices",
    env: {
      NODE_ENV: "test",
      DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    },
    fetchImpl: async (input, init) => {
      const requestHeaders = new Headers(init?.headers);
      observedRequests.push({
        url: String(input),
        method: init?.method ?? null,
        cache: init?.cache ?? null,
        authorization: requestHeaders.get("Authorization"),
        contentType: requestHeaders.get("Content-Type"),
        body: typeof init?.body === "string" ? init.body : "",
      });

      return new Response(
        JSON.stringify({
          provider: "whoop",
          state: "state_01",
          expiresAt: "2026-03-17T13:00:00.000Z",
          authorizationUrl: "https://whoop.test/oauth?state=state_01",
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(result.provider, "whoop");
  assert.equal(result.authorizationUrl, "https://whoop.test/oauth?state=state_01");
  assert.deepEqual(observedRequests, [
    {
      url: "http://localhost:8788/providers/whoop/connect",
      method: "POST",
      cache: "no-store",
      authorization: "Bearer control-token-for-tests",
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        returnTo: "http://127.0.0.1:3000/settings/devices",
      }),
    },
  ]);
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
  assert.match(result.suggestedCommand, /device daemon start/u);
});

test("loadDeviceSyncOverviewFromEnv explains missing control-plane auth", async () => {
  const result = await loadDeviceSyncOverviewFromEnv({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "CONTROL_PLANE_AUTH_REQUIRED",
            message: "Device sync control routes require a valid bearer token.",
          },
        }),
        { status: 401 },
      ),
  });

  assert.equal(result.status, "unavailable");
  if (result.status !== "unavailable") {
    return;
  }

  assert.match(result.message, /authentication failed/u);
  assert.match(result.hint, /DEVICE_SYNC_CONTROL_TOKEN/u);
  assert.match(result.suggestedCommand, /pnpm web:dev/u);
});

test("loadDeviceSyncOverviewFromEnv reports remote base URLs as unsupported when a control bearer is configured", async () => {
  const result = await loadDeviceSyncOverviewFromEnv({
    env: {
      NODE_ENV: "test",
      DEVICE_SYNC_BASE_URL: "https://device-sync.example.test",
      DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    },
  });

  assert.equal(result.status, "unavailable");
  if (result.status !== "unavailable") {
    return;
  }

  assert.match(result.message, /restricted to localhost/u);
  assert.match(result.hint, /DEVICE_SYNC_BASE_URL/u);
  assert.match(result.suggestedCommand, /127\.0\.0\.1:8788/u);
});

test("buildWebReturnTo keeps relative paths on the current origin", () => {
  const result = buildWebReturnTo(
    new URL("http://127.0.0.1:3000/devices/connect/whoop?returnTo=/settings/devices"),
  );

  assert.equal(result, "http://127.0.0.1:3000/settings/devices");
});

test("buildWebReturnTo falls back to root for invalid returnTo values", () => {
  assert.equal(
    buildWebReturnTo(
      new URL(
        "http://127.0.0.1:3000/devices/connect/whoop?returnTo=https://example.com/settings",
      ),
    ),
    "http://127.0.0.1:3000/",
  );
  assert.equal(
    buildWebReturnTo(
      new URL("http://127.0.0.1:3000/devices/connect/whoop?returnTo=settings"),
    ),
    "http://127.0.0.1:3000/",
  );
  assert.equal(
    buildWebReturnTo(
      new URL("http://127.0.0.1:3000/devices/connect/whoop?returnTo=//evil.test/settings"),
    ),
    "http://127.0.0.1:3000/",
  );
  assert.equal(
    buildWebReturnTo(
      new URL("http://127.0.0.1:3000/devices/connect/whoop?returnTo=/%5Cevil.test"),
    ),
    "http://127.0.0.1:3000/",
  );
  assert.equal(
    buildWebReturnTo(
      new URL("http://127.0.0.1:3000/devices/connect/whoop?returnTo=%2Fsettings%0Asteal"),
    ),
    "http://127.0.0.1:3000/",
  );
});
