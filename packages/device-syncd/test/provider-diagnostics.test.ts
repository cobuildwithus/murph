import assert from "node:assert/strict";

import { test } from "vitest";

import { inspectProviderErrorBody } from "../src/providers/provider-diagnostics.ts";

test("provider diagnostics drop id-shaped error codes while preserving safe descriptions", () => {
  assert.deepEqual(
    inspectProviderErrorBody(JSON.stringify({
      code: "11649ed4-27e2-4718-959f-d68de1d1a120",
      message: "sleep_cycle disabled",
    })),
    {
      responseErrorCode: null,
      responseErrorDescription: "sleep_cycle disabled",
      responseErrorDescriptionFieldPresent: true,
      responseErrorFieldPresent: true,
      responseShapeKind: "json_object",
    },
  );
});

test("provider diagnostics read top-level JSON array validation entries", () => {
  assert.deepEqual(
    inspectProviderErrorBody(JSON.stringify([
      {
        type: "value_error.date",
        msg: "start_date must be before end_date",
      },
    ])),
    {
      responseErrorCode: "value_error.date",
      responseErrorDescription: "start_date must be before end_date",
      responseErrorDescriptionFieldPresent: true,
      responseErrorFieldPresent: true,
      responseShapeKind: "json_array",
    },
  );
});

test("provider diagnostics keep word-like error codes", () => {
  assert.equal(
    inspectProviderErrorBody(JSON.stringify({ code: "invalid_request" })).responseErrorCode,
    "invalid_request",
  );
  assert.equal(
    inspectProviderErrorBody(JSON.stringify({ type: "value_error.date" })).responseErrorCode,
    "value_error.date",
  );
  assert.equal(
    inspectProviderErrorBody(JSON.stringify({ code: "ERR_42" })).responseErrorCode,
    "err_42",
  );
});
