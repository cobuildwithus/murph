import assert from "node:assert/strict";

import { test } from "vitest";

import { createDeviceSyncClient } from "../src/device-sync-client.js";
import { VaultCliError } from "../src/vault-cli-errors.js";

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
      /HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN/u.test(error.message),
  );
});
