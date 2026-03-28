import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertLocalDeviceSyncControlPlaneBaseUrl,
  isDeviceSyncLocalControlPlaneError,
  isLoopbackDeviceSyncBaseUrl,
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken,
} from "../src/device-sync.ts";
import { encodeCrockford, encodeRandomCrockford, generateUlid } from "../src/ulid.ts";

function deterministicRandomBytes(length: number): Uint8Array {
  return Uint8Array.from(Array.from({ length }, (_, index) => index));
}

test("shared Crockford helpers preserve the duplicated low-level encoding behavior", () => {
  assert.equal(encodeCrockford(0, 10), "0000000000");
  assert.equal(encodeCrockford(32, 4), "0010");
  assert.equal(encodeRandomCrockford(24, deterministicRandomBytes), "0123456789ABCDEFGHJKMNPQ");
  assert.equal(generateUlid(0, deterministicRandomBytes), "00000000000123456789ABCDEF");
});

test("resolveDeviceSyncBaseUrl reads the unprefixed env var", () => {
  assert.equal(
    resolveDeviceSyncBaseUrl({
      env: {
        DEVICE_SYNC_BASE_URL: "http://127.0.0.1:9911/",
      },
    }),
    "http://127.0.0.1:9911",
  );
});

test("resolveDeviceSyncBaseUrl falls back to the default base URL when env is unset", () => {
  assert.equal(resolveDeviceSyncBaseUrl(), "http://localhost:8788");
});

test("resolveDeviceSyncBaseUrl rejects non-loopback base URLs when a control-plane bearer is configured", () => {
  assert.throws(
    () =>
      resolveDeviceSyncBaseUrl({
        value: "https://example.com/device-sync",
        controlToken: "control-token",
      }),
    (error) => isDeviceSyncLocalControlPlaneError(error),
  );
});

test("assertLocalDeviceSyncControlPlaneBaseUrl allows loopback control-plane targets", () => {
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://127.0.0.1:8788"), true);
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://localhost:8788"), true);
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://[::1]:8788"), true);

  assert.doesNotThrow(() =>
    assertLocalDeviceSyncControlPlaneBaseUrl({
      baseUrl: "http://localhost:8788",
      controlToken: "control-token",
    }),
  );
});

test("resolveDeviceSyncControlToken reads the unprefixed control token", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_CONTROL_TOKEN: "control-token",
      },
    }),
    "control-token",
  );
});

test("resolveDeviceSyncControlToken ignores DEVICE_SYNC_SECRET-only configuration", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_SECRET: "secret-token",
      },
    }),
    null,
  );
});

test("resolveDeviceSyncControlToken returns null when no env is set", () => {
  assert.equal(resolveDeviceSyncControlToken(), null);
});
