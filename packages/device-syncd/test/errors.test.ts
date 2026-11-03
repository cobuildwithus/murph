import assert from "node:assert/strict";

import { test } from "vitest";

import {
  DeviceSyncError,
  buildPublicDeviceSyncErrorPayload,
  deviceSyncError,
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

test("device sync public error payload keeps only sanitized provider status details", () => {
  const sensitiveBodySnippet =
    "account_id=acct_fake_sensitive_123 access_token=tok_fake_sensitive_456 scope=heartrate";
  const payload = buildPublicDeviceSyncErrorPayload(
    new DeviceSyncError({
      code: "JUNCTION_API_REQUEST_FAILED",
      message: "Junction API request failed for /v2/summary/sleep.",
      retryable: true,
      httpStatus: 502,
      details: {
        status: 502,
        bodySnippet: sensitiveBodySnippet,
        provider: "junction",
      },
    }),
  );
  const body = JSON.stringify(payload);

  assert.doesNotMatch(body, /acct_fake_sensitive_123/u);
  assert.doesNotMatch(body, /tok_fake_sensitive_456/u);
  assert.doesNotMatch(body, /scope=heartrate/u);
  assert.doesNotMatch(body, /bodySnippet/u);
  assert.doesNotMatch(body, /provider/u);
  assert.deepEqual(payload, {
    error: {
      code: "JUNCTION_API_REQUEST_FAILED",
      message: "Junction API request failed for /v2/summary/sleep.",
      retryable: true,
      details: {
        status: 502,
      },
    },
  });
});

test("buildPublicDeviceSyncErrorPayload exposes only safe numeric status details", () => {
  const withNumericStatus = buildPublicDeviceSyncErrorPayload(
    new DeviceSyncError({
      code: "JUNCTION_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      httpStatus: 502,
      details: {
        status: "502",
        bodySnippet: "access_token=secret",
      },
    }),
  );
  const withInvalidStatus = buildPublicDeviceSyncErrorPayload(
    new DeviceSyncError({
      code: "JUNCTION_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      httpStatus: 502,
      details: {
        status: "not-a-status",
        bodySnippet: "access_token=secret",
      },
    }),
  );

  assert.deepEqual(withNumericStatus, {
    error: {
      code: "JUNCTION_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      details: {
        status: 502,
      },
    },
  });
  assert.deepEqual(withInvalidStatus, {
    error: {
      code: "JUNCTION_API_REQUEST_FAILED",
      message: "Provider request failed.",
      retryable: true,
      details: undefined,
    },
  });
});

test("buildPublicDeviceSyncErrorPayload redacts secret-bearing error text", () => {
  const payload = buildPublicDeviceSyncErrorPayload(
    new DeviceSyncError({
      code: "JUNCTION_API_REQUEST_FAILED",
      message:
        "authorization=Bearer secret-token refresh_token=refresh-secret eyJhbGciOiJIUzI1NiJ9.payload.signature",
      retryable: true,
      httpStatus: 502,
    }),
  );

  assert.deepEqual(payload, {
    error: {
      code: "JUNCTION_API_REQUEST_FAILED",
      message: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
      retryable: true,
      details: undefined,
    },
  });
});
