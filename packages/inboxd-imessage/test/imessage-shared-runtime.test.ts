import assert from "node:assert/strict";

import { test } from "vitest";

import {
  normalizeTextValue,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "../src/shared-runtime.ts";

test("toIsoTimestamp normalizes valid values and rejects invalid timestamps", () => {
  assert.equal(toIsoTimestamp(new Date("2026-03-13T10:00:00.000Z")), "2026-03-13T10:00:00.000Z");
  assert.equal(toIsoTimestamp("2026-03-13T10:00:01.000Z"), "2026-03-13T10:00:01.000Z");
  assert.equal(toIsoTimestamp(0), "1970-01-01T00:00:00.000Z");
  assert.throws(() => toIsoTimestamp("not-a-timestamp"), /Invalid ISO timestamp: not-a-timestamp/u);
});

test("normalizeTextValue trims strings and nulls empty or non-string values", () => {
  assert.equal(normalizeTextValue("  hello  "), "hello");
  assert.equal(normalizeTextValue("   "), null);
  assert.equal(normalizeTextValue(42), null);
  assert.equal(normalizeTextValue(null), null);
});

test("sanitizeRawMetadata recursively redacts sensitive metadata and preserves safe values", () => {
  const fn = function sampleFunction() {
    return "ok";
  };
  const symbolValue = Symbol("shared-runtime");
  const sanitized = sanitizeRawMetadata({
    createdAt: new Date("2026-03-13T10:00:00.000Z"),
    blob: new Uint8Array([1, 2, 3, 4]),
    blankKey: {
      "": "visible",
    },
    authToken: "token-1",
    nested: {
      "oauth token value": "token-2",
      user_session_ref: "session-1",
      "token token": "token-3",
      "client key info": "token-4",
      safe: undefined,
    },
    list: [
      undefined,
      "/home/tester/Library/Messages/chat.db",
      "C:\\Users\\Tester\\Library\\Messages\\chat.db",
      "Bearer abc123",
      "plain text",
      null,
      7,
      false,
      99n,
      symbolValue,
      fn,
    ],
  });

  assert.deepEqual(sanitized, {
    createdAt: "2026-03-13T10:00:00.000Z",
    blob: "<4 bytes>",
    blankKey: {
      "": "visible",
    },
    authToken: "<REDACTED_SECRET>",
    nested: {
      "oauth token value": "<REDACTED_SECRET>",
      user_session_ref: "<REDACTED_SECRET>",
      "token token": "<REDACTED_SECRET>",
      "client key info": "<REDACTED_SECRET>",
    },
    list: [
      null,
      "<REDACTED_PATH>",
      "<REDACTED_PATH>",
      "<REDACTED_SECRET>",
      "plain text",
      null,
      7,
      false,
      "99",
      "Symbol(shared-runtime)",
      String(fn),
    ],
  });
});

test("sanitizeRawMetadata preserves nullish and scalar values at the top level", () => {
  assert.equal(sanitizeRawMetadata(undefined), undefined);
  assert.equal(sanitizeRawMetadata(null), null);
  assert.equal(sanitizeRawMetadata(true), true);
  assert.equal(sanitizeRawMetadata(12), 12);
});
