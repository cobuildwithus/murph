import assert from "node:assert/strict";

import { test } from "vitest";

import {
  DeviceSyncError,
  deviceSyncError,
  formatDeviceSyncStartupError,
  isDeviceSyncError,
} from "../src/errors.ts";

test("device sync errors preserve defaults, explicit fields, and causes", () => {
  const cause = new Error("upstream failed");
  const error = deviceSyncError({
    code: "TOKEN_REFRESH_FAILED",
    message: "Refresh token expired.",
    retryable: true,
    httpStatus: 401,
    accountStatus: "reauthorization_required",
    details: {
      provider: "oura",
    },
    cause,
  });

  assert.equal(error instanceof DeviceSyncError, true);
  assert.equal(isDeviceSyncError(error), true);
  assert.equal(error.code, "TOKEN_REFRESH_FAILED");
  assert.equal(error.retryable, true);
  assert.equal(error.httpStatus, 401);
  assert.equal(error.accountStatus, "reauthorization_required");
  assert.deepEqual(error.details, {
    provider: "oura",
  });
  assert.equal(error.cause, cause);

  const fallback = new DeviceSyncError({
    code: "UNKNOWN",
    message: "Unknown device sync failure.",
  });

  assert.equal(fallback.retryable, false);
  assert.equal(fallback.httpStatus, 500);
  assert.equal(fallback.accountStatus, null);
  assert.equal(fallback.details, undefined);
});

test("startup error formatting distinguishes device-sync, generic, and scalar failures", () => {
  assert.equal(
    formatDeviceSyncStartupError(
      new DeviceSyncError({
        code: "CONTROL_PLANE_AUTH_REQUIRED",
        message: "Missing bearer token.",
      }),
    ),
    "DeviceSyncError CONTROL_PLANE_AUTH_REQUIRED: Missing bearer token.",
  );
  assert.equal(
    formatDeviceSyncStartupError(new TypeError("boom")),
    "TypeError: boom",
  );
  assert.equal(formatDeviceSyncStartupError(42), "42");
});
