import assert from "node:assert/strict";
import { test } from "vitest";
import { buildProviderApiError } from "../src/providers/provider-api-error.ts";

test("Junction API failures retain status and retry policy without raw bodies", () => {
  const error = buildProviderApiError("JUNCTION_API_FAILED", "Request failed.", new Response(null, { status: 429 }), '{"private":"synthetic-private-body"}');
  assert.equal(error.httpStatus, 429);
  assert.equal(error.retryable, true);
  assert.equal(error.details?.status, 429);
  assert.equal(JSON.stringify(error.details).includes("synthetic-private-body"), false);
});

test("shared API errors preserve retry, status, account policy and bounded diagnostics", () => {
  const rateLimited = buildProviderApiError(
    "RATE_LIMITED",
    "Rate limited",
    new Response("{}", { status: 429 }),
    "{}",
  );
  assert.equal(rateLimited.retryable, true);
  assert.equal(rateLimited.httpStatus, 429);
  assert.deepEqual(rateLimited.details, {
    accountStatus: null,
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: true,
    status: 429,
  });

  const unauthorized = buildProviderApiError(
    "UNAUTHORIZED",
    "Unauthorized",
    new Response("{}", { status: 401 }),
    "{}",
    {
      retryable: false,
      accountStatus: "reauthorization_required",
    },
  );
  assert.equal(unauthorized.retryable, false);
  assert.equal(unauthorized.accountStatus, "reauthorization_required");
  assert.deepEqual(unauthorized.details, {
    accountStatus: "reauthorization_required",
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: false,
    status: 401,
  });

  const withDiagnostics = buildProviderApiError(
    "TOKEN_FAILED",
    "Token failed",
    new Response("{}", { status: 400 }),
    "{}",
    {
      diagnostics: {
        oauthErrorDescription: "Refresh token expired at https://api.example.test/token?access_token=secret",
        oauthErrorCode: "invalid_grant",
        oauthGrantType: "refresh_token",
        unsafeText: "contains spaces",
      },
    },
  );
  assert.deepEqual(withDiagnostics.details, {
    accountStatus: null,
    oauthErrorDescription: "Refresh token expired at <redacted-url>",
    oauthErrorCode: "invalid_grant",
    oauthGrantType: "refresh_token",
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: false,
    status: 400,
  });

  const withUnsafeDiagnostics = buildProviderApiError(
    "TOKEN_FAILED",
    "Token failed",
    new Response("{}", { status: 400 }),
    "{}",
    {
      diagnostics: {
        oauthErrorDescription: '{"refresh_token":"fixture-secret","user_id":"user-sensitive"}',
        oauthErrorCode: "invalid_grant",
      },
    },
  );
  assert.deepEqual(withUnsafeDiagnostics.details, {
    accountStatus: null,
    oauthErrorCode: "invalid_grant",
    responseErrorDescriptionFieldPresent: false,
    responseErrorFieldPresent: false,
    responseShapeKind: "json_object",
    retryable: false,
    status: 400,
  });

  const withProviderReason = buildProviderApiError(
    "PROVIDER_FAILED",
    "Provider failed",
    new Response(null, { status: 502 }),
    JSON.stringify({
      code: "upstream_timeout",
      message: "Provider timed out after retrying.",
    }),
  );
  assert.deepEqual(withProviderReason.details, {
    accountStatus: null,
    responseErrorCode: "upstream_timeout",
    responseErrorDescription: "Provider timed out after retrying.",
    responseErrorDescriptionFieldPresent: true,
    responseErrorFieldPresent: true,
    responseShapeKind: "json_object",
    retryable: true,
    status: 502,
  });

  const withValidationDetail = buildProviderApiError(
    "PROVIDER_FAILED",
    "Provider failed",
    new Response(null, { status: 422 }),
    JSON.stringify({
      detail: [{
        type: "value_error.date",
        loc: ["query", "start_date"],
        msg: "start_date must be before end_date.",
      }],
    }),
  );
  assert.deepEqual(withValidationDetail.details, {
    accountStatus: null,
    responseErrorCode: "value_error.date",
    responseErrorDescription: "start_date must be before end_date.",
    responseErrorDescriptionFieldPresent: true,
    responseErrorFieldPresent: true,
    responseShapeKind: "json_object",
    retryable: false,
    status: 422,
  });

});
