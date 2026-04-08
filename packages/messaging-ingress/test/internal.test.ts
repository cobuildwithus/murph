import assert from "node:assert/strict";

import { test } from "vitest";

import {
  compactRecord,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "../src/internal.ts";

test("sanitizeRawMetadata redacts sensitive keys, secret-like values, and user paths", () => {
  const result = sanitizeRawMetadata({
    "---": "keep-symbol-key",
    array: [undefined, new Uint8Array([1, 2, 3])],
    "access-token-extra": "keep-extra-part",
    authToken: "secret-value",
    "client-key-id": "rotate-me",
    nested: {
      "api secret": "top-secret",
      bearer: "Bearer secret-token",
      cookie: "session=secret",
      homePath: "/home/example/project",
      keep: "ok",
      userPath: "/Users/example/project",
      windowsPath: "C:\\Users\\Example\\project",
    },
    "set-cookie-value": "redact-by-substring",
    session_token: "redact-me",
    "token-holder": "keep-me",
  });

  assert.deepEqual(result, {
    "---": "keep-symbol-key",
    array: [null, "<3 bytes>"],
    "access-token-extra": "<REDACTED_SECRET>",
    authToken: "<REDACTED_SECRET>",
    "client-key-id": "<REDACTED_SECRET>",
    nested: {
      "api secret": "<REDACTED_SECRET>",
      bearer: "<REDACTED_SECRET>",
      cookie: "<REDACTED_SECRET>",
      homePath: "<REDACTED_PATH>",
      keep: "ok",
      userPath: "<REDACTED_PATH>",
      windowsPath: "<REDACTED_PATH>",
    },
    "set-cookie-value": "<REDACTED_SECRET>",
    session_token: "<REDACTED_SECRET>",
    "token-holder": "keep-me",
  });
});

test("compactRecord removes undefined values and toIsoTimestamp rejects invalid input", () => {
  assert.deepEqual(
    compactRecord({
      keepFalse: false,
      keepNull: null,
      keepZero: 0,
      remove: undefined,
    }),
    {
      keepFalse: false,
      keepNull: null,
      keepZero: 0,
    },
  );

  assert.equal(toIsoTimestamp("2026-04-08T00:00:00.000Z"), "2026-04-08T00:00:00.000Z");
  assert.throws(() => toIsoTimestamp("not-a-date"), /Invalid ISO timestamp: not-a-date/u);
});

test("sanitizeRawMetadata stringifies non-JSON primitives and drops undefined object fields", () => {
  const tokenSymbol = Symbol("token");
  function namedValue() {
    return "ok";
  }

  const result = sanitizeRawMetadata({
    functionValue: namedValue,
    keepCombo: "keep",
    nested: {
      dropMe: undefined,
    },
    numberLikeKey: "keep",
    symbolValue: tokenSymbol,
    token_api_extra: "keep",
    weirdBigInt: 42n,
  });

  assert.deepEqual(result, {
    functionValue: String(namedValue),
    keepCombo: "keep",
    nested: {},
    numberLikeKey: "keep",
    symbolValue: "Symbol(token)",
    token_api_extra: "keep",
    weirdBigInt: "42",
  });
});
