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

test("resolveDeviceSyncBaseUrl accepts the legacy HEALTHYBOB_* alias", () => {
  assert.equal(
    resolveDeviceSyncBaseUrl({
      env: {
        HEALTHYBOB_DEVICE_SYNC_BASE_URL: "http://127.0.0.1:9911/",
      },
    }),
    "http://127.0.0.1:9911",
  );
});

test("resolveDeviceSyncBaseUrl prefers the unprefixed env var over the legacy alias", () => {
  assert.equal(
    resolveDeviceSyncBaseUrl({
      env: {
        DEVICE_SYNC_BASE_URL: "http://127.0.0.1:9911/",
        HEALTHYBOB_DEVICE_SYNC_BASE_URL: "http://127.0.0.1:9922/",
      },
    }),
    "http://127.0.0.1:9911",
  );
});

test("resolveDeviceSyncControlToken falls back to legacy control-token and secret aliases", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN: "legacy-control-token",
      },
    }),
    "legacy-control-token",
  );
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        HEALTHYBOB_DEVICE_SYNC_SECRET: "legacy-secret-token",
      },
    }),
    "legacy-secret-token",
  );
});

test("resolveDeviceSyncControlToken prefers unprefixed env vars over legacy aliases", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_CONTROL_TOKEN: "primary-control-token",
        HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN: "legacy-control-token",
      },
    }),
    "primary-control-token",
  );
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_SECRET: "primary-secret-token",
        HEALTHYBOB_DEVICE_SYNC_SECRET: "legacy-secret-token",
      },
    }),
    "primary-secret-token",
  );
});
