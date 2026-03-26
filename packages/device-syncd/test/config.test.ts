import assert from "node:assert/strict";
import { test } from "vitest";

import { loadDeviceSyncEnvironment } from "../src/config.js";
import { computeRetryDelayMs } from "../src/shared.js";

test("computeRetryDelayMs uses the 15-second slot for the first retry", () => {
  assert.equal(computeRetryDelayMs(1), 15_000);
  assert.equal(computeRetryDelayMs(2), 60_000);
});

test("loadDeviceSyncEnvironment supports Oura-only deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
    DEVICE_SYNC_SECRET: "secret-for-tests",
    DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.equal(loaded.service.providers.length, 1);
  assert.equal(loaded.service.providers[0]?.provider, "oura");
  assert.equal(loaded.http.host, "127.0.0.1");
  assert.equal(loaded.http.controlToken, "control-token-for-tests");
});

test("loadDeviceSyncEnvironment supports mixed WHOOP and Oura deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
    DEVICE_SYNC_SECRET: "secret-for-tests",
    DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
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
        DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
        DEVICE_SYNC_SECRET: "secret-for-tests",
        DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
        OURA_CLIENT_ID: "oura-client-id",
      }),
    /Oura configuration is incomplete/u,
  );
});

test("loadDeviceSyncEnvironment supports an explicit control token and public listener", () => {
  const loaded = loadDeviceSyncEnvironment({
    DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
    DEVICE_SYNC_SECRET: "secret-for-tests",
    DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    DEVICE_SYNC_PUBLIC_HOST: "0.0.0.0",
    DEVICE_SYNC_PUBLIC_PORT: "9876",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.equal(loaded.http.controlToken, "control-token-for-tests");
  assert.equal(loaded.http.publicHost, "0.0.0.0");
  assert.equal(loaded.http.publicPort, 9876);
});

test("loadDeviceSyncEnvironment rejects partial public listener configuration", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
        DEVICE_SYNC_SECRET: "secret-for-tests",
        DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
        DEVICE_SYNC_PUBLIC_HOST: "0.0.0.0",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
      }),
    /DEVICE_SYNC_PUBLIC_HOST and DEVICE_SYNC_PUBLIC_PORT together/u,
  );
});

test("loadDeviceSyncEnvironment requires at least one provider", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
        DEVICE_SYNC_SECRET: "secret-for-tests",
        DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
      }),
    /No device sync providers are configured/u,
  );
});

test("loadDeviceSyncEnvironment requires DEVICE_SYNC_CONTROL_TOKEN", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
        DEVICE_SYNC_SECRET: "secret-for-tests",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
      }),
    /DEVICE_SYNC_CONTROL_TOKEN/u,
  );
});

test("loadDeviceSyncEnvironment exposes the optional Oura webhook verification token on the HTTP config", () => {
  const loaded = loadDeviceSyncEnvironment({
    DEVICE_SYNC_VAULT_ROOT: "/tmp/healthybob-vault",
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://healthybob.test/device-sync",
    DEVICE_SYNC_SECRET: "secret-for-tests",
    DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    OURA_WEBHOOK_VERIFICATION_TOKEN: "verify-token-for-tests",
  });

  assert.equal(loaded.http.ouraWebhookVerificationToken, "verify-token-for-tests");
});
