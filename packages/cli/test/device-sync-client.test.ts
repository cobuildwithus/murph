import assert from "node:assert/strict";

import { test } from "vitest";

import { createDeviceSyncClient } from "@murphai/operator-config/device-sync-client";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

test("createDeviceSyncClient sends bearer auth to control-plane routes", async () => {
  const observedAuthHeaders: string[] = [];
  const client = createDeviceSyncClient({
    baseUrl: "http://127.0.0.1:8788",
    controlToken: "control-token-for-tests",
    fetchImpl: async (_input, init) => {
      observedAuthHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");

      return new Response(
        JSON.stringify({
          accounts: [],
        }),
        { status: 200 },
      );
    },
  });

  assert.deepEqual(await client.listAccounts(), {
    accounts: [],
  });
  assert.deepEqual(observedAuthHeaders, [
    "Bearer control-token-for-tests",
  ]);
});

test("createDeviceSyncClient forwards owner and source provider for connection starts", async () => {
  let observedPath: string | null = null;
  let observedBody: unknown = null;
  const client = createDeviceSyncClient({
    baseUrl: "http://127.0.0.1:8788",
    fetchImpl: async (input, init) => {
      observedPath = String(input);
      observedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}");

      return new Response(
        JSON.stringify({
          provider: "junction",
          state: "state_01",
          expiresAt: "2026-04-23T12:00:00.000Z",
          authorizationUrl: "https://junction.test/link",
        }),
        { status: 200 },
      );
    },
  });

  await client.beginConnection({
    provider: "junction",
    returnTo: "/connected",
    ownerId: "capture-owner-test",
    sourceProviderSlug: "whoop_v2",
  });

  assert.equal(observedPath, "http://127.0.0.1:8788/providers/junction/connect");
  assert.deepEqual(observedBody, {
    returnTo: "/connected",
    ownerId: "capture-owner-test",
    sourceProviderSlug: "whoop_v2",
  });
});

test("createDeviceSyncClient explains missing control-plane auth", async () => {
  const client = createDeviceSyncClient({
    baseUrl: "http://127.0.0.1:8788",
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

  await assert.rejects(
    () => client.listProviders(),
    (error) =>
      error instanceof VaultCliError &&
      error.code === "CONTROL_PLANE_AUTH_REQUIRED" &&
      /DEVICE_SYNC_CONTROL_TOKEN/u.test(error.message),
  );
});

test("createDeviceSyncClient surfaces invalid JSON responses from the daemon", async () => {
  const client = createDeviceSyncClient({
    baseUrl: "http://127.0.0.1:8788",
    fetchImpl: async () => new Response("[]", { status: 200 }),
  });

  await assert.rejects(
    () => client.listProviders(),
    (error) =>
      error instanceof VaultCliError &&
      error.code === "device_sync_invalid_response" &&
      /invalid JSON payload/u.test(error.message) &&
      error.context?.baseUrl === "http://127.0.0.1:8788" &&
      error.context?.path === "/providers",
  );
});

test("createDeviceSyncClient validates connection authorization URLs before opening a browser", async () => {
  let openedUrl: string | null = null;
  const client = createDeviceSyncClient({
    baseUrl: "http://127.0.0.1:8788",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          provider: "oura",
          state: "state_01",
          expiresAt: "2026-04-23T12:00:00.000Z",
          authorizationUrl: "javascript:alert(1)",
        }),
        { status: 200 },
      ),
    openBrowser: async (url) => {
      openedUrl = url;
      return true;
    },
  });

  await assert.rejects(
    () => client.beginConnection({ provider: "oura", open: true }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === "device_sync_invalid_response" &&
      error.context?.path === "/providers/oura/connect",
  );
  assert.equal(openedUrl, null);
});

test("createDeviceSyncClient rejects non-loopback base URLs when a control-plane bearer is configured", () => {
  assert.throws(
    () =>
      createDeviceSyncClient({
        baseUrl: "https://device-sync.example.test",
        controlToken: "control-token-for-tests",
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === "DEVICE_SYNC_REMOTE_BASE_URL_UNSUPPORTED" &&
      /loopback base URLs/u.test(error.message),
  );
});
