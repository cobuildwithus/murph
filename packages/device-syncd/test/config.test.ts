import assert from "node:assert/strict";
import { test } from "vitest";

import { loadDeviceSyncEnvironment } from "../src/config.js";

test("loadDeviceSyncEnvironment supports Oura-only deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    HEALTHYBOB_VAULT_ROOT: "/tmp/healthybob-vault",
    HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
    HEALTHYBOB_DEVICE_SYNC_SECRET: "secret-for-tests",
    HEALTHYBOB_OURA_CLIENT_ID: "oura-client-id",
    HEALTHYBOB_OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.equal(loaded.service.providers.length, 1);
  assert.equal(loaded.service.providers[0]?.provider, "oura");
  assert.equal(loaded.http.host, "127.0.0.1");
});

test("loadDeviceSyncEnvironment supports mixed WHOOP and Oura deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    HEALTHYBOB_VAULT_ROOT: "/tmp/healthybob-vault",
    HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
    HEALTHYBOB_DEVICE_SYNC_SECRET: "secret-for-tests",
    HEALTHYBOB_WHOOP_CLIENT_ID: "whoop-client-id",
    HEALTHYBOB_WHOOP_CLIENT_SECRET: "whoop-client-secret",
    HEALTHYBOB_OURA_CLIENT_ID: "oura-client-id",
    HEALTHYBOB_OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.deepEqual(
    loaded.service.providers.map((provider) => provider.provider),
    ["whoop", "oura"],
  );
});

test("loadDeviceSyncEnvironment rejects incomplete provider credentials", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        HEALTHYBOB_VAULT_ROOT: "/tmp/healthybob-vault",
        HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
        HEALTHYBOB_DEVICE_SYNC_SECRET: "secret-for-tests",
        HEALTHYBOB_OURA_CLIENT_ID: "oura-client-id",
      }),
    /Oura configuration is incomplete/u,
  );
});

test("loadDeviceSyncEnvironment requires at least one provider", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        HEALTHYBOB_VAULT_ROOT: "/tmp/healthybob-vault",
        HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
        HEALTHYBOB_DEVICE_SYNC_SECRET: "secret-for-tests",
      }),
    /No device sync providers are configured/u,
  );
});
