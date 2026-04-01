import assert from "node:assert/strict";

import { test } from "vitest";

import { createDeviceSyncClient } from "@murphai/assistant-core/device-sync-client";
import { VaultCliError } from "@murphai/assistant-core/vault-cli-errors";

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
