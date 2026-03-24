import assert from "node:assert/strict";
import { test } from "vitest";

import {
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken,
} from "../src/device-sync.js";
import { encodeCrockford, encodeRandomCrockford, generateUlid } from "../src/ulid.js";

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
  assert.equal(resolveDeviceSyncBaseUrl(), "http://127.0.0.1:8788");
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

test("resolveDeviceSyncControlToken falls back to DEVICE_SYNC_SECRET", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_SECRET: "secret-token",
      },
    }),
    "secret-token",
  );
});

test("resolveDeviceSyncControlToken prefers DEVICE_SYNC_CONTROL_TOKEN over DEVICE_SYNC_SECRET", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_CONTROL_TOKEN: "control-token",
        DEVICE_SYNC_SECRET: "secret-token",
      },
    }),
    "control-token",
  );
});

test("resolveDeviceSyncControlToken returns null when no env is set", () => {
  assert.equal(resolveDeviceSyncControlToken(), null);
});
